import { execFileSync } from 'node:child_process';
import { cfg } from './config';

/** Thin wrapper around the gcloud CLI, used to cross-check what the UI did. */
function run(args: string[]): string {
  return execFileSync('gcloud', [...args, '--quiet'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

let cachedAvailable: boolean | undefined;

function errText(e: unknown): string {
  const err = e as { stderr?: string; message?: string };
  return `${err.stderr ?? ''} ${err.message ?? ''}`;
}

/**
 * True when gcloud should be used: installed, signed in, and that account can see GCP_PROJECT_ID.
 * If gcloud is signed in as an account without access to the project, it is not used at all
 * (otherwise every check would fail and look like "account doesn't exist").
 */
export function gcloudAvailable(): boolean {
  if (cfg.verifyWithGcloud === 'false') return false;
  if (cachedAvailable === undefined) {
    let reason = '';
    try {
      const account = run(['auth', 'list', '--filter=status:ACTIVE', '--format=value(account)']);
      if (!account) {
        reason = 'not signed in (gcloud auth login)';
      } else {
        try {
          run(['projects', 'describe', cfg.projectId, '--format=value(projectId)']);
        } catch (e) {
          reason = `signed in as ${account}, which cannot access project ${cfg.projectId}`;
        }
      }
    } catch {
      reason = 'not installed';
    }
    cachedAvailable = !reason;
    console.log(cachedAvailable ? `gcloud: used for extra checks.` : `gcloud: not used - ${reason}. Checking in the Console UI only.`);
    if (!cachedAvailable && cfg.verifyWithGcloud === 'true') {
      throw new Error(`VERIFY_WITH_GCLOUD=true but gcloud is ${reason}.`);
    }
  }
  return cachedAvailable;
}

/** Project-level role IDs bound to the given service account. */
export function projectRolesOf(email: string): string[] {
  const out = run([
    'projects', 'get-iam-policy', cfg.projectId,
    '--flatten=bindings[].members',
    `--filter=bindings.members:serviceAccount:${email}`,
    '--format=value(bindings.role)',
  ]);
  return out ? out.split('\n').map((r) => r.trim()).filter(Boolean) : [];
}

/** IDs of user-managed keys for the service account. */
export function userManagedKeyIds(email: string): string[] {
  const out = run([
    'iam', 'service-accounts', 'keys', 'list',
    `--iam-account=${email}`,
    `--project=${cfg.projectId}`,
    '--managed-by=user',
    '--format=value(name.basename())',
  ]);
  return out ? out.split('\n').map((k) => k.trim()).filter(Boolean) : [];
}

/** True/false from gcloud; throws on any error other than "not found" (e.g. permission denied). */
export function serviceAccountExists(email: string): boolean {
  try {
    run(['iam', 'service-accounts', 'describe', email, `--project=${cfg.projectId}`, '--format=value(email)']);
    return true;
  } catch (e) {
    if (/NOT_FOUND|does not exist|not found/i.test(errText(e))) return false;
    throw new Error(`gcloud could not check ${email}: ${errText(e).trim().split('\n')[0]}`);
  }
}

/** Remove project role bindings first (deleting the SA would leave "deleted:" members behind), then the SA. */
export function deleteServiceAccount(email: string, roleIds: readonly string[]): void {
  for (const role of roleIds) {
    try {
      run([
        'projects', 'remove-iam-policy-binding', cfg.projectId,
        `--member=serviceAccount:${email}`,
        `--role=${role}`,
        '--condition=None',
        '--format=none',
      ]);
    } catch {
      // Binding was never created - fine.
    }
  }
  if (serviceAccountExists(email)) {
    run(['iam', 'service-accounts', 'delete', email, `--project=${cfg.projectId}`]);
  }
}
