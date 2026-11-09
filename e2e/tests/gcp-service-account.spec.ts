import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { cfg, keyFiles, REQUIRED_ROLES } from '../lib/config';
import { GcpConsole } from '../lib/gcp-console';
import * as gcloud from '../lib/gcloud';
import { createOrReuseJsonKey } from '../lib/keys';

/**
 * Automates the manual prerequisites in ConcreteDetectionFromScratch.md:
 *   Step 2 - Create the service account and assign the admin roles.
 *   Step 3 - Create and download a JSON key, and encode it as single-line base64.
 *
 * The flow tests run in order against a real GCP project; test 2 needs the account from test 1.
 * Safe to re-run: an account that already exists is used as it is (its roles are checked, it is
 * not created again and never deleted), and a still-active key you already have is reused.
 */

const roleNames = REQUIRED_ROLES.map((r) => r.name);
const roleIds = REQUIRED_ROLES.map((r) => r.id);
const files = keyFiles(cfg.saId);

/** Set once this run has created the account; cleanup only ever deletes such an account. */
let createdThisRun = false;

test.describe('Create service account form validation', () => {
  test('rejects an invalid service account ID', async ({ page }) => {
    const gcp = new GcpConsole(page);
    await gcp.openCreateServiceAccount();

    await gcp.fillName('Invalid id check');
    await gcp.idInput.fill('Bad_ID'); // uppercase + underscore, and too short

    await gcp.idInput.press('Tab');
    // Wording varies between Console versions; any ID-format error message will do.
    await expect(
      page.getByText(/lowercase|alphanumeric|must (start|begin|be)|between 6 and 30|invalid/i).first(),
    ).toBeVisible();

    // Some Console versions disable the button; others leave it enabled and refuse on click.
    // Either way the wizard must not move on to step 2 (Permissions).
    if (await gcp.createAndContinueButton.isEnabled()) {
      await gcp.createAndContinueButton.click();
      await page.waitForTimeout(3_000);
    }
    await expect(gcp.rolePickers, 'the wizard must not continue with an invalid ID').toHaveCount(0);
    await expect(gcp.idInput).toHaveValue('Bad_ID');
  });
});

test.describe(`GCP service account "${cfg.saId}" in project "${cfg.projectId}"`, () => {
  test.describe.configure({ mode: 'serial' });

  test('1. creates the service account with the required roles', async ({ page }) => {
    const gcp = new GcpConsole(page);

    // An account that already exists is used as it is: never created again, never deleted.
    let exists = await test.step(`Check whether ${cfg.saEmail} already exists`, async () => {
      if (gcloud.gcloudAvailable()) {
        try {
          return gcloud.serviceAccountExists(cfg.saEmail);
        } catch (e) {
          console.warn(`${(e as Error).message} - checking in the Console instead.`);
        }
      }
      return gcp.serviceAccountListed(cfg.saEmail);
    });
    console.log(`${cfg.saEmail}: ${exists ? 'already exists' : 'not found, will create it'}.`);

    if (!exists) {
      await test.step('Step 1: fill in name, ID and description', async () => {
        await gcp.openCreateServiceAccount();
        const filled = await gcp.fillDetails({ name: cfg.saDisplayName, id: cfg.saId, description: cfg.saDescription });
        if (filled === 'exists') {
          // The Console says this ID is taken: the account exists, use it instead of creating it.
          exists = true;
          return;
        }
        createdThisRun = true;
        if ((await gcp.submitDetails()) === 'exists') {
          // The list check missed it (e.g. very long list); the Console knows better.
          createdThisRun = false;
          exists = true;
        }
      });
    }

    if (exists) {
      if (!cfg.isRealAccount) {
        throw new Error(`Generated account ${cfg.saEmail} already exists - unexpected. Re-run to get a new ID.`);
      }
      console.log(`${cfg.saEmail} already exists - using it as it is (not creating it again), checking its roles.`);
    } else {
      await test.step(`Step 2: assign roles: ${roleNames.join(', ')}`, async () => {
        for (const [index, role] of roleNames.entries()) {
          await gcp.addRole(role, index);
        }
        await expect(gcp.rolePickers).toHaveCount(roleNames.length);
      });

      await test.step('Step 3: finish the wizard', async () => {
        await gcp.finishWizard();
      });
    }

    await test.step('Service account is listed and enabled', async () => {
      await gcp.serviceAccountListed(cfg.saEmail); // opens the list, filtered to this account
      const row = gcp.serviceAccountRow(cfg.saEmail).first();
      await expect(row).toBeVisible();
      await expect(row).toContainText(/enabled/i);
      if (!exists) await expect(row).toContainText(cfg.saDisplayName);
    });

    await test.step('IAM page shows all required roles for the account', async () => {
      const row = await gcp.iamRowFor(cfg.saEmail);
      for (const role of roleNames) {
        await expect(
          row,
          exists
            ? `Existing account ${cfg.saEmail} is missing role "${role}". Add it on the IAM page, or delete the account and re-run.`
            : `IAM row should contain role "${role}"`,
        ).toContainText(role);
      }
    });

    if (gcloud.gcloudAvailable()) {
      await test.step('gcloud: project IAM policy has the required roles', async () => {
        // IAM changes are eventually consistent - poll for a short while.
        const check = expect.poll(() => gcloud.projectRolesOf(cfg.saEmail).sort(), {
          timeout: 60_000,
          intervals: [2_000, 5_000],
        });
        // A new account must have exactly these roles; an existing one may have extra.
        if (exists) await check.toEqual(expect.arrayContaining([...roleIds]));
        else await check.toEqual([...roleIds].sort());
      });
    }
  });

  test('2. creates and downloads a JSON key, and encodes it as single-line base64', async ({ page }) => {
    await createOrReuseJsonKey(new GcpConsole(page), cfg.saId, cfg.saEmail, cfg.saKeyFile);
  });

  test.afterAll(async ({ browser }) => {
    if (!cfg.cleanup || !createdThisRun) {
      console.log(`Keeping ${cfg.saEmail}. Key files: ${files.json}, ${files.b64}`);
      return;
    }

    // The key is useless once the account is gone, so don't leave secrets on disk.
    for (const file of [files.json, files.b64]) fs.rmSync(file, { force: true });

    if (gcloud.gcloudAvailable()) {
      gcloud.deleteServiceAccount(cfg.saEmail, roleIds);
      return;
    }

    console.warn(
      'gcloud not available - deleting the service account through the UI. ' +
        'Its project role bindings will remain as "deleted:serviceAccount:..." entries.',
    );
    const context = await browser.newContext({ storageState: test.info().project.use.storageState });
    try {
      await new GcpConsole(await context.newPage()).deleteServiceAccount(cfg.saEmail);
    } finally {
      await context.close();
    }
  });
});
