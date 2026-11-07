# E2E tests – GCP Console service account setup

Playwright tests for the manual steps in [ConcreteDetectionFromScratch.md](../ConcreteDetectionFromScratch.md):

| Test | What it does in the GCP Console | Extra checks |
| --- | --- | --- |
| `rejects an invalid service account ID` | Types an invalid ID into the create form | Error shown, *Create and continue* disabled |
| `1. creates the service account with the required roles` | IAM & Admin → Service Accounts → Create → assigns `Owner`, `Service Usage Admin`, `Project IAM Admin`, `Service Account Admin`, `Service Account Key Admin` → Done | Account is listed and enabled; IAM page shows every role; `gcloud` policy has exactly those roles |
| `2. creates and downloads a JSON key` | Keys tab → Add key → Create new key → JSON → Create | JSON is a valid SA key for this account and project; key ID shows as active in the table and in `gcloud`; writes a base64 copy for the workflow input |

Test 2 depends on test 1, so they run serially.

## Setup

```bash
cd e2e
npm install
cp .env.example .env     # set GCP_PROJECT_ID
npm run auth             # opens Chrome: sign in to Google by hand once
```

Google blocks scripted sign-in, so `npm run auth` saves your session to `.auth/gcp-user.json`. Later runs reuse it. Run `npm run auth` again when tests fail with "Google session expired".

Requires Google Chrome. `gcloud` is optional. When it's installed and authenticated, it's used to cross-check results and to clean up.

## Run

```bash
npm test                 # headless
npm run test:headed      # watch it in the browser
npm run report           # HTML report with traces/videos of failures
```

### Throw-away account (default)
A unique ID such as `e2e-sa-mw6ll28x` is generated. With `CLEANUP=true`, its role bindings, the account and the downloaded key files are removed after the run.

### Creating the real admin account
```bash
SA_ID=empowerinnovate-sa SA_DISPLAY_NAME=empowerinnovate-sa CLEANUP=false npm test
```
The key is written to `output/empowerinnovate-sa-key.json`, with a base64 copy at `output/empowerinnovate-sa-key.json.b64`, ready for the `gcp_sa_key_base64` workflow input. `output/` and `.auth/` are gitignored. Never commit them.

## When the Console UI changes
Every selector is in [lib/gcp-console.ts](lib/gcp-console.ts). Run `npm run codegen` to record the current locators, then update that file.

## Known failure
If the org policy `iam.disableServiceAccountKeyCreation` is enforced, test 2 fails with a message saying so. Ask an org admin to allow key creation for the project.
