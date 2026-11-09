# E2E automation: GCP service account, key and GKE cluster

Playwright replaces the manual steps in [ConcreteDetectionFromScratch.md](../ConcreteDetectionFromScratch.md) and the pipeline run from the [README](../README.md). It only **creates the cluster**. Deploying the app is a separate step.

| # | Manual step it replaces | Where | Test |
| --- | --- | --- | --- |
| 1 | Create the admin service account and assign `Owner`, `Service Usage Admin`, `Project IAM Admin`, `Service Account Admin`, `Service Account Key Admin` | GCP Console | `gcp-service-account.spec.ts` › 1 |
| 2 | Keys → Add key → Create new key → JSON, then `base64 -w 0 key.json` | GCP Console | `gcp-service-account.spec.ts` › 2 |
| 3 | *(optional)* Run **Setup GCP Service Account**, then create a JSON key + base64 for `crack-detection-1` | GitHub + GCP Console | `app-service-account.spec.ts` |
| 4 | Run **Deploy Kubernetes Cluster** with `provider=gcp` and the base64 key, and wait for it to finish | GitHub | `gke-cluster-pipeline.spec.ts` |

There's also a form-validation test, which checks that an invalid account ID is rejected.

## Signing in (no passwords anywhere)

Nothing types a password, and `.env` holds no credentials. When a Google or GitHub session is missing or has expired, the terminal beeps and shows:

```
========================================================================
  ACTION NEEDED: sign in to Google Cloud
  Sign in in the Chrome window, with the Google account that owns the GCP project.
  The run continues by itself once the Cloud Console opens. Waiting up to 10 minutes...
========================================================================
```

Sign in by hand in that Chrome window and the run carries on. The same happens for GitHub (`ACTION NEEDED: sign in to GitHub`). Use an account with **write access** to the repo, since read-only accounts don't see the *Run workflow* button. The sessions are saved in `.auth/` and reused, so you're only asked again when they expire. The browser is visible by default for this reason.

## One-time setup (Ubuntu)

```bash
cd concrete-detection-infra/e2e
npm install
npx playwright install chrome   # Google Chrome; Google rejects Playwright's own Chromium. Skip if Chrome is installed.
cp .env.example .env            # check GCP_PROJECT_ID, SA_ID, GITHUB_REPO, CLUSTER_NAME
npm run auth                    # optional: sign in to Google now (GitHub too with CLUSTER=1 npm run auth)
```

Prerequisites that are still manual: the GCP project exists with billing enabled, and the Terraform state bucket (`GCP_BACKEND_BUCKET`, default `crack-detection-terraform`) exists. `gcloud` is optional. When it's installed and authenticated, it's used for extra checks and cleanup.

## Run

| Command | What it does |
| --- | --- |
| `npm run all` | **Full flow:** admin SA + roles → JSON key + base64 → cluster pipeline with the admin key → wait for *Success* |
| `npm run all:app` | Same, but runs **Setup GCP Service Account** in between and gives the cluster pipeline the `crack-detection-1` key, as documented in the README |
| `npm run sa` | Steps 1–2 only: admin SA + roles, key + base64 |
| `npm run app-sa` | Step 3 only (needs the admin key in `output/`) |
| `npm run cluster` | Step 4 only, with the key already in `output/` (set `PIPELINE_SA=app` to use the app key) |
| `npm run cluster:destroy` | Runs the same pipeline with `action=destroy` |
| `npm test` | Steps 1–2 with a throw-away account (`SA_ID` unset), deleted afterwards |
| `npm run report` | HTML report with trace, video and screenshot of failures |

The full flow takes about 10–20 minutes, and the cluster pipeline is most of it. Progress goes to the terminal, including the run URL and status changes.

### Output

- `output/<account>-key.json`: the downloaded JSON key (mode 600)
- `output/<account>-key.json.b64`: the same key as single-line base64, identical to `base64 -w 0 key.json`, which is what the pipeline's `gcp_sa_key_base64` input expects

The tests fill that input themselves and never print the key. `output/` and `.auth/` are gitignored, so never commit them.

### Existing service accounts and keys

**Accounts.** If the service account already exists, it's **used as it is**: it's not created again, and it's never deleted, even with `CLEANUP=true`. Test 1 only checks that it has the required roles, and fails with a clear message if one is missing. The same applies to the app account (`crack-detection-1`): if it exists, the *Setup GCP Service Account* pipeline is skipped. Set `FORCE_APP_SA_PIPELINE=true` to run it anyway.

**Keys.** Google lets you download a key only once, when it's created, so an existing key can't be downloaded again. An "old key" therefore means a key file you still have. The test uses the first of these that belongs to the account **and is still active** in the Console:

1. `SA_KEY_FILE` (or `APP_SA_KEY_FILE`), for example a key you downloaded by hand earlier
2. `output/<account>-key.json` from an earlier run

If neither works, because there's no file or the key was deleted or disabled, it **downloads a new key** from the existing account. Either way it writes the single-line base64 for the pipeline. Set `NEW_KEY=true` to always download a new key. GCP allows at most 10 keys per account; when that limit is reached the test says so, and you can delete old keys on the account's Keys tab.

The terminal says which case applied, for example `Reusing key 3f2a… from ~/Downloads/key.json (still active)` or `No usable key … creating a new one`.

**Workflow inputs** are checked against the workflow YAML before a run starts, so a renamed input fails immediately.

## When something breaks

- **A Console or GitHub selector stopped matching.** The Console selectors are all in [lib/gcp-console.ts](lib/gcp-console.ts) and the GitHub ones in [lib/github.ts](lib/github.ts). Run `npm run codegen` to record the current locators.
- **Key creation is blocked.** The org policy `iam.disableServiceAccountKeyCreation` is enforced. Ask an org admin to allow it for the project.
- **`... not found - the signed-in GitHub account has no access`.** You're signed in to the wrong GitHub account. Run `CLUSTER=1 npm run auth` and sign in with the right one.
- **The pipeline run fails.** Open the run URL printed in the terminal. Common causes are a missing state bucket or the Kubernetes Engine API not yet enabled for the project.
