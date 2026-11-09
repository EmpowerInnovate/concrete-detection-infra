import { test, expect, type Browser } from '@playwright/test';
import fs from 'node:fs';
import { appSaCfg, cfg, choiceInputs, emailOf, githubCfg, keyFiles } from '../lib/config';
import { GcpConsole } from '../lib/gcp-console';
import * as gcloud from '../lib/gcloud';
import { GitHubActions } from '../lib/github';
import { createOrReuseJsonKey } from '../lib/keys';
import { AUTH_FILE } from '../lib/paths';

/**
 * Optional (APP_SA=1, `npm run all:app` / `npm run app-sa`). The documented Phase 1 middle step:
 *   1. Actions → "Setup GCP Service Account" with the admin key from gcp-service-account.spec.ts.
 *      Terraform enables the APIs and creates the app account (APP_SA_NAME, e.g. crack-detection-1).
 *      Skipped when that account already exists (FORCE_APP_SA_PIPELINE=true runs it anyway).
 *   2. GCP Console: reuse a still-active key you have, or create a new JSON key, and encode it as
 *      single-line base64, the same as step 3 of ConcreteDetectionFromScratch.md.
 * The cluster pipeline then gets the app account's key instead of the admin one.
 */

test.skip(!appSaCfg.enabled, 'App service account step runs only with APP_SA=1 (npm run all:app / npm run app-sa)');
test.describe.configure({ mode: 'serial' });

const appEmail = emailOf(appSaCfg.name);

/** Run `fn` with a Console page. This project's default session is GitHub; the Console needs Google's. */
async function withConsole<T>(browser: Browser, fn: (gcp: GcpConsole) => Promise<T>): Promise<T> {
  const context = await browser.newContext({ storageState: AUTH_FILE });
  try {
    return await fn(new GcpConsole(await context.newPage()));
  } finally {
    await context.close();
  }
}

const appSaExists = (browser: Browser) =>
  gcloud.gcloudAvailable()
    ? Promise.resolve(gcloud.serviceAccountExists(appEmail))
    : withConsole(browser, (gcp) => gcp.serviceAccountListed(appEmail));

test(`app service account "${appSaCfg.name}" exists (created by the Setup GCP Service Account pipeline if missing)`, async ({
  page,
  browser,
}) => {
  test.setTimeout(appSaCfg.timeoutMs + 10 * 60_000);

  const exists = await test.step(`Check whether ${appEmail} already exists`, () => appSaExists(browser));
  if (exists && !appSaCfg.forcePipeline) {
    console.log(`${appEmail} already exists - using it, not running ${appSaCfg.workflowFile}.`);
    return;
  }

  const admin = keyFiles(cfg.saId);
  if (!cfg.isRealAccount) throw new Error('Set SA_ID in .env to the admin service account whose key the pipeline uses.');
  if (!fs.existsSync(admin.b64)) {
    throw new Error(`${admin.b64} not found. Create the admin key first: npm run all:app (or npm run sa).`);
  }
  const adminKeyB64 = fs.readFileSync(admin.b64, 'utf8').trim();

  const gh = new GitHubActions(page, githubCfg.repo);
  let runUrl = '';

  await test.step(`Start ${appSaCfg.workflowFile} in ${githubCfg.repo}`, async () => {
    const inputs: Record<string, string> = {
      action: 'apply',
      ...choiceInputs(),
      gcp_project_id: cfg.projectId,
      gcp_sa_key_base64: adminKeyB64,
      gcp_region: appSaCfg.region,
      gcp_sa_name: appSaCfg.name,
    };
    console.log(`Starting ${appSaCfg.workflowFile}:`);
    runUrl = await gh.startWorkflow(appSaCfg.workflowFile, inputs, ['gcp_sa_key_base64']);
    console.log(`Run started: ${runUrl}`);
  });

  await test.step('Wait for the run to finish', async () => {
    const status = await gh.waitForRun(runUrl, appSaCfg.timeoutMs);
    expect(status, `pipeline run ${runUrl}`).toMatch(/^Success$/i);
  });

  await test.step(`${appEmail} now exists`, async () => {
    await expect.poll(() => appSaExists(browser), { timeout: 120_000, intervals: [10_000] }).toBe(true);
  });
});

test(`JSON key for "${appSaCfg.name}" (reused if still active, else new), encoded as single-line base64`, async ({
  browser,
}) => {
  await withConsole(browser, (gcp) => createOrReuseJsonKey(gcp, appSaCfg.name, appEmail, appSaCfg.keyFile));
});
