import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import { cfg, keyFiles } from './config';
import type { GcpConsole } from './gcp-console';
import * as gcloud from './gcloud';

export type ServiceAccountKey = Record<string, string>;
type KeySource = 'existing file' | 'earlier run' | 'new';

/** Single-line base64 of the key file, the same as `base64 -w 0 key.json`. */
export function toSingleLineBase64(raw: string): string {
  return Buffer.from(raw, 'utf8').toString('base64');
}

function readKey(file: string): { raw: string; key: ServiceAccountKey } | undefined {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return { raw, key: JSON.parse(raw) };
  } catch {
    return undefined;
  }
}

/** Throws unless `key` is a JSON key of `email` in this project. */
export function expectValidKey(key: ServiceAccountKey, email: string) {
  expect(key).toMatchObject({
    type: 'service_account',
    project_id: cfg.projectId,
    client_email: email,
    token_uri: 'https://oauth2.googleapis.com/token',
  });
  expect(key.private_key_id).toMatch(/^[0-9a-f]{40}$/);
  expect(key.private_key).toContain('-----BEGIN PRIVATE KEY-----');
  expect(key.private_key).toContain('-----END PRIVATE KEY-----');
  expect(key.client_id).toMatch(/^\d+$/);
}

/**
 * Get a usable JSON key for an existing service account, then write its single-line base64.
 *
 * Google only lets you download a key when it is created; an old key can't be downloaded again.
 * So an "old key" means a key file you still have. In order:
 *   1. `explicitFile` (SA_KEY_FILE / APP_SA_KEY_FILE), if set
 *   2. output/<account>-key.json from an earlier run
 * A file is used only if it belongs to this account and the key is still active in the Console.
 * Otherwise (or with NEW_KEY=true) a new key is created and downloaded.
 *
 * Writes output/<account>-key.json and output/<account>-key.json.b64 (single line).
 */
export async function createOrReuseJsonKey(gcp: GcpConsole, accountId: string, email: string, explicitFile?: string) {
  const files = keyFiles(accountId);
  fs.mkdirSync(cfg.outputDir, { recursive: true });

  await gcp.openKeysTab(email);

  const isActive = async (keyId: string) => {
    const row = gcp.keyRow(keyId).first();
    if (!(await row.isVisible({ timeout: 10_000 }).catch(() => false))) return false;
    if (!/active/i.test(await row.innerText().catch(() => ''))) return false;
    return !gcloud.gcloudAvailable() || gcloud.userManagedKeyIds(email).includes(keyId);
  };

  let source = 'new' as KeySource;
  if (cfg.newKey) {
    console.log('NEW_KEY=true - creating a new key.');
  } else {
    const candidates: [string | undefined, KeySource][] = [
      [explicitFile, 'existing file'],
      [files.json, 'earlier run'],
    ];
    for (const [file, label] of candidates) {
      if (!file) continue;
      if (!fs.existsSync(file)) {
        if (label === 'existing file') console.warn(`Key file ${file} not found - ignoring it.`);
        continue;
      }
      const found = readKey(file);
      const why =
        !found ? 'is not valid JSON'
        : found.key.client_email !== email ? `belongs to ${found.key.client_email}`
        : !found.key.private_key_id ? 'has no private_key_id'
        : !(await isActive(found.key.private_key_id)) ? `its key ${found.key.private_key_id} is deleted or disabled in the Console`
        : '';
      if (why) {
        console.warn(`Not reusing ${file}: it ${why}.`);
        continue;
      }
      if (file !== files.json) {
        fs.writeFileSync(files.json, found!.raw, { mode: 0o600 });
      }
      source = label;
      console.log(`Reusing key ${found!.key.private_key_id} of ${email} from ${file} (still active).`);
      break;
    }
    if (source === 'new') console.log(`No usable key for ${email} on disk - creating a new one.`);
  }

  if (source === 'new') {
    await test.step('Keys tab: Add key → Create new key → JSON → Create', async () => {
      await gcp.createJsonKey(files.json);
      fs.chmodSync(files.json, 0o600);
    });
  }

  const raw = fs.readFileSync(files.json, 'utf8');
  const key = JSON.parse(raw) as ServiceAccountKey;

  await test.step('Key file is a valid service account key', async () => {
    expectValidKey(key, email);
  });

  await test.step('Key appears in the Keys table as active', async () => {
    const row = gcp.keyRow(key.private_key_id).first();
    await expect(row).toBeVisible();
    await expect(row).toContainText(/active/i);
  });

  if (gcloud.gcloudAvailable()) {
    await test.step('gcloud: key is registered on the service account', async () => {
      await expect.poll(() => gcloud.userManagedKeyIds(email), { timeout: 60_000 }).toContain(key.private_key_id);
    });
  }

  await test.step('Write single-line base64 copy for the workflow input', async () => {
    const b64 = toSingleLineBase64(raw);
    fs.writeFileSync(files.b64, b64, { mode: 0o600 });
    const written = fs.readFileSync(files.b64, 'utf8');
    expect(written, 'base64 must be one line with no spaces or newlines').toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(JSON.parse(Buffer.from(written, 'base64').toString('utf8')).private_key_id).toBe(key.private_key_id);
    console.log(`Key:    ${files.json}\nBase64: ${files.b64} (${written.length} characters, one line)`);
  });

  return { key, files, source };
}
