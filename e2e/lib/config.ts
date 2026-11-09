import path from 'node:path';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env var ${name}. Copy e2e/.env.example to e2e/.env and set it.`);
  }
  return value;
}

function expandHome(p?: string): string | undefined {
  const v = p?.trim();
  if (!v) return undefined;
  return path.resolve(v.replace(/^~(?=$|\/)/, process.env.HOME ?? '~'));
}

const flag = (name: string, fallback: boolean) => {
  const v = process.env[name]?.trim().toLowerCase();
  return v ? v === 'true' || v === '1' : fallback;
};

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
const explicitSaId = process.env.SA_ID?.trim();
const saId = explicitSaId || `e2e-sa-${runId}`;

export const cfg = {
  projectId,
  saId,
  /** True when SA_ID is set: this is a real account you want to keep, not a throw-away one. */
  isRealAccount: !!explicitSaId,
  saDisplayName: process.env.SA_DISPLAY_NAME?.trim() || saId,
  saDescription: process.env.SA_DESCRIPTION?.trim() || 'Created by Playwright e2e test',
  saEmail: `${saId}@${projectId}.iam.gserviceaccount.com`,
  /**
   * Delete the account after the run. Defaults to true only for throw-away accounts.
   * Even when true, an account that existed before the run is never deleted.
   */
  cleanup: flag('CLEANUP', !explicitSaId),
  /** Always create a new key, even if a still-active key is already available. */
  newKey: flag('NEW_KEY', false),
  /** A key you already have for SA_ID (e.g. ~/Downloads/key.json), used instead of creating one. */
  saKeyFile: expandHome(process.env.SA_KEY_FILE),
  verifyWithGcloud: (process.env.VERIFY_WITH_GCLOUD ?? 'auto').toLowerCase(),
  outputDir: path.join(__dirname, '..', 'output'),
  /** Headed by default so you can see the browser and sign in when asked. */
  headless: flag('HEADLESS', false),
};

const CONSOLE = 'https://console.cloud.google.com';
const q = () => `project=${encodeURIComponent(cfg.projectId)}`;

export const urls = {
  console: CONSOLE,
  serviceAccounts: () => `${CONSOLE}/iam-admin/serviceaccounts?${q()}`,
  createServiceAccount: () => `${CONSOLE}/iam-admin/serviceaccounts/create?${q()}`,
  iam: () => `${CONSOLE}/iam-admin/iam?${q()}`,
};

/** Key files for a service account: the downloaded JSON and its single-line base64 copy. */
export function keyFiles(accountId: string) {
  const json = path.join(cfg.outputDir, `${accountId}-key.json`);
  return { json, b64: `${json}.b64` };
}

export const emailOf = (accountId: string) => `${accountId}@${cfg.projectId}.iam.gserviceaccount.com`;

// ---------------------------------------------------------------- GitHub Actions pipelines

const accountName = process.env.GCP_ACCOUNT_NAME?.trim() || 'empowerinnovate';
const backendBucket = process.env.GCP_BACKEND_BUCKET?.trim() || 'crack-detection-terraform';

export const githubCfg = {
  /** GitHub sign-in is only needed when a pipeline runs. */
  needed: process.env.CLUSTER === '1' || process.env.APP_SA === '1',
  repo: process.env.GITHUB_REPO?.trim() || 'EmpowerInnovate/concrete-detection-infra',
  accountName,
  backendBucket,
};

/**
 * Optional middle step from the README (Phase 1): run "Setup GCP Service Account"
 * (setup-gcp-service-account.yaml) with the admin key; it creates the app service account
 * (e.g. crack-detection-1). The test then downloads a key for that account.
 */
export const appSaCfg = {
  enabled: process.env.APP_SA === '1',
  workflowFile: process.env.SA_WORKFLOW_FILE?.trim() || 'setup-gcp-service-account.yaml',
  name: process.env.APP_SA_NAME?.trim() || 'crack-detection-1',
  region: process.env.GCP_REGION?.trim() || 'us-central1',
  /** A key you already have for the app account, used instead of creating one. */
  keyFile: expandHome(process.env.APP_SA_KEY_FILE),
  /** Run the setup pipeline even when the app account already exists. */
  forcePipeline: flag('FORCE_APP_SA_PIPELINE', false),
  timeoutMs: Number(process.env.APP_SA_TIMEOUT_MIN || 15) * 60_000,
};

/** Settings for tests/gke-cluster-pipeline.spec.ts. Only read when that test runs. */
export const clusterCfg = {
  /** Set by `npm run cluster` / `npm run all`; without it the cluster test is skipped. */
  enabled: process.env.CLUSTER === '1',
  workflowFile: process.env.CLUSTER_WORKFLOW_FILE?.trim() || 'deploy-kubernetes-cluster.yaml',
  action: process.env.CLUSTER_ACTION?.trim() || 'apply',
  clusterName: process.env.CLUSTER_NAME?.trim() || 'crack-detection-cluster',
  zone: process.env.GCP_CLUSTER_ZONE?.trim() || 'us-central1-a',
  /**
   * Whose key the pipeline gets:
   *   admin - the account from SA_ID (default)
   *   app   - the account created by "Setup GCP Service Account" (APP_SA_NAME)
   */
  keyFrom: (process.env.PIPELINE_SA?.trim().toLowerCase() || (process.env.APP_SA === '1' ? 'app' : 'admin')) as
    | 'admin'
    | 'app',
  /** Wait for the run to finish and fail the test unless it succeeds. */
  waitForRun: flag('WAIT_FOR_CLUSTER', true),
  timeoutMs: Number(process.env.CLUSTER_TIMEOUT_MIN || 45) * 60_000,
};

/** Workflow choice inputs: a known option is picked directly, anything else goes through "custom". */
export function choiceInputs(): Record<string, string> {
  const inputs: Record<string, string> = {};
  if (['maheshrajannan', 'empowerinnovate'].includes(accountName)) {
    inputs.gcp_account_name = accountName;
  } else {
    inputs.gcp_account_name = 'custom';
    inputs.gcp_custom_account_name = accountName;
  }
  if (['crack-detection-terraform', 'crack-detection-terraform-1'].includes(backendBucket)) {
    inputs.gcp_backend_bucket = backendBucket;
  } else {
    inputs.gcp_backend_bucket = 'custom';
    inputs.gcp_custom_backend_bucket = backendBucket;
  }
  return inputs;
}
