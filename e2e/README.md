# E2E automation (Playwright): GCP, DigitalOcean and Azure clusters

These Playwright tests do the **manual steps** for this repo in a real Chrome window, so you don't have to click through them. They then start the existing **Deploy Kubernetes Cluster** pipeline and follow it to the end.

| Cloud | What the tests do for you | Then |
| --- | --- | --- |
| **GCP (GKE)** | In the GCP Console: create or reuse the admin service account, grant its 5 roles, download a JSON key, and encode it as single-line base64 | Start **Deploy Kubernetes Cluster** with `provider = gcp` and follow the run |
| **DigitalOcean (DOKS)** | In the DigitalOcean control panel: create or reuse an API token and a Spaces access key | Start **Deploy Kubernetes Cluster** with `provider = digitalocean` and follow the run |
| **Azure (AKS)** | In the Azure Portal: create or reuse the app registration (service principal), create a client secret, and give it **Contributor** + **User Access Administrator** on the subscription | Start **Deploy Kubernetes Cluster** with `provider = azure` and follow the run |

They only **create or delete the cluster**. Deploying the app is a separate step.

Key points:

- **Signing in:** **you sign in yourself**, so no passwords or tokens go into any file.
- **Reuse:** **nothing is created twice**. An existing service account, a still-active key and still-working DigitalOcean and Azure credentials are reused.
- **The GitHub form:** the test **pre-fills it and waits for you** to check it and click **Run workflow**.

---

## Contents

