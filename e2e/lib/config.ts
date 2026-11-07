import path from 'node:path';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env var ${name}. Copy e2e/.env.example to e2e/.env and set it.`);
  }
  return value;
}

/**
 * Roles the admin service account needs (ConcreteDetectionFromScratch.md, step 2).
 * `name` is the title shown in the Console role picker; `id` is the IAM role ID used for gcloud checks.
 */
export const REQUIRED_ROLES = [
  { name: 'Owner', id: 'roles/owner' },
  { name: 'Service Usage Admin', id: 'roles/serviceusage.serviceUsageAdmin' },
  { name: 'Project IAM Admin', id: 'roles/resourcemanager.projectIamAdmin' },
  { name: 'Service Account Admin', id: 'roles/iam.serviceAccountAdmin' },
  { name: 'Service Account Key Admin', id: 'roles/iam.serviceAccountKeyAdmin' },
] as const;

const runId = process.env.E2E_RUN_ID ?? Date.now().toString(36);
const projectId = required('GCP_PROJECT_ID');
// SA IDs must be 6-30 chars: lowercase letters, digits and hyphens, starting with a letter.
const saId = process.env.SA_ID?.trim() || `e2e-sa-${runId}`;

export const cfg = {
  projectId,
  saId,
  saDisplayName: process.env.SA_DISPLAY_NAME?.trim() || saId,
  saDescription: process.env.SA_DESCRIPTION?.trim() || 'Created by Playwright e2e test',
  saEmail: `${saId}@${projectId}.iam.gserviceaccount.com`,
  cleanup: (process.env.CLEANUP ?? 'true').toLowerCase() === 'true',
  verifyWithGcloud: (process.env.VERIFY_WITH_GCLOUD ?? 'auto').toLowerCase(),
  outputDir: path.join(__dirname, '..', 'output'),
};

const CONSOLE = 'https://console.cloud.google.com';
const q = () => `project=${encodeURIComponent(cfg.projectId)}`;

export const urls = {
  console: CONSOLE,
  serviceAccounts: () => `${CONSOLE}/iam-admin/serviceaccounts?${q()}`,
  createServiceAccount: () => `${CONSOLE}/iam-admin/serviceaccounts/create?${q()}`,
  iam: () => `${CONSOLE}/iam-admin/iam?${q()}`,
};
