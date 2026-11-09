import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { appSaCfg, cfg, choiceInputs, clusterCfg, emailOf, githubCfg, keyFiles } from '../lib/config';
import { GitHubActions } from '../lib/github';

/**
 * Replaces the manual GitHub step: Actions → "Deploy Kubernetes Cluster" → Run workflow with
 * provider gcp, the project, and the single-line base64 key from the earlier tests.
 * Then follows the run until the GKE cluster is created (or destroyed with CLUSTER_ACTION=destroy).
 * Only creates the cluster - deploying the app is a separate step.
 *
 * Runs only with CLUSTER=1 (npm run all / npm run all:app / npm run cluster).
 */

test.skip(!clusterCfg.enabled, 'Cluster pipeline runs only with CLUSTER=1 (npm run all / npm run cluster)');

test(`${clusterCfg.action} GKE cluster "${clusterCfg.clusterName}" with the deploy pipeline`, async ({ page }) => {
  test.setTimeout(clusterCfg.timeoutMs + 10 * 60_000);

  // Whose key: the admin account (SA_ID) or the app account from "Setup GCP Service Account".
  const accountId = clusterCfg.keyFrom === 'app' ? appSaCfg.name : cfg.saId;
  if (clusterCfg.keyFrom === 'admin' && !cfg.isRealAccount) {
    throw new Error('Set SA_ID in .env to the service account whose key the pipeline should use.');
  }
  const b64File = keyFiles(accountId).b64;
  if (!fs.existsSync(b64File)) {
    throw new Error(
      `${b64File} not found. Create the key first: ` +
        (clusterCfg.keyFrom === 'app' ? 'npm run all:app (or npm run app-sa).' : 'npm run all (or npm test with SA_ID set).'),
    );
  }
  const keyBase64 = fs.readFileSync(b64File, 'utf8').trim();
  const key = JSON.parse(Buffer.from(keyBase64, 'base64').toString('utf8'));
  expect(key.client_email, `${b64File} belongs to another account`).toBe(emailOf(accountId));
  expect(key.project_id, `${b64File} is for another project`).toBe(cfg.projectId);
  console.log(`Using the key of ${key.client_email}`);

  const gh = new GitHubActions(page, githubCfg.repo);
  let runUrl = '';

  await test.step(`Start ${clusterCfg.workflowFile} in ${githubCfg.repo}`, async () => {
    // Input ids from .github/workflows/deploy-kubernetes-cluster.yaml
    const inputs: Record<string, string> = {
      provider: 'gcp',
      action: clusterCfg.action,
      cluster_name: clusterCfg.clusterName,
      ...choiceInputs(),
      gcp_project_id: cfg.projectId,
      gcp_sa_key_base64: keyBase64,
      gcp_cluster_zone: clusterCfg.zone,
    };
    console.log(`Starting ${clusterCfg.workflowFile}:`);
    runUrl = await gh.startWorkflow(clusterCfg.workflowFile, inputs, ['gcp_sa_key_base64']);
    console.log(`Run started: ${runUrl}`);
  });

  if (!clusterCfg.waitForRun) return;

  await test.step('Wait for the run to finish', async () => {
    const status = await gh.waitForRun(runUrl, clusterCfg.timeoutMs);
    expect(status, `pipeline run ${runUrl}`).toMatch(/^Success$/i);
  });

  if (clusterCfg.action === 'apply') {
    console.log(
      `\nCluster ready. Connect with:\n  gcloud container clusters get-credentials ${clusterCfg.clusterName} ` +
        `--zone ${clusterCfg.zone} --project ${cfg.projectId}\n`,
    );
  }
});