1. [Prerequisites](#1-prerequisites)
2. [One-time setup](#2-one-time-setup)
3. [Signing in](#3-signing-in)
4. [Quick start](#4-quick-start)
5. [All npm commands](#5-all-npm-commands)
6. [GCP flow in detail](#6-gcp-flow-in-detail)
7. [DigitalOcean flow in detail](#7-digitalocean-flow-in-detail)
8. [Azure (AKS) flow in detail](#8-azure-aks-flow-in-detail)
9. [The GitHub "Run workflow" step](#9-the-github-run-workflow-step)
10. [Settings (.env)](#10-settings-env)
11. [Files the tests create](#11-files-the-tests-create)
12. [Troubleshooting](#12-troubleshooting)
13. [Project layout](#13-project-layout)

---

## 1. Prerequisites

| | Needed for | Notes |
| --- | --- | --- |
| Node.js 18+ and npm | everything | `node --version` |
| Google Chrome | everything | Google rejects Playwright's own Chromium. Install with `npx playwright install chrome` if needed. |
| GitHub account with **write** access to `EmpowerInnovate/concrete-detection-infra` | starting the pipeline | Read-only accounts don't see **Run workflow**. Use PIYUSH9090. |
| GCP project with billing, and the Terraform state bucket (`GCP_BACKEND_BUCKET`) | GCP | A Google account with **Owner** on the project |
| DigitalOcean account (team) | DigitalOcean | The pipeline creates or finds the Spaces bucket for Terraform state itself |
| `xclip` (optional) | convenience | Puts the key on your clipboard at the GitHub step: `sudo apt install xclip` |
| `gcloud` (optional) | extra GCP checks | Used only if it's signed in to an account that can access the project |

## 2. One-time setup

```bash
cd ~/ClaudeProjects/ConcreteDetectionInfraProject/concrete-detection-infra/e2e
npm install
npx playwright install chrome     # skip if Google Chrome is already installed
cp .env.example .env              # then check the values, see section 10
```

The minimum `.env` for GCP:

```bash
GCP_PROJECT_ID=concrete-detection-8
SA_ID=empowerinnovate-sa-1
SA_DISPLAY_NAME=empowerinnovate-sa-1
GITHUB_REPO=EmpowerInnovate/concrete-detection-infra
GCP_ACCOUNT_NAME=empowerinnovate
GCP_BACKEND_BUCKET=crack-detection-terraform-1
CLUSTER_NAME=crack-detection-cluster
GCP_CLUSTER_ZONE=us-central1-a
```

DigitalOcean works with the defaults and needs no GCP values.

## 3. Signing in

Nothing in the tests types a password. The browser is visible, and whenever a sign-in is needed the terminal **beeps** and shows a box like this:

```
========================================================================
  ACTION NEEDED: sign in to Google Cloud
  Sign in in the Chrome window, with the Google account that owns the GCP project.
  The run continues by itself once the Cloud Console opens. Waiting up to 10 minutes...
========================================================================
```

Sign in in that Chrome window and the run carries on by itself. Sessions are saved in `.auth/` and reused, so you're asked again only when one expires. This also works partway through a run.

| Service | When you're asked | Saved in | Sign in again with |
| --- | --- | --- | --- |
| Google Cloud | GCP commands | `.auth/gcp-user.json` | `npm run auth` |
| GitHub | commands that start a pipeline | `.auth/github-user.json` | `CLUSTER=1 npm run auth` |
| DigitalOcean | only when a token or Spaces key has to be created | `.auth/do-user.json` | `npm run do:auth` |

## 4. Quick start

**GCP: create a GKE cluster**
```bash
npm run all                 # service account + roles -> key + base64 -> pipeline (you click Run workflow)
```

**GCP: delete it**
```bash
npm run cluster:destroy     # same pipeline with action = destroy (you click Run workflow)
```

**DigitalOcean: create a DOKS cluster**
```bash
npm run do:all              # API token -> Spaces key -> pipeline (you click Run workflow)
```

**DigitalOcean: delete it**
```bash
npm run do:cluster:destroy
```

**Azure: create an AKS cluster** (set `AZ_SUBSCRIPTION_ID` in `.env` first)
```bash
npm run az:all              # app registration + secret -> roles -> pipeline (you click Run workflow)
```

**Azure: delete it**
```bash
npm run az:cluster:destroy
```

Creating a cluster takes about 10–20 minutes on GCP and Azure, and 5–10 minutes on DigitalOcean. The terminal prints the run URL and every status change, and the test passes when the run succeeds.

## 5. All npm commands

Run them from the `e2e/` folder.

### GCP

| Command | What it does | Starts a pipeline? |
| --- | --- | --- |
| `npm run all` | **Full GCP flow:** service account + 5 roles → JSON key + single-line base64 → **Deploy Kubernetes Cluster** (`provider = gcp`, `action = apply`) → follows the run | yes |
| `npm run sa` | Only the GCP Console part: form-validation test, service account + roles, then key + base64 | no |
| `npm test` | Same tests as `npm run sa` (the pipeline and DigitalOcean tests are skipped). With `SA_ID` unset, it uses a throw-away account that's deleted afterwards. | no |
| `npm run cluster` | Only the pipeline (`apply`), with the key already in `output/` | yes |
| `npm run cluster:destroy` | Only the pipeline with `action = destroy`, which **deletes the GKE cluster** | yes |
| `npm run all:app` | Like `all`, but first runs **Setup GCP Service Account** to create `crack-detection-1`. The cluster pipeline then gets that account's key instead of the admin key. | yes (2) |
| `npm run app-sa` | Only the **Setup GCP Service Account** step plus the `crack-detection-1` key (needs the admin key in `output/`) | yes |
| `npm run auth` | Sign in to Google again (`CLUSTER=1 npm run auth` also signs in to GitHub again) | no |

### DigitalOcean

| Command | What it does | Starts a pipeline? |
| --- | --- | --- |
| `npm run do:all` | **Full DigitalOcean flow:** API token → Spaces access key → **Deploy Kubernetes Cluster** (`provider = digitalocean`, `action = apply`) → follows the run | yes |
| `npm run do:credentials` | Only the API token and Spaces access key, reused if they still work | no |
| `npm run do:cluster` | Only the pipeline (`apply`), with the saved credentials | yes |
| `npm run do:cluster:destroy` | Only the pipeline with `action = destroy`, which **deletes the DOKS cluster** | yes |
| `npm run do:auth` | Sign in to DigitalOcean again | no |

### Azure (AKS)

| Command | What it does | Starts a pipeline? |
| --- | --- | --- |
| `npm run az:all` | **Full Azure flow:** app registration + client secret → Contributor + User Access Administrator → **Deploy Kubernetes Cluster** (`provider = azure`, `action = apply`) → follows the run | yes |
| `npm run az:credentials` | Only the Portal part: app registration, secret and roles, reused if they still work | no |
| `npm run az:cluster` | Only the pipeline (`apply`), with the saved credentials | yes |
| `npm run az:cluster:destroy` | Only the pipeline with `action = destroy`, which **deletes the AKS cluster** | yes |
| `npm run az:auth` | Sign in to the Azure Portal again | no |

### Tools

| Command | What it does |
| --- | --- |
| `npm run report` | Opens the HTML report of the last run, with screenshots, video and trace of any failure |
| `npm run test:debug` | Runs step by step in the Playwright Inspector |
| `npm run test:headless` | Runs without a visible browser. Sign-ins must already be saved, because nobody can sign in. |
| `npm run codegen` | Records locators in the GCP Console, for when Google changes a page |
| `npm run typecheck` | TypeScript check |

**One-off settings** go in front of any command, for example:

```bash
CLUSTER_NAME=test-cluster npm run all             # another GKE cluster name
DO_CLUSTER_NAME=test-cluster npm run do:all       # another DOKS cluster name
NEW_KEY=true npm run sa                           # force a new GCP key
DO_NEW_CREDENTIALS=true npm run do:credentials    # force a new DO token + Spaces key
AZ_NEW_SECRET=true npm run az:credentials         # force a new Azure client secret
GITHUB_FORM=auto npm run cluster                  # submit the GitHub form without waiting for you
```

## 6. GCP flow in detail

`npm run all` runs these tests in order:

| # | Test | What happens |
| --- | --- | --- |
| 1 | `auth.setup.ts` | Checks the Google and GitHub sessions, and asks you to sign in if needed |
| 2 | `gcp-service-account.spec.ts` › form validation | Types an invalid ID in **Create service account** and checks that the Console rejects it |
| 3 | `gcp-service-account.spec.ts` › 1 | **Service account `SA_ID`:** creates it if missing; an existing one is **reused, never created again, never deleted**. Then checks the 5 roles on the IAM page and **grants any that are missing** (IAM → Grant access). |
| 4 | `gcp-service-account.spec.ts` › 2 | **JSON key:** reuses a key you still have if it's active in the Console (`SA_KEY_FILE`, or `output/<SA_ID>-key.json`). Otherwise it creates and downloads a new one. Writes `output/<SA_ID>-key.json.b64`, identical to `base64 -w 0`. |
| 5 | `gke-cluster-pipeline.spec.ts` | Opens **Deploy Kubernetes Cluster**, pre-fills `provider = gcp`, the project, zone, bucket, account name and **the base64 key**, then **waits for you** to click **Run workflow** (section 9). Follows the run until it succeeds, then prints the `gcloud ... get-credentials` command. |

The 5 roles are `Owner`, `Service Usage Admin`, `Project IAM Admin`, `Service Account Admin` and `Service Account Key Admin`.

**Keys.** Google lets you download a key only once, when it's created. "Reusing a key" therefore means a key file you still have. An account can have at most 10 keys. Use `NEW_KEY=true` to force a new one.

**With `npm run all:app`,** two more steps run between 4 and 5. First the **Setup GCP Service Account** pipeline creates `crack-detection-1`; it's skipped if the account already exists. Then the test downloads a key for `crack-detection-1`, and the cluster pipeline gets that key.

## 7. DigitalOcean flow in detail

`npm run do:all` runs these tests in order. It needs no GCP settings and doesn't sign in to Google.

| # | Test | What happens |
| --- | --- | --- |
| 1 | `do-credentials.spec.ts` › 1 | **API token** (`do_token`): the saved token is reused if the DigitalOcean API still accepts it. Otherwise it creates one in **API → Tokens → Generate New Token**, with full access and the `DO_TOKEN_EXPIRY` expiry. |
| 2 | `do-credentials.spec.ts` › 2 | **Spaces access key** (`do_access_key`, `do_secret_key`): the saved key is reused if Spaces still accepts it (a signed S3 request). Otherwise it creates one in **Spaces Object Storage → Access Keys → Create Access Key**, with full access. |
| 3 | `do-cluster-pipeline.spec.ts` | Opens **Deploy Kubernetes Cluster**, pre-fills `provider = digitalocean`, the cluster name, region, token and Spaces key, then **waits for you** to click **Run workflow**. Follows the run until it succeeds, then prints the `doctl` connect command. |

The credentials are saved in `output/do-credentials.json`. The control panel opens only when something has to be created, and only then are you asked to sign in to DigitalOcean.

**If the control panel looks different** (DigitalOcean changes it now and then), the terminal says **ACTION NEEDED** with exactly what to click. Do that step by hand: the test still reads the new token or key from the page as soon as DigitalOcean shows it.

**Connect** after `do:all`:

```bash
doctl auth init -t "$(python3 -c 'import json;print(json.load(open("output/do-credentials.json"))["token"])')"
doctl kubernetes cluster kubeconfig save crack-detection-cluster
kubectl get nodes
```

## 8. Azure (AKS) flow in detail

`npm run az:all` runs these tests in order. It needs no GCP settings and doesn't sign in to Google. Only `AZ_SUBSCRIPTION_ID` is required; the tenant is found from the subscription.

| # | Test | What happens |
| --- | --- | --- |
| 1 | `az-credentials.spec.ts` › 1 | **Service principal + secret** (`azure_client_id`, `azure_client_secret`): the saved secret is reused if Azure still accepts it. Otherwise, in **Microsoft Entra ID → App registrations**, it reuses the app `AZ_SP_NAME` (or registers it once), reads the **Application (client) ID**, and adds a **New client secret** in **Certificates & secrets**. |
| 2 | `az-credentials.spec.ts` › 2 | **Roles:** checks the role assignments with the Azure API. A missing role is assigned with the Azure API **as you**, using your Portal sign-in (the same call as **Add role assignment → Review + assign**). Same roles as `azure-service-principal/main.tf`: **Contributor** and **User Access Administrator** at subscription scope. |
| 3 | `az-credentials.spec.ts` › 3 | Checks that the subscription is enabled and that the Terraform state storage account name is yours or still free. |
| 4 | `az-cluster-pipeline.spec.ts` | Opens **Deploy Kubernetes Cluster**, pre-fills `provider = azure`, subscription, tenant, client ID and secret, storage account and location, then **waits for you** to click **Run workflow**. The resource group is left empty, so the pipeline uses `<cluster>-rg`. Follows the run, then prints the `az aks` connect command. |

The credentials are saved in `output/azure-credentials.json`. The Portal opens only when something has to be created, and only then are you asked to sign in.

**You need** permission to register apps in Entra ID and to assign roles on the subscription (**Owner** or **User Access Administrator**). If the Portal looks different, the terminal says **ACTION NEEDED** with exactly what to click; do that step by hand and the test continues by itself (it reads the client ID and secret from the page, and checks the roles with the API).

**Connect** after `az:all`:

```bash
az aks get-credentials --resource-group crack-detection-cluster-rg --name crack-detection-cluster
kubectl get nodes
```

## 9. The GitHub "Run workflow" step

All pipeline commands start **Deploy Kubernetes Cluster** like this (`GITHUB_FORM=manual`, the default):

1. Chrome opens the workflow page on GitHub and clicks **Run workflow**.
2. The test pre-fills every input it can. The secret input is also copied to your clipboard if `xclip` is installed.
3. The terminal beeps and shows **ACTION NEEDED** with every value. Values it couldn't fill are marked `*`, and the key file's path is listed.
4. **You** check or enter the inputs and click **Run workflow**. The test waits up to `GITHUB_FORM_WAIT_MIN` minutes (default 20).
5. As soon as your run appears, the test follows it until it finishes. It never reloads the page you're typing in; a background tab watches for your run.

To let the test submit the form itself, use `GITHUB_FORM=auto`.

## 10. Settings (`.env`)

Copy `.env.example` to `.env`. Settings in front of a command (`NAME=value npm run ...`) override `.env`.

### GCP

| Setting | Default | Meaning |
| --- | --- | --- |
| `GCP_PROJECT_ID` | *(required for GCP)* | Target project |
| `SA_ID` | throw-away `e2e-sa-<random>` | Admin service account ID. Set it to your real account (for example `empowerinnovate-sa-1`). |
| `SA_DISPLAY_NAME` | `SA_ID` | Display name, used only when the account is created |
| `SA_DESCRIPTION` | `Created by Playwright e2e test` | Description, used only when the account is created |
| `CLEANUP` | `true` for throw-away accounts, `false` when `SA_ID` is set | Delete the account after the run. An account that existed before is never deleted. |
| `SA_KEY_FILE` | — | A key file you already have for `SA_ID`, reused while it's active |
| `NEW_KEY` | `false` | Always create a new key |
| `VERIFY_WITH_GCLOUD` | `auto` | Cross-check with `gcloud`: `auto`, `true` or `false` |
| `PAGE_LOAD_TIMEOUT_SEC` | `180` | How long to wait for a slow Console page |
| `APP_SA_NAME` | `crack-detection-1` | App service account (`all:app` / `app-sa`) |
| `GCP_REGION` | `us-central1` | Region for **Setup GCP Service Account** |
| `FORCE_APP_SA_PIPELINE` | `false` | Run **Setup GCP Service Account** even if the app account exists |
| `APP_SA_KEY_FILE` | — | A key file you already have for the app account |
| `PIPELINE_SA` | `admin` (`app` with `all:app`) | Whose key `npm run cluster` uses |

### GCP cluster pipeline

| Setting | Default | Meaning |
| --- | --- | --- |
| `CLUSTER_NAME` | `crack-detection-cluster` | GKE cluster name |
| `GCP_CLUSTER_ZONE` | `us-central1-a` | Zone |
| `GCP_BACKEND_BUCKET` | `crack-detection-terraform` | Terraform state bucket (must exist) |
| `GCP_ACCOUNT_NAME` | `empowerinnovate` | Account name shown in the pipeline log |

### DigitalOcean

| Setting | Default | Meaning |
| --- | --- | --- |
| `DO_CLUSTER_NAME` | `crack-detection-cluster` | DOKS cluster name |
| `DO_REGION` | `sfo3` | Region (the pipeline tries others if there's no capacity) |
| `DO_TOKEN_NAME` | `crack-detection-terraform` | Name of a new API token (the date is added) |
| `DO_TOKEN_EXPIRY` | `90 days` | `30 days`, `60 days`, `90 days`, `1 year` or `No expiry` |
| `DO_SPACES_KEY_NAME` | `crack-detection-terraform` | Name of a new Spaces key (the date is added) |
| `DO_NEW_CREDENTIALS` | `false` | Always create a new token + Spaces key |
| `DO_MANUAL_WAIT_MIN` | `10` | How long to wait if the control panel needs a hand |

### Azure (AKS)

| Setting | Default | Meaning |
| --- | --- | --- |
| `AZ_SUBSCRIPTION_ID` | *(required for Azure)* | Subscription for the cluster |
| `AZ_TENANT_ID` | found from the subscription | Directory (tenant) ID |
| `AZ_SP_NAME` | `crack-detection-aks-sp` | App registration (service principal) name |
| `AZ_SECRET_EXPIRY` | `180 days` | Client secret expiry as offered in the Portal |
| `AZ_CLUSTER_NAME` | `crack-detection-cluster` | AKS cluster name |
| `AZ_LOCATION` | `eastus` | Azure region |
| `AZ_STORAGE_ACCOUNT` | `cracktf` + 12 characters of the subscription ID | Terraform state storage account |
| `AZ_NEW_SECRET` | `false` | Always create a new client secret |
| `AZ_MANUAL_WAIT_MIN` | `10` | How long to wait if the Portal needs a hand |

### GitHub and pipeline runs (all clouds)

| Setting | Default | Meaning |
| --- | --- | --- |
| `GITHUB_REPO` | `EmpowerInnovate/concrete-detection-infra` | Repository with the pipeline |
| `GITHUB_FORM` | `manual` | `manual`: pre-fill and wait for your click. `auto`: submit by itself. |
| `GITHUB_FORM_WAIT_MIN` | `20` | How long to wait for your click |
| `WAIT_FOR_CLUSTER` | `true` | Follow the run until it finishes |
| `CLUSTER_TIMEOUT_MIN` | `45` | How long to follow the run |
| `CLUSTER_ACTION` | `apply` | Set by the `…:destroy` commands |
| `HEADLESS` | `false` | Run without a visible browser |

## 11. Files the tests create

All of these are **gitignored. Never commit them.**

| Path | Contents |
| --- | --- |
| `.env` | Your settings (no secrets) |
| `.auth/gcp-user.json`, `.auth/github-user.json`, `.auth/do-user.json`, `.auth/azure-user.json` | Saved sign-in sessions (cookies) |
| `output/<account>-key.json` | GCP service account JSON key |
| `output/<account>-key.json.b64` | The same key as single-line base64, as the pipeline expects |
| `output/do-credentials.json` | DigitalOcean API token + Spaces access key |
| `output/azure-credentials.json` | Azure subscription, tenant, client ID + secret, storage account |
| `test-results/`, `playwright-report/` | Screenshots, videos and traces of failures; opened by `npm run report` |

The key and credential files are readable only by you (mode 600). Delete keys you no longer need on the service account's **Keys** tab, tokens or keys in the DigitalOcean control panel, and client secrets under the app registration's **Certificates & secrets**.

## 12. Troubleshooting

| Problem | Fix |
| --- | --- |
| `Missing required env var GCP_PROJECT_ID` | `cp .env.example .env` and fill it in. The `do:` and `az:` commands don't need it. |
| `Set AZ_SUBSCRIPTION_ID in .env` | Add your subscription ID (Portal → **Subscriptions**) to `.env` |
| The roles check keeps waiting | Your account can't assign roles on the subscription. Ask an **Owner** to add the two roles to the app, then the test continues. |
| A Google, GitHub or DigitalOcean page says you're signed out | Sign in in Chrome when the terminal says **ACTION NEEDED**, or run `npm run auth` / `npm run do:auth` / `npm run az:auth` |
| `… not found - the signed-in GitHub account has no access` | Signed in with the wrong GitHub account. Run `CLUSTER=1 npm run auth` and use one with write access. |
| No **Run workflow** button | The GitHub account needs **write** access to the repository |
| `gcloud: not used - signed in as …, which cannot access project …` | Only a note: the checks are then done in the Console |
| `… already has 10 keys` | Delete old keys on the account's **Keys** tab, or run with `NEW_KEY=true` after deleting |
| Key creation blocked by `iam.disableServiceAccountKeyCreation` | An org admin has to allow key creation for the project |
| The test stops at a Console or GitHub page that looks different | Open the report (`npm run report`) for the screenshot. Selectors are in `lib/gcp-console.ts`, `lib/github.ts`, `lib/do.ts` and `lib/azure.ts`. |
| The pipeline run itself fails | Open the run URL printed in the terminal; the failed step shows the reason |
| A slow Console page times out | Increase `PAGE_LOAD_TIMEOUT_SEC` (for example `300`) |

## 13. Project layout

```
e2e/
├── .env.example                      settings template (copy to .env)
├── playwright.config.ts              test projects: setup, gcp-console, app-sa, cluster, do-console, do-cluster, az-portal, az-cluster
├── package.json                      npm commands (section 5)
├── lib/
│   ├── config.ts                     all settings from .env
│   ├── signin.ts                     "ACTION NEEDED" sign-in for Google, GitHub, DigitalOcean, Azure
│   ├── gcp-console.ts                GCP Console pages: service accounts, roles, keys, IAM
│   ├── keys.ts                       reuse or create a GCP key, write the single-line base64
│   ├── gcloud.ts                     optional gcloud cross-checks
│   ├── github.ts                     GitHub Actions: Run workflow form (manual/auto), follow the run
│   ├── workflow.ts                   reads the workflow's inputs from its YAML
│   ├── do.ts                         DigitalOcean: token + Spaces key (panel + checks)
│   ├── azure.ts                      Azure: app registration, secret, roles (Portal + API checks)
│   └── paths.ts                      where sessions are saved
└── tests/
    ├── auth.setup.ts                 sign-ins
    ├── gcp-service-account.spec.ts   GCP service account + roles, key + base64
    ├── app-service-account.spec.ts   optional: Setup GCP Service Account + app key
    ├── gke-cluster-pipeline.spec.ts  GCP cluster pipeline
    ├── do-credentials.spec.ts        DigitalOcean token + Spaces key
    ├── do-cluster-pipeline.spec.ts   DigitalOcean cluster pipeline
    ├── az-credentials.spec.ts        Azure service principal, secret, roles
    └── az-cluster-pipeline.spec.ts   Azure (AKS) cluster pipeline
```
