import { test as setup } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { AUTH_FILE } from '../lib/paths';

/**
 * One-time Google sign-in. Google blocks scripted logins (CAPTCHA, 2FA, "browser not secure"),
 * so a person signs in by hand in the opened Chrome window and the session cookies are saved
 * to .auth/gcp-user.json for the real tests to reuse.
 *
 * Skipped when a saved session exists. Use `npm run auth` to sign in again.
 */
setup.skip(fs.existsSync(AUTH_FILE) && !process.env.FORCE_AUTH, 'Reusing saved Google session');

setup('sign in to the Google Cloud Console', async ({ page }) => {
  setup.setTimeout(10 * 60_000);

  await page.goto('https://console.cloud.google.com/');
  console.log('\n>>> Sign in to Google in the opened Chrome window. Waiting up to 10 minutes...\n');

  // Done when we land on the Console itself (not accounts.google.com).
  await page.waitForURL((url) => url.hostname === 'console.cloud.google.com', { timeout: 10 * 60_000 });
  await page.waitForLoadState('domcontentloaded');

  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
  await page.context().storageState({ path: AUTH_FILE });
  fs.chmodSync(AUTH_FILE, 0o600);
  console.log(`Saved Google session to ${AUTH_FILE}`);
});
