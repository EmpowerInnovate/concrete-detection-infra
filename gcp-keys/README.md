# GCP in 3 pipelines: main SA → cluster SA → GKE cluster

This follows the repo's own flow. The **main** service account creates the **cluster** service account, and the cluster service account creates the cluster. Each pipeline gives you a new key as a **base64 one-liner**, which you paste into the next pipeline's input. **No GitHub secrets are used.**

| # | Pipeline (Actions tab) | Signs in with (pasted input) | Does | Gives you |
| --- | --- | --- | --- | --- |
| 1 | **GCP 1 - Main service account + key** | `owner_key_base64`: any key with **Owner** on the project | Creates the main SA if missing (an existing one is reused, never created twice) and grants its 5 admin roles | Main SA key (`.json` + `.json.b64`) |
| 2 | **GCP 2 - Cluster service account + key** | `main_sa_key_base64`: the key from pipeline 1 | Runs the Terraform in [`gcp-service-account/`](../gcp-service-account), which creates the cluster SA (for example `crack-detection-1`) with its roles. An existing one is reused. | Cluster SA key (`.json` + `.json.b64`) |
| 3 | **GCP 3 - GKE cluster** | `cluster_sa_key_base64`: the key from pipeline 2 | Runs the Terraform in [`gcp-cluster/`](../gcp-cluster): `apply` creates or updates the cluster, `destroy` deletes it | The connect command, in the run's Summary |

The 5 main SA roles are `Owner`, `Service Usage Admin`, `Project IAM Admin`, `Service Account Admin` and `Service Account Key Admin`.

## Why the download is encrypted

This repo is **public**. A key printed in the log or uploaded as a plain artifact could be taken by anyone. So pipelines 1 and 2 encrypt the key to **your SSH public key** (using [age](https://github.com/FiloSottile/age)), and only your computer's private key can open it. Public keys aren't secret, so it's safe to commit them to the repo.

## One-time setup (on your computer)

```bash
sudo apt install age unzip xclip                     # age opens the download; xclip is optional
ls ~/.ssh/id_ed25519.pub || ssh-keygen -t ed25519    # make an SSH key if you don't have one

cd ~/ClaudeProjects/ConcreteDetectionInfraProject/concrete-detection-infra
cat ~/.ssh/id_ed25519.pub >> gcp-keys/recipients.txt
git add gcp-keys/recipients.txt && git commit -m "gcp-keys: add my public key" && git push origin master
```

## Each time

**1. Run GCP 1 - Main service account + key.**

- `owner_key_base64`: paste a key with Owner on the project. For example, from the Playwright tests: `cat e2e/output/empowerinnovate-sa-1-key.json.b64`.
- When the run finishes, download **Artifacts → `<account>-key-encrypted`**. It's kept for 1 day.

```bash
bash gcp-keys/decrypt-key.sh ~/Downloads/empowerinnovate-sa-1-key-encrypted.zip
# -> e2e/output/empowerinnovate-sa-1-key.json  and  e2e/output/empowerinnovate-sa-1-key.json.b64
xclip -selection clipboard < e2e/output/empowerinnovate-sa-1-key.json.b64     # copy the one-liner
```

**2. Run GCP 2 - Cluster service account + key.** Paste that one-liner into `main_sa_key_base64`. Then download and decrypt the same way:

```bash
bash gcp-keys/decrypt-key.sh ~/Downloads/crack-detection-1-key-encrypted.zip
xclip -selection clipboard < e2e/output/crack-detection-1-key.json.b64
```

**3. Run GCP 3 - GKE cluster** with `action = apply`, and paste that one-liner into `cluster_sa_key_base64`. Creating the cluster takes about 10–20 minutes. Run it again with `action = destroy` to delete the cluster.

You don't need to repeat steps 1 and 2 each time. A key keeps working until you delete it, so you can reuse the saved `.json.b64` files.

## Good to know

- **Every run of 1 and 2 makes a new key.** Google never lets you download an existing key again. An account can have at most 10 keys. If you hit that limit, the run says so: tick `delete_old_keys`, or delete old keys on the account's **Keys** tab.
- **Each cluster SA has its own Terraform state.** It's stored in `gs://<state_bucket>/gcp-service-account/<project>/<account>`, so making `crack-detection-2` never changes `crack-detection-1`. An account that already exists is adopted into Terraform instead of failing with "already exists".
- **The cluster state** is `gs://<state_bucket>/gke/<cluster>`, the same place `deploy-kubernetes-cluster.yaml` uses.
- **Where keys go:** decrypted keys go to `e2e/output/`, which is gitignored. Never commit `*-key.json` or `*-key.json.b64`.
- **Pasted inputs:** GitHub doesn't treat workflow inputs as secrets. The pipelines never print them, but delete keys you no longer use.
- **Other workflows:** the existing `setup-gcp-service-account.yaml` and `deploy-kubernetes-cluster.yaml` are unchanged.
