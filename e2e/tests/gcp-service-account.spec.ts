import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { cfg, REQUIRED_ROLES } from '../lib/config';
import { GcpConsole } from '../lib/gcp-console';
import * as gcloud from '../lib/gcloud';

/**
 * Automates the manual prerequisites in ConcreteDetectionFromScratch.md:
 *   Step 2 - Create the service account and assign the admin roles.
 *   Step 3 - Create and download a JSON key for it.
 *
 * The flow tests run in order against a real GCP project; test 2 needs the account made in test 1.
 */

const roleNames = REQUIRED_ROLES.map((r) => r.name);
const roleIds = REQUIRED_ROLES.map((r) => r.id);
const keyJsonPath = path.join(cfg.outputDir, `${cfg.saId}-key.json`);
const keyBase64Path = path.join(cfg.outputDir, `${cfg.saId}-key.json.b64`);

test.describe('Create service account form validation', () => {
  test('rejects an invalid service account ID', async ({ page }) => {
    const gcp = new GcpConsole(page);
    await gcp.openCreateServiceAccount();

    await gcp.nameInput.fill('Invalid id check');
    await gcp.idInput.fill('Bad_ID'); // uppercase + underscore, and too short

    await expect(page.getByText(/lowercase alphanumeric characters and dashes/i).first()).toBeVisible();
    await expect(gcp.createAndContinueButton).toBeDisabled();
  });
});

test.describe(`GCP service account "${cfg.saId}" in project "${cfg.projectId}"`, () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(() => {
    if (gcloud.gcloudAvailable() && gcloud.serviceAccountExists(cfg.saEmail)) {
      throw new Error(
        `Service account ${cfg.saEmail} already exists. Delete it, or unset SA_ID to use a generated ID.`,
      );
    }
  });

  test('1. creates the service account with the required roles', async ({ page }) => {
    const gcp = new GcpConsole(page);

    await test.step('Step 1: fill in name, ID and description', async () => {
      await gcp.openCreateServiceAccount();
      await gcp.fillDetails({ name: cfg.saDisplayName, id: cfg.saId, description: cfg.saDescription });
      await expect(page.getByText(cfg.saEmail).first()).toBeVisible(); // email preview under the ID field
      await gcp.submitDetails();
    });

    await test.step(`Step 2: assign roles: ${roleNames.join(', ')}`, async () => {
      for (const [index, role] of roleNames.entries()) {
        await gcp.addRole(role, index);
      }
      await expect(gcp.rolePickers).toHaveCount(roleNames.length);
    });

    await test.step('Step 3: finish the wizard', async () => {
      await gcp.finishWizard();
    });

    await test.step('Service account is listed and enabled', async () => {
      await gcp.openServiceAccountList();
      const row = gcp.serviceAccountRow(cfg.saEmail);
      await expect(row).toBeVisible();
      await expect(row).toContainText(cfg.saDisplayName);
      await expect(row).toContainText(/enabled/i);
    });

    await test.step('IAM page shows all required roles for the account', async () => {
      const row = await gcp.iamRowFor(cfg.saEmail);
      for (const role of roleNames) {
        await expect(row, `IAM row should contain role "${role}"`).toContainText(role);
      }
    });

    if (gcloud.gcloudAvailable()) {
      await test.step('gcloud: project IAM policy has exactly the required roles', async () => {
        // IAM changes are eventually consistent - poll for a short while.
        await expect
          .poll(() => gcloud.projectRolesOf(cfg.saEmail).sort(), { timeout: 60_000, intervals: [2_000, 5_000] })
          .toEqual([...roleIds].sort());
      });
    }
  });

  test('2. creates and downloads a JSON key for the service account', async ({ page }) => {
    const gcp = new GcpConsole(page);
    fs.mkdirSync(cfg.outputDir, { recursive: true });

    await test.step('Keys tab: Add key → Create new key → JSON → Create', async () => {
      await gcp.openKeysTab(cfg.saEmail);
      await gcp.createJsonKey(keyJsonPath);
      fs.chmodSync(keyJsonPath, 0o600);
    });

    const raw = fs.readFileSync(keyJsonPath, 'utf8');
    const key = JSON.parse(raw) as Record<string, string>;

    await test.step('Downloaded file is a valid service account key', async () => {
      expect(key).toMatchObject({
        type: 'service_account',
        project_id: cfg.projectId,
        client_email: cfg.saEmail,
        token_uri: 'https://oauth2.googleapis.com/token',
      });
      expect(key.private_key_id).toMatch(/^[0-9a-f]{40}$/);
      expect(key.private_key).toContain('-----BEGIN PRIVATE KEY-----');
      expect(key.private_key).toContain('-----END PRIVATE KEY-----');
      expect(key.client_id).toMatch(/^\d+$/);
    });

    await test.step('New key appears in the Keys table as active', async () => {
      const row = gcp.keyRow(key.private_key_id);
      await expect(row).toBeVisible();
      await expect(row).toContainText(/active/i);
    });

    if (gcloud.gcloudAvailable()) {
      await test.step('gcloud: key is registered on the service account', async () => {
        await expect
          .poll(() => gcloud.userManagedKeyIds(cfg.saEmail), { timeout: 60_000 })
          .toContain(key.private_key_id);
      });
    }

    await test.step('Write base64 copy for the GitHub Actions workflow input', async () => {
      // Same as `base64 -w 0 key.json` in the README.
      fs.writeFileSync(keyBase64Path, Buffer.from(raw).toString('base64'), { mode: 0o600 });
      const decoded = Buffer.from(fs.readFileSync(keyBase64Path, 'utf8'), 'base64').toString('utf8');
      expect(JSON.parse(decoded).private_key_id).toBe(key.private_key_id);
    });
  });

  test.afterAll(async ({ browser }) => {
    if (!cfg.cleanup) {
      console.log(`CLEANUP=false - keeping ${cfg.saEmail}. Key files: ${keyJsonPath}, ${keyBase64Path}`);
      return;
    }

    // The key is useless once the account is gone, so don't leave secrets on disk.
    for (const file of [keyJsonPath, keyBase64Path]) fs.rmSync(file, { force: true });

    if (gcloud.gcloudAvailable()) {
      gcloud.deleteServiceAccount(cfg.saEmail, roleIds);
      return;
    }

    console.warn('gcloud not available - deleting the service account through the UI. ' +
      'Its project role bindings will remain as "deleted:serviceAccount:..." entries.');
    const context = await browser.newContext({ storageState: test.info().project.use.storageState });
    try {
      await new GcpConsole(await context.newPage()).deleteServiceAccount(cfg.saEmail);
    } finally {
      await context.close();
    }
  });
});
