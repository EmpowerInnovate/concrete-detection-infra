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
/** DigitalOcean-only runs (npm run do:*) don't need any GCP settings. */
export const doOnly = process.env.DO_ONLY === '1';
/** Azure-only runs (npm run az:*) don't need any GCP settings either. */
export const azOnly = process.env.AZ_ONLY === '1';
/** True for runs that never touch GCP (no GCP_PROJECT_ID, no Google sign-in). */
export const gcpNotNeeded = doOnly || azOnly;
const projectId = gcpNotNeeded ? process.env.GCP_PROJECT_ID?.trim() || 'not-used' : required('GCP_PROJECT_ID');
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
  needed: process.env.CLUSTER === '1' || process.env.APP_SA === '1' || process.env.DO_CLUSTER === '1' || process.env.AZ_CLUSTER === '1',
  repo: process.env.GITHUB_REPO?.trim() || 'EmpowerInnovate/concrete-detection-infra',
  /**
   * manual (default): the test opens the "Run workflow" form, pre-fills it, and waits for YOU to
   * check the inputs and click "Run workflow". auto: the test fills and submits it itself.
   */
  manualForm: (process.env.GITHUB_FORM?.trim().toLowerCase() || 'manual') !== 'auto',
  /** How long to wait for you to click "Run workflow" (minutes). */
  manualWaitMs: Number(process.env.GITHUB_FORM_WAIT_MIN || 20) * 60_000,
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

// ---------------------------------------------------------------- DigitalOcean

/**
 * Settings for the DigitalOcean flow (tests/do-*.spec.ts):
 *   API token + Spaces access key in the DigitalOcean control panel -> "Deploy Kubernetes Cluster"
 *   with provider = digitalocean.
 */
export const doCfg = {
  /** DigitalOcean sign-in is only needed when the token or Spaces key has to be created. */
  needed: process.env.DO === '1',
  /** Set by npm run do:all / do:cluster / do:cluster:destroy. */
  clusterEnabled: process.env.DO_CLUSTER === '1',
  action: process.env.CLUSTER_ACTION?.trim() || 'apply',
  clusterName: process.env.DO_CLUSTER_NAME?.trim() || 'crack-detection-cluster',
  /** nyc3 often has no DOKS capacity; the pipeline falls back to other regions by itself. */
  region: process.env.DO_REGION?.trim() || 'sfo3',
  tokenName: process.env.DO_TOKEN_NAME?.trim() || 'crack-detection-terraform',
  /** As offered in the control panel: 30 days | 60 days | 90 days | 1 year | No expiry */
  tokenExpiry: process.env.DO_TOKEN_EXPIRY?.trim() || '90 days',
  spacesKeyName: process.env.DO_SPACES_KEY_NAME?.trim() || 'crack-detection-terraform',
  /** Always create a new token / Spaces key, even if the saved ones still work. */
  newCredentials: flag('DO_NEW_CREDENTIALS', false),
  /** Saved token + Spaces key (gitignored with output/). */
  credentialsFile: path.join(__dirname, '..', 'output', 'do-credentials.json'),
  waitForRun: flag('WAIT_FOR_CLUSTER', true),
  timeoutMs: Number(process.env.CLUSTER_TIMEOUT_MIN || 45) * 60_000,
  /** How long to wait for you, if the control panel needs a hand (minutes). */
  manualWaitMs: Number(process.env.DO_MANUAL_WAIT_MIN || 10) * 60_000,
};

// ---------------------------------------------------------------- Azure (AKS)

/**
 * Settings for the Azure flow (tests/az-*.spec.ts):
 *   Azure Portal: service principal (app registration) + client secret + Contributor and
 *   User Access Administrator on the subscription -> "Deploy Kubernetes Cluster" with provider = azure.
 */
export const azCfg = {
  /** Portal sign-in is only needed when something has to be created or assigned. */
  needed: process.env.AZ === '1',
  /** Set by npm run az:all / az:cluster / az:cluster:destroy. */
  clusterEnabled: process.env.AZ_CLUSTER === '1',
  action: process.env.CLUSTER_ACTION?.trim() || 'apply',
  /** Required for the Azure commands. Azure Portal -> Subscriptions -> Subscription ID. */
  subscriptionId: process.env.AZ_SUBSCRIPTION_ID?.trim() || '',
  /** Found automatically from the subscription when left empty. */
  tenantId: process.env.AZ_TENANT_ID?.trim() || '',
  /** Name of the app registration / service principal (created only if missing). */
  appName: process.env.AZ_SP_NAME?.trim() || 'crack-detection-aks-sp',
  /** As offered in the Portal: 90 days (3 months) | 180 days (6 months) | 365 days (12 months) | 545 days (18 months) | 730 days (24 months) */
  secretExpiry: process.env.AZ_SECRET_EXPIRY?.trim() || '180 days',
  clusterName: process.env.AZ_CLUSTER_NAME?.trim() || 'crack-detection-cluster',
  location: process.env.AZ_LOCATION?.trim() || 'eastus',
  /** Terraform state storage account (3-24 lowercase letters/digits, globally unique). The pipeline
   *  creates it with its resource group and tfstate container if missing. Empty = derived from the subscription. */
  storageAccount: process.env.AZ_STORAGE_ACCOUNT?.trim() || '',
  /** Always create a new client secret, even if the saved one still works. */
  newSecret: flag('AZ_NEW_SECRET', false),
  credentialsFile: path.join(__dirname, '..', 'output', 'azure-credentials.json'),
  waitForRun: flag('WAIT_FOR_CLUSTER', true),
  timeoutMs: Number(process.env.CLUSTER_TIMEOUT_MIN || 45) * 60_000,
  /** How long to wait for you if the Portal needs a hand (minutes). */
  manualWaitMs: Number(process.env.AZ_MANUAL_WAIT_MIN || 10) * 60_000,
};
