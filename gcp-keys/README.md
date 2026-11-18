# GCP in 3 pipelines: main SA → cluster SA → GKE cluster

This follows the repo's own flow. The **main** service account creates the **cluster** service account, and the cluster service account creates the cluster. Pipelines 1 and 2 give you a new key as a **single-line base64** file, which you paste into the next pipeline's input. **No GitHub secrets are used.**

| # | Pipeline (Actions tab) | Paste into input | Does | Artifact you download |
| --- | --- | --- | --- | --- |
| 1 | **GCP 1 - Main service account + key** | `owner_key_base64`: any key with **Owner** on the project | Creates the main SA if missing (an existing one is reused, never created twice) and grants its 5 admin roles | `<main-sa>-key` → `<main-sa>-key.json.b64` + `<main-sa>-key.json` |
| 2 | **GCP 2 - Cluster service account + key** | `main_sa_key_base64`: the `.json.b64` from pipeline 1 | Runs the Terraform in [`gcp-service-account/`](../gcp-service-account), which creates the cluster SA (for example `crack-detection-1`) with its roles. An existing one is reused. | `<cluster-sa>-key` → `<cluster-sa>-key.json.b64` + `<cluster-sa>-key.json` |
| 3 | **GCP 3 - GKE cluster** | `cluster_sa_key_base64`: the `.json.b64` from pipeline 2 | Runs the Terraform in [`gcp-cluster/`](../gcp-cluster): `apply` creates or updates the cluster, `destroy` deletes it | none (the connect command is in the run's Summary) |

The 5 main SA roles are `Owner`, `Service Usage Admin`, `Project IAM Admin`, `Service Account Admin` and `Service Account Key Admin`.

## Each time

**1. Run GCP 1 - Main service account + key.** In `owner_key_base64`, paste a key with Owner on the project, for example from the Playwright tests: `cat e2e/output/empowerinnovate-sa-1-key.json.b64`.

When it finishes, open the run and download **Artifacts → `empowerinnovate-sa-1-key`**. It's kept for 1 day.

```bash
cd ~/ClaudeProjects/ConcreteDetectionInfraProject/concrete-detection-infra
unzip -o ~/Downloads/empowerinnovate-sa-1-key.zip -d e2e/output
cat e2e/output/empowerinnovate-sa-1-key.json.b64          # the one-liner
xclip -selection clipboard < e2e/output/empowerinnovate-sa-1-key.json.b64   # or copy it (sudo apt install xclip)
```

**2. Run GCP 2 - Cluster service account + key.** Paste that one-liner into `main_sa_key_base64`. Then download **`crack-detection-1-key`** and unzip it the same way, which gives you `e2e/output/crack-detection-1-key.json.b64`.

**3. Run GCP 3 - GKE cluster** with `action = apply`, and paste the `crack-detection-1` one-liner into `cluster_sa_key_base64`. Creating the cluster takes about 10–20 minutes. Run it again with `action = destroy` to delete the cluster.

You don't need to repeat steps 1 and 2 each time. A key keeps working until you delete it, so you can reuse the saved `.json.b64` files.

## Public repository

GitHub lets **anyone signed in to GitHub** download the artifacts of a public repository. So pipelines 1 and 2 check the repository's visibility first:

| Repository | What happens |
| --- | --- |
| Private | The key artifact is made. Only people with access to the repo can download it. |
| Public | The run **stops before creating a key**, with a message explaining why. |
| Public, with `allow_public_repo` ticked | The key artifact is made, with a warning. Anyone signed in to GitHub can download it for 1 day. |

**Recommended:** make the repository private, under **Settings → General → Danger Zone → Change visibility**.

## Good to know

- **Every run of 1 and 2 makes a new key.** Google never lets you download an existing key again. An account can have at most 10 keys. If you hit that limit, the run says so: tick `delete_old_keys`, or delete old keys on the account's **Keys** tab.
- **The log never contains the key.** Every line of it is masked, and the key files are deleted from the runner at the end of the run.
- **Each cluster SA has its own Terraform state.** It's stored in `gs://<state_bucket>/gcp-service-account/<project>/<account>`, so making `crack-detection-2` never changes `crack-detection-1`. An account that already exists is adopted into Terraform instead of failing with "already exists".
- **The cluster state** is `gs://<state_bucket>/gke/<cluster>`, the same place `deploy-kubernetes-cluster.yaml` uses.
- **Where keys go:** unzip keys into `e2e/output/`, which is gitignored. Never commit `*-key.json` or `*-key.json.b64`; the root `.gitignore` blocks them too.
