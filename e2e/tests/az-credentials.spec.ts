import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { azCfg } from '../lib/config';
import {
  AzurePortal, ROLES, armToken, defaultStorageAccount, expectValidCredentials, loadCredentials,
  rolesOf, saveCredentials, storageAccountStatus, subscriptionState, tenantOfSubscription,
  type AzureCredentials, type RoleName,
} from '../lib/azure';
import { AZ_AUTH_FILE } from '../lib/paths';

/**
 * Azure credentials for the "Deploy Kubernetes Cluster" pipeline (provider = azure):
 *   1. Service principal (app registration) + client secret  -> azure_client_id, azure_client_secret
 *   2. Contributor + User Access Administrator on the subscription
 *   3. Subscription is Enabled; storage account name for the Terraform state is free or ours
 *      (the pipeline creates the account, its resource group and the tfstate container itself)
 *
 * Saved credentials (output/azure-credentials.json, gitignored) are reused while they still work and
 * every result is verified with the Azure APIs, so nothing is created twice. The Portal is opened only
 * when something is missing (you sign in by hand when asked). AZ_NEW_SECRET=true makes a new secret.
 */

test.skip(!azCfg.needed, 'Azure credentials run only with the npm run az:* commands (AZ=1)');
test.describe.configure({ mode: 'serial' });

async function portal(browser: import('@playwright/test').Browser) {
  const context = await browser.newContext({ storageState: fs.existsSync(AZ_AUTH_FILE) ? AZ_AUTH_FILE : undefined });
  return { context, az: new AzurePortal(await context.newPage()) };
}

test('1. service principal + client secret (reused if the secret still works, else created)', async ({ browser }) => {
  test.setTimeout(azCfg.manualWaitMs * 2 + 15 * 60_000);
  if (!azCfg.subscriptionId) {
    throw new Error('Set AZ_SUBSCRIPTION_ID in e2e/.env (Azure Portal -> Subscriptions -> Subscription ID).');
  }
  const tenantId = azCfg.tenantId || (await tenantOfSubscription(azCfg.subscriptionId));
  let creds: AzureCredentials = { ...loadCredentials(), subscriptionId: azCfg.subscriptionId, tenantId, appName: azCfg.appName };
  console.log(`Subscription ${azCfg.subscriptionId}, tenant ${tenantId}.`);

  const sameApp = loadCredentials().appName === azCfg.appName;
  if (!azCfg.newSecret && sameApp && (await armToken(creds))) {
    console.log(`Reusing service principal "${azCfg.appName}" (${creds.clientId}) - its saved secret still works.`);
    saveCredentials(creds);
    return;
  }
  console.log(creds.clientSecret && sameApp ? 'The saved client secret no longer works - creating a new one.' : 'No saved client secret - creating one.');

  const { context, az } = await portal(browser);
  try {
    const clientId = await test.step(`App registration "${azCfg.appName}" (created only if missing)`, () => az.ensureAppRegistration(azCfg.appName));
    const secret = await test.step(`Certificates & secrets -> New client secret (${azCfg.secretExpiry})`, () =>
      az.createClientSecret(clientId, `crack-detection-${new Date().toISOString().slice(0, 10)}`, azCfg.secretExpiry));
    creds = { ...creds, clientId, clientSecret: secret };
    saveCredentials(creds);
    await test.step('The secret works (token from Microsoft Entra ID)', async () => {
      // A new secret can take a minute before Entra ID accepts it.
      await expect.poll(async () => !!(await armToken(creds)), { timeout: 180_000, intervals: [10_000] }).toBe(true);
    });
    console.log(`Saved service principal ${clientId} and its new secret to ${azCfg.credentialsFile}`);
  } finally {
    await context.close();
  }
});

test('2. Contributor + User Access Administrator on the subscription (missing ones are assigned)', async ({ browser }) => {
  test.setTimeout(azCfg.manualWaitMs * 3 + 20 * 60_000);
  const creds = loadCredentials();
  let have = await rolesOf(creds);
  const missing = (Object.keys(ROLES) as RoleName[]).filter((r) => !have.has(r));
  if (!missing.length) {
    console.log(`"${creds.appName}" already has Contributor and User Access Administrator on the subscription.`);
  } else {
    console.log(`"${creds.appName}" is missing: ${missing.join(', ')} - assigning in the Azure Portal.`);
    const { context, az } = await portal(browser);
    try {
      for (const role of missing) {
        await test.step(`Access control (IAM) -> Add role assignment: ${role}`, async () => {
          await az.tryAssignRole(creds.subscriptionId!, role, creds.appName!);
          await az.waitFor(
            async () => ((await rolesOf(creds)).has(role) ? true : undefined),
            [
              `ACTION NEEDED: give "${creds.appName}" the role ${role} on the subscription`,
              `Subscriptions -> ${creds.subscriptionId} -> Access control (IAM) -> Add -> Add role assignment ->`,
              `Privileged administrator roles: ${role} -> Next -> Select members: "${creds.appName}" -> Review + assign` +
                (role === 'User Access Administrator' ? ' (Conditions: "Allow user to assign all roles except privileged administrator roles").' : '.'),
            ],
            60_000,
          );
          console.log(`  ${role}: assigned.`);
        });
      }
    } finally {
      await context.close();
    }
    have = await rolesOf(creds);
  }
  expect([...have].sort(), 'roles of the service principal on the subscription').toEqual(Object.keys(ROLES).sort());
});

test('3. subscription is Enabled, storage account name for the Terraform state is ready', async () => {
  const creds = loadCredentials();
  const t = await armToken(creds);
  expect(t, 'service principal token').toBeTruthy();

  await test.step('Subscription state is Enabled', async () => {
    const state = await subscriptionState(t!.token, creds.subscriptionId!);
    expect(
      state,
      `Subscription ${creds.subscriptionId} is "${state}" - it must be Enabled (a disabled/warned subscription is read-only: billing, ended trial or spending limit).`,
    ).toBe('Enabled');
  });

  const name = azCfg.storageAccount || creds.storageAccount || defaultStorageAccount(creds.subscriptionId!);
  await test.step(`Storage account "${name}" is ours or free`, async () => {
    expect(name, 'storage account names are 3-24 lowercase letters/digits').toMatch(/^[a-z0-9]{3,24}$/);
    const status = await storageAccountStatus(t!.token, creds.subscriptionId!, name);
    console.log(
      status === 'ours' ? `Storage account "${name}" exists in this subscription - the pipeline reuses it.`
        : status === 'free' ? `Storage account name "${name}" is free - the pipeline creates it (with its resource group and tfstate container).`
          : '',
    );
    expect(status, `Storage account name "${name}" is taken by someone else. Set another one in AZ_STORAGE_ACCOUNT.`).not.toBe('taken');
  });
  saveCredentials({ ...creds, storageAccount: name });
  expectValidCredentials(loadCredentials());
});
