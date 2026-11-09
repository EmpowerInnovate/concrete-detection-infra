import type { Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { AUTH_FILE, GITHUB_AUTH_FILE } from './paths';

/**
 * Manual sign-in. Google and GitHub block scripted logins (CAPTCHA, 2FA, "browser not secure"),
 * so nothing here ever types a password. When a session is missing or expires, the terminal
 * prints "ACTION NEEDED", you sign in in the Chrome window, and the run continues by itself.
 */

export const SIGN_IN_WAIT_MS = 10 * 60_000;

const headless = () => (process.env.HEADLESS ?? 'false').toLowerCase() === 'true';

export function announce(lines: string[]) {
  const bar = '='.repeat(72);
  // \x07 rings the terminal bell so you notice even if the window is in the background.
  console.log(`\n\x07${bar}\n${lines.map((l) => `  ${l}`).join('\n')}\n${bar}\n`);
}

export async function saveSession(page: Page, file: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.context().storageState({ path: file });
  fs.chmodSync(file, 0o600);
  console.log(`Saved session to ${path.relative(process.cwd(), file)}`);
}

// ---------------------------------------------------------------- Google

export const onGoogleConsole = (page: Page) => new URL(page.url()).hostname === 'console.cloud.google.com';

/**
 * Call after navigating to a Console URL. If Google sent us to the sign-in page, wait for you
 * to sign in by hand, save the session, and return true (the caller should navigate again).
 */
export async function waitForGoogleSignIn(page: Page): Promise<boolean> {
  // The Console redirects to sign-in client-side, sometimes a moment after load.
  await page.waitForTimeout(2_000);
  if (onGoogleConsole(page)) return false;

  if (headless()) {
    throw new Error('Google session expired or missing. Run `npm run auth` in e2e/ (or run with HEADLESS=false) and sign in.');
  }
  await page.bringToFront();
  announce([
    'ACTION NEEDED: sign in to Google Cloud',
    'Sign in in the Chrome window, with the Google account that owns the GCP project.',
    'The run continues by itself once the Cloud Console opens. Waiting up to 10 minutes...',
  ]);
  await page.waitForURL((u) => u.hostname === 'console.cloud.google.com', { timeout: SIGN_IN_WAIT_MS });
  await page.waitForLoadState('domcontentloaded');
  console.log('Google: signed in.');
  await saveSession(page, AUTH_FILE);
  return true;
}

// ---------------------------------------------------------------- GitHub

export async function githubUser(page: Page): Promise<string> {
  return (
    (await page.locator('meta[name="user-login"]').getAttribute('content', { timeout: 5_000 }).catch(() => '')) ?? ''
  );
}

/**
 * Call after navigating to a GitHub URL. If you're not signed in, open the login page, wait for
 * you to sign in by hand, save the session, and return true (the caller should navigate again).
 */
export async function waitForGitHubSignIn(page: Page, repo: string): Promise<boolean> {
  if (await githubUser(page)) return false;

  if (headless()) {
    throw new Error('GitHub session expired or missing. Run `npm run auth` in e2e/ (or run with HEADLESS=false) and sign in.');
  }
  await page.goto('https://github.com/login', { waitUntil: 'domcontentloaded' });
  await page.bringToFront();
  announce([
    'ACTION NEEDED: sign in to GitHub',
    `Sign in in the Chrome window with an account that can run workflows in ${repo}.`,
    'The run continues by itself once you are in. Waiting up to 10 minutes...',
  ]);
  // GitHub leaves /login and /sessions/* (2FA) once you are signed in.
  await page.waitForURL((u) => u.hostname === 'github.com' && !/^\/(login|sessions)/.test(u.pathname), {
    timeout: SIGN_IN_WAIT_MS,
  });
  await page.waitForLoadState('domcontentloaded');
  const user = await githubUser(page);
  if (!user) throw new Error('GitHub sign-in did not complete.');
  console.log(`GitHub: signed in as ${user}.`);
  await saveSession(page, GITHUB_AUTH_FILE);
  return true;
}
