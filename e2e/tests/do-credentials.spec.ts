import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { doCfg } from '../lib/config';
import {
  DoConsole, loadCredentials, saveCredentials, spacesKeyWorks, tokenWorks, expectValidCredentials,
  type DoCredentials,
} from '../lib/do';
import { DO_AUTH_FILE } from '../lib/paths';

/**
 * DigitalOcean credentials for the "Deploy Kubernetes Cluster" pipeline (provider = digitalocean):
 *   1. API token          (do_token)                     - API -> Tokens -> Generate New Token
 *   2. Spaces access key  (do_access_key, do_secret_key) - Spaces -> Access Keys -> Create Access Key
 *
 * Saved credentials (output/do-credentials.json, gitignored) are reused while they still work, so
 * nothing is created twice. Only when one is missing or revoked does the test open the control panel
 * (you sign in by hand when asked) and create a new one. DO_NEW_CREDENTIALS=true always makes new ones.
 */

test.skip(!doCfg.needed, 'DigitalOcean credentials run only with the npm run do:* commands (DO=1)');
test.describe.configure({ mode: 'serial' });

/** A browser context for the control panel, reusing the saved DigitalOcean session if there is one. */
async function panel(browser: import('@playwright/test').Browser) {
  const context = await browser.newContext({ storageState: fs.existsSync(DO_AUTH_FILE) ? DO_AUTH_FILE : undefined });
  return { context, doc: new DoConsole(await context.newPage()) };
}

test('1. DigitalOcean API token (reused if it still works, else created)', async ({ browser }) => {
  test.setTimeout(doCfg.manualWaitMs + 15 * 60_000);
  const creds: DoCredentials = loadCredentials();

  if (!doCfg.newCredentials && (await tokenWorks(creds.token))) {
    console.log(`Reusing the saved API token "${creds.tokenName ?? '?'}" (still works).`);
    return;
  }
  console.log(creds.token ? 'The saved API token no longer works - creating a new one.' : 'No saved API token - creating one.');

  const { context, doc } = await panel(browser);
  try {
    const name = `${doCfg.tokenName}-${new Date().toISOString().slice(0, 10)}`;
    const token = await test.step(`API -> Tokens -> Generate New Token "${name}" (${doCfg.tokenExpiry}, full access)`, () =>
      doc.createApiToken(name, doCfg.tokenExpiry));
    await test.step('Token works (GET /v2/account)', async () => {
      expect(await tokenWorks(token), 'the new token is rejected by the DigitalOcean API').toBe(true);
    });
    saveCredentials({ ...loadCredentials(), token, tokenName: name });
    console.log(`Saved the new API token to ${doCfg.credentialsFile}`);
  } finally {
    await context.close();
  }
});

test('2. Spaces access key (reused if it still works, else created)', async ({ browser }) => {
  test.setTimeout(doCfg.manualWaitMs + 15 * 60_000);
  const creds = loadCredentials();

  if (!doCfg.newCredentials && (await spacesKeyWorks(creds))) {
    console.log(`Reusing the saved Spaces access key ${creds.spacesAccessKey} (still works).`);
  } else {
    console.log(creds.spacesAccessKey ? 'The saved Spaces key no longer works - creating a new one.' : 'No saved Spaces key - creating one.');
    const { context, doc } = await panel(browser);
    try {
      const name = `${doCfg.spacesKeyName}-${new Date().toISOString().slice(0, 10)}`;
      const key = await test.step(`Spaces -> Access Keys -> Create Access Key "${name}" (full access)`, () => doc.createSpacesKey(name));
      saveCredentials({ ...loadCredentials(), spacesAccessKey: key.accessKey, spacesSecretKey: key.secretKey, spacesKeyName: name });
      // A new key can take a few seconds before Spaces accepts it.
      await test.step('Spaces key works (S3 ListBuckets)', async () => {
        await expect.poll(() => spacesKeyWorks(loadCredentials()), { timeout: 60_000, intervals: [5_000] }).toBe(true);
      });
      console.log(`Saved the new Spaces access key ${key.accessKey} to ${doCfg.credentialsFile}`);
    } finally {
      await context.close();
    }
  }

  await test.step('All three pipeline inputs are ready', async () => {
    expectValidCredentials(loadCredentials());
  });
});
