import { test, expect } from '@playwright/test';
import { azCfg, githubCfg } from '../lib/config';
import { GitHubActions } from '../lib/github';
import { expectValidCredentials, loadCredentials } from '../lib/azure';

/**
 * Actions -> "Deploy Kubernetes Cluster" -> Run workflow with provider = azure and the service principal
 * from az-credentials.spec.ts. Then follows the run until the AKS cluster is created (or destroyed with
 * CLUSTER_ACTION=destroy). The cluster gets its own resource group "<cluster_name>-rg".
 *
 * By default (GITHUB_FORM=manual) the form is pre-filled and the test WAITS for you to check it and
 * click "Run workflow"; GITHUB_FORM=auto submits it. Runs only with AZ_CLUSTER=1 (npm run az:*).
 */

test.skip(!azCfg.clusterEnabled, 'Azure cluster pipeline runs only with AZ_CLUSTER=1 (npm run az:all / az:cluster)');

test(`${azCfg.action} AKS cluster "${azCfg.clusterName}" with the deploy pipeline`, async ({ page }) => {
  test.setTimeout(azCfg.timeoutMs + githubCfg.manualWaitMs + 10 * 60_000);

  const creds = loadCredentials();
  try {
    expectValidCredentials(creds);
  } catch {
    throw new Error(`${azCfg.credentialsFile} is missing or incomplete. Create the credentials first: npm run az:all (or npm run az:credentials).`);
  }

  const gh = new GitHubActions(page, githubCfg.repo);
  let runUrl = '';

  await test.step(`Start deploy-kubernetes-cluster.yaml (provider azure) in ${githubCfg.repo}`, async () => {
    // Input ids from .github/workflows/deploy-kubernetes-cluster.yaml (azure_resource_group left blank
    // on purpose: the cluster then gets its own "<cluster_name>-rg").
    const inputs: Record<string, string> = {
      provider: 'azure',
      action: azCfg.action,
      cluster_name: azCfg.clusterName,
      azure_subscription_id: creds.subscriptionId!,
      azure_tenant_id: creds.tenantId!,
      azure_client_id: creds.clientId!,
      azure_client_secret: creds.clientSecret!,
      azure_storage_account: creds.storageAccount!,
      azure_location: azCfg.location,
    };
    console.log('Starting deploy-kubernetes-cluster.yaml:');
    runUrl = await gh.startWorkflow('deploy-kubernetes-cluster.yaml', inputs, ['azure_client_secret'], {
      manual: githubCfg.manualForm,
      manualWaitMs: githubCfg.manualWaitMs,
      notes: [`Service principal and secret are saved in ${azCfg.credentialsFile}`],
    });
    console.log(`Run started: ${runUrl}`);
  });

  if (!azCfg.waitForRun) return;

  await test.step('Wait for the run to finish', async () => {
    const status = await gh.waitForRun(runUrl, azCfg.timeoutMs);
    expect(status, `pipeline run ${runUrl}`).toMatch(/^Success$/i);
  });

  if (azCfg.action === 'apply') {
    console.log(
      `\nCluster ready. Connect with:\n  az aks get-credentials --resource-group ${azCfg.clusterName}-rg --name ${azCfg.clusterName} --overwrite-existing\n  kubectl get nodes\n`,
    );
  }
});
