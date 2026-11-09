import { test as setup } from '@playwright/test';
import fs from 'node:fs';
import { githubCfg } from '../lib/config';
import { AUTH_FILE, GITHUB_AUTH_FILE } from '../lib/paths';
import { SIGN_IN_WAIT_MS, githubUser, saveSession, waitForGitHubSignIn, waitForGoogleSignIn } from '../lib/signin';

/**
 * Sign-in, done by hand. The saved session in .auth/ is tried first; if it still works,
 * nothing is asked. Otherwise the terminal says "ACTION NEEDED", you sign in in the Chrome
 * window, and the session is saved for the real tests to reuse.
 *
 * `npm run auth` forces a fresh sign-in (FORCE_AUTH=1).
 */

const savedState = (file: string) => (fs.existsSync(file) && !process.env.FORCE_AUTH ? file : undefined);

setup('sign in to the Google Cloud Console', async ({ browser }) => {
  setup.setTimeout(SIGN_IN_WAIT_MS + 2 * 60_000);
  const context = await browser.newContext({ storageState: savedState(AUTH_FILE) });
  const page = await context.newPage();

  await page.goto('https://console.cloud.google.com/', { waitUntil: 'domcontentloaded' });
  if (!(await waitForGoogleSignIn(page))) {
    console.log('Google session is still valid - no sign-in needed.');
    await saveSession(page, AUTH_FILE); // refresh cookies
  }
  await context.close();
});

setup('sign in to GitHub', async ({ browser }) => {
  setup.skip(!githubCfg.needed, 'GitHub is only needed for the pipelines (CLUSTER=1 or APP_SA=1)');
  setup.setTimeout(SIGN_IN_WAIT_MS + 2 * 60_000);
  const context = await browser.newContext({ storageState: savedState(GITHUB_AUTH_FILE) });
  const page = await context.newPage();

  await page.goto('https://github.com/', { waitUntil: 'domcontentloaded' });
  if (!(await waitForGitHubSignIn(page, githubCfg.repo))) {
    console.log(`GitHub: still signed in as ${await githubUser(page)}.`);
    await saveSession(page, GITHUB_AUTH_FILE);
  }
  await context.close();
});
