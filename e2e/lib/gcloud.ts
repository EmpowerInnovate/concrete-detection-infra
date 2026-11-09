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

/** True when gcloud should be used: installed, authenticated and not disabled via VERIFY_WITH_GCLOUD. */
export function gcloudAvailable(): boolean {
  if (cfg.verifyWithGcloud === 'false') return false;
  if (cachedAvailable === undefined) {
    try {
      cachedAvailable = run(['auth', 'list', '--filter=status:ACTIVE', '--format=value(account)']).length > 0;
    } catch {
      cachedAvailable = false;
    }
  }
  if (!cachedAvailable && cfg.verifyWithGcloud === 'true') {
    throw new Error('VERIFY_WITH_GCLOUD=true but gcloud is not installed or not authenticated (run `gcloud auth login`).');
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

export function serviceAccountExists(email: string): boolean {
  try {
    run(['iam', 'service-accounts', 'describe', email, `--project=${cfg.projectId}`, '--format=value(email)']);
    return true;
  } catch {
    return false;
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
