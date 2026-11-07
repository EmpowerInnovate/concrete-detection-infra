import { defineConfig } from '@playwright/test';
import path from 'node:path';
import dotenv from 'dotenv';
import { AUTH_FILE } from './lib/paths';

dotenv.config({ path: path.join(__dirname, '.env') });

// One run ID shared by the main process and every worker, so all tests use the
// same generated service-account ID.
process.env.E2E_RUN_ID ??= Date.now().toString(36);

export default defineConfig({
  testDir: './tests',
  // The tests create real cloud resources and depend on each other: run them one at a time.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // The GCP Console is slow; role assignment in particular can take a while.
  timeout: 5 * 60_000,
  expect: { timeout: 30_000 },
  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    // Google sign-in rejects Playwright's bundled Chromium ("This browser may not be secure"),
    // so use the installed Google Chrome.
    channel: 'chrome',
    launchOptions: {
      args: ['--disable-blink-features=AutomationControlled'],
      ignoreDefaultArgs: ['--enable-automation'],
    },
    viewport: { width: 1600, height: 1000 },
    actionTimeout: 30_000,
    navigationTimeout: 90_000,
    acceptDownloads: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
      // Signing in to Google is done by hand, so this project always runs headed.
      use: { headless: false },
    },
    {
      name: 'gcp-console',
      testMatch: /.*\.spec\.ts/,
      dependencies: ['setup'],
      use: { storageState: AUTH_FILE },
    },
  ],
});
