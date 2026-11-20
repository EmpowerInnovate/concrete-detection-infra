import { test, expect } from '@playwright/test';
import { doCfg, githubCfg } from '../lib/config';
import { GitHubActions } from '../lib/github';
import { expectValidCredentials, loadCredentials } from '../lib/do';

/**
 * Actions -> "Deploy Kubernetes Cluster" -> Run workflow with provider = digitalocean, the API token
 * and the Spaces key from do-credentials.spec.ts. Then follows the run until the DOKS cluster is
 * created (or destroyed with CLUSTER_ACTION=destroy).
 *
 * By default (GITHUB_FORM=manual) the form is pre-filled and the test WAITS for you to check it and
 * click "Run workflow"; GITHUB_FORM=auto submits it. Runs only with DO_CLUSTER=1 (npm run do:*).
 */

test.skip(!doCfg.clusterEnabled, 'DigitalOcean cluster pipeline runs only with DO_CLUSTER=1 (npm run do:all / do:cluster)');

test(`${doCfg.action} DigitalOcean cluster "${doCfg.clusterName}" with the deploy pipeline`, async ({ page }) => {
  test.setTimeout(doCfg.timeoutMs + githubCfg.manualWaitMs + 10 * 60_000);

  const creds = loadCredentials();
  try {
    expectValidCredentials(creds);
  } catch {
    throw new Error(`${doCfg.credentialsFile} is missing or incomplete. Create the credentials first: npm run do:all (or npm run do:credentials).`);
  }

  const gh = new GitHubActions(page, githubCfg.repo);
  let runUrl = '';

  await test.step(`Start deploy-kubernetes-cluster.yaml (provider digitalocean) in ${githubCfg.repo}`, async () => {
    // Input ids from .github/workflows/deploy-kubernetes-cluster.yaml
    const inputs: Record<string, string> = {
      provider: 'digitalocean',
      action: doCfg.action,
      cluster_name: doCfg.clusterName,
      do_token: creds.token!,
      do_access_key: creds.spacesAccessKey!,
      do_secret_key: creds.spacesSecretKey!,
      do_cluster_region: doCfg.region,
    };
    console.log('Starting deploy-kubernetes-cluster.yaml:');
    runUrl = await gh.startWorkflow('deploy-kubernetes-cluster.yaml', inputs, ['do_token', 'do_access_key', 'do_secret_key'], {
      manual: githubCfg.manualForm,
      manualWaitMs: githubCfg.manualWaitMs,
      notes: [`Token and Spaces key are saved in ${doCfg.credentialsFile}`],
    });
    console.log(`Run started: ${runUrl}`);
  });

  if (!doCfg.waitForRun) return;

  await test.step('Wait for the run to finish', async () => {
    const status = await gh.waitForRun(runUrl, doCfg.timeoutMs);
    expect(status, `pipeline run ${runUrl}`).toMatch(/^Success$/i);
  });

  if (doCfg.action === 'apply') {
    console.log(
      `\nCluster ready. Connect with:\n  doctl auth init -t <token from ${doCfg.credentialsFile}>\n` +
        `  doctl kubernetes cluster kubeconfig save ${doCfg.clusterName}\n`,
    );
  }
});
