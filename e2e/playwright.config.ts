import { defineConfig } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { AUTH_FILE, DO_AUTH_FILE, GITHUB_AUTH_FILE } from './lib/paths';

dotenv.config({ path: path.join(__dirname, '.env') });

// One run ID shared by the main process and every worker, so all tests use the
// same generated service-account ID.
process.env.E2E_RUN_ID ??= Date.now().toString(36);

// Headed by default: you watch the browser and sign in when the terminal says ACTION NEEDED.
const headless = (process.env.HEADLESS ?? 'false').toLowerCase() === 'true';
const fullFlow = process.env.FULL_FLOW === '1';
const appSa = process.env.APP_SA === '1';
const doFullFlow = process.env.DO_FULL_FLOW === '1';

export default defineConfig({
  testDir: './tests',
  // The tests create real cloud resources and depend on each other: run them one at a time.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // The GCP Console is slow (the IAM page alone can spin for minutes), so allow 15 min per test.
  timeout: 15 * 60_000,
  expect: { timeout: 30_000 },
  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    headless,
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
      // Signing in is done by hand, so this project always runs headed.
      use: { headless: false },
    },
    {
      // Admin service account + roles, then its JSON key + single-line base64.
      name: 'gcp-console',
      testMatch: /gcp-service-account\.spec\.ts/,
      dependencies: ['setup'],
      use: { storageState: AUTH_FILE },
    },
    {
      // Optional (APP_SA=1): "Setup GCP Service Account" pipeline, then the app account's key.
      name: 'app-sa',
      testMatch: /app-service-account\.spec\.ts/,
      dependencies: fullFlow ? ['gcp-console'] : ['setup'],
      use: { storageState: GITHUB_AUTH_FILE },
    },
    {
      // GKE cluster pipeline (CLUSTER=1). In the full flow it waits for the key steps above;
      // `npm run cluster` reuses the key already in output/.
      name: 'cluster',
      testMatch: /gke-cluster-pipeline\.spec\.ts/,
      dependencies: fullFlow ? [appSa ? 'app-sa' : 'gcp-console'] : ['setup'],
      use: { storageState: GITHUB_AUTH_FILE },
    },
    {
      // DigitalOcean: API token + Spaces access key (reused while they work, else created in the panel).
      name: 'do-console',
      testMatch: /do-credentials\.spec\.ts/,
      dependencies: ['setup'],
      use: { storageState: fs.existsSync(DO_AUTH_FILE) ? DO_AUTH_FILE : undefined },
    },
    {
      // DigitalOcean cluster pipeline (DO_CLUSTER=1). `npm run do:all` gets the credentials first;
      // `npm run do:cluster` reuses the ones already in output/do-credentials.json.
      name: 'do-cluster',
      testMatch: /do-cluster-pipeline\.spec\.ts/,
      dependencies: doFullFlow ? ['do-console'] : ['setup'],
      use: { storageState: GITHUB_AUTH_FILE },
    },
  ],
});
