import { expect, type Locator, type Page } from '@playwright/test';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { doCfg } from './config';
import { announce, waitForDoSignIn } from './signin';

// ---------------------------------------------------------------- saved credentials

export type DoCredentials = {
  token?: string;
  tokenName?: string;
  spacesAccessKey?: string;
  spacesSecretKey?: string;
  spacesKeyName?: string;
};

/** API token: "dop_v1_" + 64 hex characters. */
export const TOKEN_RE = /dop_v1_[0-9a-f]{64}/;
/** Spaces access key ID: "DO" + 18 upper-case letters/digits (20 characters). */
export const ACCESS_KEY_RE = /\bDO[0-9A-Z]{18}\b/;
/** Spaces secret: 43 base64 characters. */
export const SECRET_RE = /(?<![A-Za-z0-9+/])[A-Za-z0-9+/]{43}(?![A-Za-z0-9+/=])/;

export function loadCredentials(): DoCredentials {
  try {
    return JSON.parse(fs.readFileSync(doCfg.credentialsFile, 'utf8'));
  } catch {
    return {};
  }
}

export function saveCredentials(c: DoCredentials): void {
  fs.mkdirSync(path.dirname(doCfg.credentialsFile), { recursive: true });
  fs.writeFileSync(doCfg.credentialsFile, JSON.stringify(c, null, 2) + '\n', { mode: 0o600 });
  fs.chmodSync(doCfg.credentialsFile, 0o600);
}

// ---------------------------------------------------------------- checks (from this computer)

/** True if the API token works (GET /v2/account). */
export async function tokenWorks(token: string | undefined): Promise<boolean> {
  if (!token || !TOKEN_RE.test(token)) return false;
  try {
    const r = await fetch('https://api.digitalocean.com/v2/account', { headers: { Authorization: `Bearer ${token}` } });
    return r.ok;
  } catch {
    return false;
  }
}

