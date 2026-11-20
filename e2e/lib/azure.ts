import { expect, type Frame, type Locator, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { azCfg } from './config';
import { announce, waitForAzureSignIn } from './signin';

// ---------------------------------------------------------------- saved credentials

export type AzureCredentials = {
  subscriptionId?: string;
  tenantId?: string;
  appName?: string;
  clientId?: string;
  clientSecret?: string;
  storageAccount?: string;
};

export const GUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
/** Client secret value as shown once by the Portal, e.g. "abc8Q~..." (40 characters). */
export const SECRET_RE = /(?<![A-Za-z0-9_.~-])[A-Za-z0-9_.-]{3}\dQ~[A-Za-z0-9_.~-]{34}(?![A-Za-z0-9_.~-])/;

/** Built-in role definition IDs (the same in every tenant). */
export const ROLES = {
  Contributor: 'b24988ac-6180-42a0-ab88-20f7382dd24c',
  'User Access Administrator': '18d7d88d-d35e-4fb5-a5c3-7773c20a72d9',
} as const;
export type RoleName = keyof typeof ROLES;

export function loadCredentials(): AzureCredentials {
  try {
    return JSON.parse(fs.readFileSync(azCfg.credentialsFile, 'utf8'));
  } catch {
    return {};
  }
}

export function saveCredentials(c: AzureCredentials): void {
  fs.mkdirSync(path.dirname(azCfg.credentialsFile), { recursive: true });
  fs.writeFileSync(azCfg.credentialsFile, JSON.stringify(c, null, 2) + '\n', { mode: 0o600 });
  fs.chmodSync(azCfg.credentialsFile, 0o600);
}

// ---------------------------------------------------------------- Azure APIs (from this computer)

const ARM = 'https://management.azure.com';

/**
 * Tenant of a subscription without signing in: ARM answers an anonymous request with 401 and a
 * WWW-Authenticate header that names the tenant's authority (login.windows.net/<tenant-id>).
 */
export async function tenantOfSubscription(subscriptionId: string): Promise<string> {
  const r = await fetch(`${ARM}/subscriptions/${subscriptionId}?api-version=2022-12-01`);
  const header = r.headers.get('www-authenticate') ?? '';
  const tenant = header.match(/authorization_uri="https:\/\/login\.(?:windows\.net|microsoftonline\.com)\/([0-9a-f-]{36})"/i)?.[1];
  if (!tenant) throw new Error(`Could not find the tenant of subscription ${subscriptionId}. Check AZ_SUBSCRIPTION_ID, or set AZ_TENANT_ID.`);
  return tenant;
}

/** Service principal token for ARM (client credentials). Returns undefined if the secret is rejected. */
export async function armToken(c: AzureCredentials): Promise<{ token: string; objectId: string } | undefined> {
  if (!c.tenantId || !c.clientId || !c.clientSecret) return undefined;
  const r = await fetch(`https://login.microsoftonline.com/${c.tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: c.clientId,
      client_secret: c.clientSecret,
      grant_type: 'client_credentials',
      scope: `${ARM}/.default`,
    }),
  }).catch(() => undefined);
  if (!r?.ok) return undefined;
  const token = ((await r.json()) as { access_token: string }).access_token;
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  return { token, objectId: claims.oid };
}

async function arm<T>(token: string, urlPath: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const r = await fetch(`${ARM}${urlPath}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  const text = await r.text();
  return { status: r.status, body: (text ? JSON.parse(text) : {}) as T };
}

/** Subscription state ("Enabled", "Warned", "Disabled", ...) as the service principal sees it, or undefined if it can't read it. */
export async function subscriptionState(token: string, subscriptionId: string): Promise<string | undefined> {
  const r = await arm<{ state?: string }>(token, `/subscriptions/${subscriptionId}?api-version=2022-12-01`);
  return r.status === 200 ? r.body.state : undefined;
}

/** Which of the required roles the service principal has on the subscription. */
export async function rolesOf(c: AzureCredentials): Promise<Set<RoleName>> {
  const have = new Set<RoleName>();
  const t = await armToken(c);
  if (!t || !c.subscriptionId) return have;
  const r = await arm<{ value?: { properties: { roleDefinitionId: string; scope: string } }[] }>(
    t.token,
    `/subscriptions/${c.subscriptionId}/providers/Microsoft.Authorization/roleAssignments` +
      `?api-version=2022-04-01&$filter=${encodeURIComponent(`principalId eq '${t.objectId}'`)}`,
  );
  if (r.status !== 200) return have; // no read access yet = no Contributor yet
  for (const a of r.body.value ?? []) {
    const scopeOk = a.properties.scope.toLowerCase() === `/subscriptions/${c.subscriptionId}`.toLowerCase();
    for (const [name, id] of Object.entries(ROLES) as [RoleName, string][]) {
      if (scopeOk && a.properties.roleDefinitionId.toLowerCase().endsWith(id)) have.add(name);
    }
  }
  return have;
}

/** Default storage account name: "cracktf" + the first 12 hex characters of the subscription ID. */
export function defaultStorageAccount(subscriptionId: string): string {
  return `cracktf${subscriptionId.replace(/-/g, '').slice(0, 12).toLowerCase()}`;
}

/** 'ours' if the storage account already exists in this subscription, 'free' if the name is available, else 'taken'. */
export async function storageAccountStatus(token: string, subscriptionId: string, name: string): Promise<'ours' | 'free' | 'taken'> {
  const list = await arm<{ value?: { name: string }[] }>(
    token, `/subscriptions/${subscriptionId}/providers/Microsoft.Storage/storageAccounts?api-version=2023-01-01`);
  if ((list.body.value ?? []).some((a) => a.name === name)) return 'ours';
  const check = await arm<{ nameAvailable?: boolean }>(
    token, `/subscriptions/${subscriptionId}/providers/Microsoft.Storage/checkNameAvailability?api-version=2023-01-01`,
    { method: 'POST', body: JSON.stringify({ name, type: 'Microsoft.Storage/storageAccounts' }) });
  return check.body.nameAvailable ? 'free' : 'taken';
}

// ---------------------------------------------------------------- Azure Portal

const PORTAL = 'https://portal.azure.com';

/**
 * Page object for the Azure Portal: app registration, client secret, role assignments.
 *
 * The Portal draws many blades inside iframes and changes them now and then, so every lookup checks
 * all frames, every click is "best effort", and the result is confirmed afterwards (value read from
 * the page, or verified with the Azure APIs). If a click doesn't land, the test tells you exactly what
 * to do by hand and continues as soon as the result is there.
 */
export class AzurePortal {
  constructor(readonly page: Page) {}

  async goto(hashPath: string): Promise<void> {
    const url = `${PORTAL}/${hashPath}`;
    // Same URL again (e.g. the IAM blade for the second role): a hash-only goto would not reload the blade.
    if (this.page.url() === url) await this.page.reload({ waitUntil: 'domcontentloaded' });
    else await this.page.goto(url, { waitUntil: 'domcontentloaded' });
    if (await waitForAzureSignIn(this.page)) {
      await this.page.goto(url, { waitUntil: 'domcontentloaded' });
    }
    // Blades load after the shell; give the content a moment.
    await this.page.waitForTimeout(5_000);
  }

  private frames(): (Page | Frame)[] {
    return [this.page, ...this.page.frames().filter((f) => f !== this.page.mainFrame())];
  }

  /** First visible element in any frame for any of the locator builders. */
  private async find(builders: ((f: Page | Frame) => Locator)[], timeoutMs = 10_000): Promise<Locator | undefined> {
    const deadline = Date.now() + timeoutMs;
    do {
      for (const f of this.frames()) {
        for (const build of builders) {
          const el = build(f).first();
          if (await el.isVisible().catch(() => false)) return el;
        }
      }
      await this.page.waitForTimeout(500);
    } while (Date.now() < deadline);
    return undefined;
  }

  private async click(builders: ((f: Page | Frame) => Locator)[], timeoutMs = 10_000): Promise<boolean> {
    const el = await this.find(builders, timeoutMs);
    if (!el) return false;
    await el.click().catch(() => {});
    return true;
  }

  private async fill(builders: ((f: Page | Frame) => Locator)[], value: string, timeoutMs = 10_000): Promise<boolean> {
    const el = await this.find(builders, timeoutMs);
    if (!el) return false;
    await el.fill(value).catch(() => {});
    return true;
  }

  /** Visible text + input values of all frames. */
  async allText(): Promise<string> {
    const parts = await Promise.all(
      this.frames().map((f) =>
        f.locator('body').evaluate((b) =>
          `${(b as HTMLElement).innerText}\n${[...b.querySelectorAll('input, textarea')].map((i) => (i as HTMLInputElement).value).join('\n')}`,
        ).catch(() => ''),
      ),
    );
    return parts.join('\n');
  }

  /** Poll until `check` returns a value; show `help` after `helpAfterMs`. */
  async waitFor<T>(check: () => Promise<T | undefined>, help: string[], helpAfterMs = 30_000): Promise<T> {
    const start = Date.now();
    let announced = false;
    while (Date.now() - start < azCfg.manualWaitMs + helpAfterMs) {
      const v = await check();
      if (v !== undefined) return v;
      if (!announced && Date.now() - start > helpAfterMs) {
        await this.page.bringToFront();
        announce([...help, `The test continues by itself once it is done. Waiting up to ${Math.round(azCfg.manualWaitMs / 60_000)} minutes...`]);
        announced = true;
      }
      await this.page.waitForTimeout(3_000);
    }
    throw new Error(`Timed out waiting in the Azure Portal. ${help.join(' ')}`);
  }

  // ---------------------------------------------------------------- app registration

  /** Client ID of the app registration `name`: an existing one is reused, a missing one is registered. */
  async ensureAppRegistration(name: string): Promise<string> {
    // Look for an existing registration first.
    await this.goto('#view/Microsoft_AAD_IAM/ActiveDirectoryMenuBlade/~/RegisteredApps');
    await this.click([(f) => f.getByRole('tab', { name: /all applications/i })], 5_000);
    await this.fill([(f) => f.getByPlaceholder(/search|start typing/i), (f) => f.getByRole('searchbox')], name, 10_000);
    await this.page.waitForTimeout(3_000);
    if (await this.click([(f) => f.getByRole('link', { name, exact: true }), (f) => f.getByText(name, { exact: true })], 8_000)) {
      console.log(`App registration "${name}" already exists - reusing it (not created again).`);
    } else {
      console.log(`App registration "${name}" not found - registering it.`);
      await this.goto('#view/Microsoft_AAD_RegisteredApps/CreateApplicationBlade/quickStartType~/null/isMSAApp~/false');
      await this.fill([
        (f) => f.getByLabel(/^\*?\s*name/i),
        (f) => f.getByRole('textbox', { name: /display name|^name/i }),
        (f) => f.locator('input[aria-label*="name" i]'),
      ], name, 20_000);
      await this.click([(f) => f.getByRole('button', { name: /^register$/i })], 10_000);
    }

    // Overview: "Application (client) ID".
    return this.waitFor(
      async () => {
        const text = await this.allText();
        if (!text.includes(name)) return undefined;
        return text.match(new RegExp(`Application \\(client\\) ID\\s*:?\\s*(${GUID_RE.source})`, 'i'))?.[1]?.toLowerCase();
      },
      [
        `ACTION NEEDED: open the app registration "${name}" in the Azure Portal`,
        `Microsoft Entra ID -> App registrations -> "${name}" (or New registration: name "${name}", single tenant -> Register).`,
        'Stay on its Overview page, where "Application (client) ID" is shown.',
      ],
    );
  }

  // ---------------------------------------------------------------- client secret

  /** Certificates & secrets -> New client secret. Returns the secret value (shown only once). */
  async createClientSecret(clientId: string, description: string, expiry: string): Promise<string> {
    await this.goto(`#view/Microsoft_AAD_RegisteredApps/ApplicationMenuBlade/~/Credentials/appId/${clientId}`);
    const before = new Set((await this.allText()).match(new RegExp(SECRET_RE, 'g')) ?? []);
    await this.click([(f) => f.getByRole('tab', { name: /client secrets/i })], 5_000);
    if (await this.click([(f) => f.getByRole('button', { name: /new client secret/i }), (f) => f.getByText(/new client secret/i)], 20_000)) {
      await this.fill([(f) => f.getByLabel(/description/i), (f) => f.getByRole('textbox', { name: /description/i })], description, 10_000);
      const expires = await this.find([(f) => f.getByRole('combobox', { name: /expires/i }), (f) => f.getByLabel(/expires/i)], 5_000);
      const wanted = new RegExp(expiry.replace(/\s+/g, '\\s*'), 'i');
      if (expires && (await expires.evaluate((e) => e.tagName).catch(() => '')) === 'SELECT') {
        const labels = await expires.locator('option').allInnerTexts();
        const label = labels.find((l) => wanted.test(l));
        if (label) await expires.selectOption({ label }).catch(() => {});
      } else if (expires) {
        await expires.click().catch(() => {});
        await this.click([(f) => f.getByRole('option', { name: wanted })], 5_000);
      }
      await this.click([(f) => f.getByRole('button', { name: /^add$/i })], 10_000);
    }
    return this.waitFor(
      async () => ((await this.allText()).match(new RegExp(SECRET_RE, 'g')) ?? []).find((s) => !before.has(s)),
      [
        'ACTION NEEDED: create a client secret in the Azure Portal',
        `App registration -> Certificates & secrets -> Client secrets -> New client secret: "${description}", expires ${expiry} -> Add.`,
        'Leave the new secret Value visible on the page (it is shown only once).',
      ],
    );
  }

  // ---------------------------------------------------------------- role assignment

  /**
   * Subscription -> Access control (IAM) -> Add role assignment: `role` for the service principal
   * `appName`. Best effort; the caller verifies the result with the Azure API.
   */
  async tryAssignRole(subscriptionId: string, role: RoleName, appName: string): Promise<void> {
    await this.goto(`#@/resource/subscriptions/${subscriptionId}/users`);
    if (!(await this.click([(f) => f.getByRole('menuitem', { name: /^\+?\s*add$/i }), (f) => f.getByRole('button', { name: /^\+?\s*add$/i })], 20_000))) return;
    if (!(await this.click([(f) => f.getByRole('menuitem', { name: /add role assignment/i }), (f) => f.getByText(/add role assignment/i)], 10_000))) return;
    // Contributor and User Access Administrator are "Privileged administrator roles".
    await this.click([(f) => f.getByRole('tab', { name: /privileged administrator roles/i })], 15_000);
    await this.fill([(f) => f.getByPlaceholder(/search by role name/i), (f) => f.getByRole('searchbox')], role, 10_000);
    await this.page.waitForTimeout(2_000);
    if (!(await this.click([(f) => f.getByRole('row', { name: new RegExp(`^\\s*${role}\\b`, 'i') }), (f) => f.getByRole('gridcell', { name: role, exact: true }), (f) => f.getByText(role, { exact: true })], 10_000))) return;
    await this.click([(f) => f.getByRole('button', { name: /^next$/i })], 5_000);
    // Members: service principal.
    await this.click([(f) => f.getByRole('radio', { name: /user, group, or service principal/i })], 5_000);
    if (!(await this.click([(f) => f.getByRole('link', { name: /select members/i }), (f) => f.getByRole('button', { name: /select members/i })], 10_000))) return;
    await this.fill([(f) => f.getByRole('textbox', { name: /select/i }), (f) => f.getByPlaceholder(/search by name/i)], appName, 10_000);
    await this.page.waitForTimeout(3_000);
    await this.click([(f) => f.getByRole('option', { name: new RegExp(appName, 'i') }), (f) => f.getByRole('listitem').filter({ hasText: appName }), (f) => f.getByText(appName, { exact: true })], 10_000);
    await this.click([(f) => f.getByRole('button', { name: /^select$/i })], 10_000);
    if (role === 'User Access Administrator') {
      // Conditions: allow assigning roles except the privileged administrator ones (what AKS needs).
      await this.click([(f) => f.getByRole('button', { name: /^next$/i })], 5_000);
      await this.click([(f) => f.getByRole('radio', { name: /all roles except privileged administrator roles/i })], 10_000);
    }
    // "Review + assign" twice (tab, then confirm).
    for (let i = 0; i < 3; i++) {
      if (!(await this.click([(f) => f.getByRole('button', { name: /review \+ assign/i })], 8_000))) break;
      await this.page.waitForTimeout(3_000);
    }
  }
}

/** Sanity check used by the tests. */
export function expectValidCredentials(c: AzureCredentials) {
  expect(c.subscriptionId, 'subscription ID').toMatch(GUID_RE);
  expect(c.tenantId, 'tenant ID').toMatch(GUID_RE);
  expect(c.clientId, 'client ID').toMatch(GUID_RE);
  expect(c.clientSecret, 'client secret').toBeTruthy();
  expect(c.storageAccount, 'storage account').toMatch(/^[a-z0-9]{3,24}$/);
}