/** AWS Signature V4 for GET / (S3 ListBuckets) on a Spaces endpoint. */
export function signListBuckets(accessKey: string, secretKey: string, region: string, now = new Date()) {
  const host = `${region}.digitaloceanspaces.com`;
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ''); // 20250101T000000Z
  const date = amzDate.slice(0, 8);
  const payloadHash = crypto.createHash('sha256').update('').digest('hex');
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = ['GET', '/', '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  // DigitalOcean Spaces accepts "us-east-1" as the signing region for every datacenter.
  const scope = `${date}/us-east-1/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, crypto.createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');
  const hmac = (key: crypto.BinaryLike, data: string) => crypto.createHmac('sha256', key).update(data).digest();
  let k = hmac(`AWS4${secretKey}`, date);
  for (const part of ['us-east-1', 's3', 'aws4_request']) k = hmac(k, part);
  const signature = crypto.createHmac('sha256', k).update(stringToSign).digest('hex');
  return {
    url: `https://${host}/`,
    headers: {
      'x-amz-date': amzDate,
      'x-amz-content-sha256': payloadHash,
      Authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}

/** Calls Spaces' S3 API (ListBuckets) with a signed request. */
export async function spacesListBuckets(accessKey: string, secretKey: string, region: string): Promise<Response> {
  const { url, headers } = signListBuckets(accessKey, secretKey, region);
  return fetch(url, { headers });
}

/** True if the Spaces key pair is accepted. */
export async function spacesKeyWorks(c: DoCredentials, region = doCfg.region): Promise<boolean> {
  if (!c.spacesAccessKey || !c.spacesSecretKey) return false;
  try {
    return (await spacesListBuckets(c.spacesAccessKey, c.spacesSecretKey, region)).ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- control panel

const PANEL = 'https://cloud.digitalocean.com';

/**
 * Page object for the DigitalOcean control panel: API tokens and Spaces access keys.
 *
 * DigitalOcean changes its UI from time to time, so every click is "best effort": the value is read
 * from the page as soon as DigitalOcean shows it. If a click doesn't land, the test asks you to do
 * that step by hand and still picks up the value automatically.
 */
export class DoConsole {
  constructor(readonly page: Page) {}

  async goto(urlPath: string): Promise<void> {
    await this.page.goto(PANEL + urlPath, { waitUntil: 'domcontentloaded' });
    if (await waitForDoSignIn(this.page)) {
      await this.page.goto(PANEL + urlPath, { waitUntil: 'domcontentloaded' });
    }
    await this.page.waitForLoadState('load', { timeout: 30_000 }).catch(() => {});
  }

  /** Click the first visible match, if there is one. */
  private async tryClick(...candidates: Locator[]): Promise<boolean> {
    for (const c of candidates) {
      const el = c.first();
      if (await el.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await el.click().catch(() => {});
        return true;
      }
    }
    return false;
  }

  /** All visible text plus the values of inputs/textareas (secrets are often shown in a read-only input). */
  private async pageText(scope?: Locator): Promise<string> {
    const root = scope ?? this.page.locator('body');
    return root
      .evaluate((el) => {
        const values = [...el.querySelectorAll('input, textarea')].map((i) => (i as HTMLInputElement).value);
        return `${(el as HTMLElement).innerText}\n${values.join('\n')}`;
      })
      .catch(() => '');
  }

  /** Poll the page until `pick` finds the value; announce `help` if it takes longer than `helpAfterMs`. */
  private async waitForValue<T>(pick: () => Promise<T | undefined>, help: string[], helpAfterMs = 20_000): Promise<T> {
    const start = Date.now();
    let announced = false;
    while (Date.now() - start < doCfg.manualWaitMs + helpAfterMs) {
      const v = await pick();
      if (v) return v;
      if (!announced && Date.now() - start > helpAfterMs) {
        await this.page.bringToFront();
        announce([...help, `The test reads the value from the page once it is shown. Waiting up to ${Math.round(doCfg.manualWaitMs / 60_000)} minutes...`]);
        announced = true;
      }
      await this.page.waitForTimeout(2_000);
    }
    throw new Error(`Timed out waiting for DigitalOcean to show the value. ${help.join(' ')}`);
  }

  // ---------------------------------------------------------------- API token

  /** API -> Tokens -> Generate New Token (full access). Returns the token (shown only once). */
  async createApiToken(name: string, expiry: string): Promise<string> {
    await this.goto('/account/api/tokens');
    const before = new Set((await this.pageText()).match(new RegExp(TOKEN_RE, 'g')) ?? []);

    if (await this.tryClick(
      this.page.getByRole('button', { name: /generate new token/i }),
      this.page.getByRole('link', { name: /generate new token/i }),
      this.page.getByText(/generate new token/i),
    )) {
      const nameInput = this.page
        .getByLabel(/token name/i)
        .or(this.page.getByPlaceholder(/token name|name/i))
        .or(this.page.locator('input[name*="name" i]'))
        .first();
      if (await nameInput.isVisible({ timeout: 10_000 }).catch(() => false)) await nameInput.fill(name);

      // Expiration: a <select> or a custom dropdown.
      const select = this.page.getByLabel(/expiration/i).or(this.page.locator('select')).first();
      if (await select.isVisible({ timeout: 3_000 }).catch(() => false)) {
        const tag = await select.evaluate((e) => e.tagName.toLowerCase()).catch(() => '');
        if (tag === 'select') await select.selectOption({ label: expiry }).catch(() => {});
        else if (await this.tryClick(select)) await this.tryClick(this.page.getByRole('option', { name: expiry }), this.page.getByText(expiry, { exact: true }));
      }

      // Scopes: Full Access.
      await this.tryClick(
        this.page.getByRole('radio', { name: /full access/i }),
        this.page.getByLabel(/full access/i),
        this.page.getByText(/^full access$/i),
      );

      await this.tryClick(
        this.page.getByRole('button', { name: /^generate token$/i }),
        this.page.getByRole('button', { name: /generate/i }).last(),
      );
    }

    return this.waitForValue(
      async () => ((await this.pageText()).match(new RegExp(TOKEN_RE, 'g')) ?? []).find((t) => !before.has(t)),
      [
        'ACTION NEEDED: create the DigitalOcean API token in the Chrome window',
        `API -> Tokens -> Generate New Token: name "${name}", expiration ${expiry}, scopes Full Access -> Generate Token.`,
      ],
    );
  }

  // ---------------------------------------------------------------- Spaces access key

  /** Spaces Object Storage -> Access Keys -> Create Access Key (full access). Returns ID + secret (secret shown once). */
  async createSpacesKey(name: string): Promise<{ accessKey: string; secretKey: string }> {
    await this.goto('/spaces/access_keys');
    const before = new Set((await this.pageText()).match(new RegExp(ACCESS_KEY_RE, 'g')) ?? []);

    if (await this.tryClick(
      this.page.getByRole('button', { name: /create access key/i }),
      this.page.getByRole('link', { name: /create access key/i }),
      this.page.getByRole('button', { name: /generate new key/i }),
    )) {
      await this.tryClick(
        this.page.getByRole('radio', { name: /full access/i }),
        this.page.getByLabel(/full access/i),
        this.page.getByText(/^full access$/i),
      );
      const nameInput = this.page
        .getByLabel(/access key name|key name|name/i)
        .or(this.page.getByPlaceholder(/name/i))
        .filter({ visible: true })
        .first();
      if (await nameInput.isVisible({ timeout: 5_000 }).catch(() => false)) await nameInput.fill(name);
      await this.tryClick(
        this.page.getByRole('dialog').getByRole('button', { name: /create access key/i }),
        this.page.getByRole('button', { name: /create access key/i }).last(),
        this.page.getByRole('button', { name: /^create$/i }),
      );
    }

    return this.waitForValue(
      async () => {
        // Prefer the dialog/panel that shows the new key; fall back to the whole page.
        const dialog = this.page.getByRole('dialog').filter({ visible: true }).last();
        const scope = (await dialog.isVisible().catch(() => false)) ? dialog : undefined;
        const text = await this.pageText(scope);
        const accessKey = (text.match(new RegExp(ACCESS_KEY_RE, 'g')) ?? []).find((k) => !before.has(k));
        if (!accessKey) return undefined;
        const secrets = (text.match(new RegExp(SECRET_RE, 'g')) ?? []).filter((s) => !s.startsWith(accessKey));
        if (secrets.length !== 1) return undefined; // not shown yet, or ambiguous
        return { accessKey, secretKey: secrets[0] };
      },
      [
        'ACTION NEEDED: create the Spaces access key in the Chrome window',
        `Spaces Object Storage -> Access Keys -> Create Access Key: Full Access, name "${name}" -> Create.`,
        'Leave the new Access Key ID and Secret visible on the page (the secret is shown only once).',
      ],
    );
  }
}

/** Sanity check used by the tests. */
export function expectValidCredentials(c: DoCredentials) {
  expect(c.token, 'API token').toMatch(TOKEN_RE);
  expect(c.spacesAccessKey, 'Spaces access key').toMatch(ACCESS_KEY_RE);
  expect(c.spacesSecretKey, 'Spaces secret key').toMatch(SECRET_RE);
}
