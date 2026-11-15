#!/usr/bin/env bash
# Used by pipelines GCP 1 and GCP 2.
# Creates a NEW JSON key for a service account (Google never lets you download an existing key
# again), makes the single-line base64 copy (same as `base64 -w 0 key.json`), and packs both into
# ONE file encrypted to the SSH public keys in gcp-keys/recipients.txt (with `age`). Only the
# matching private key (on your computer) can open it. Nothing secret is printed and no GitHub
# secret is used.
#
# Usage: bash gcp-keys/encrypted-key.sh <service-account-email> <project-id> <out-dir>
# Optional: DELETE_OLD_KEYS=true deletes the account's existing user-managed keys first
#           (GCP allows at most 10; old keys stop working).
# Output:   <out-dir>/<account>-key.tar.gz.age  - open it with gcp-keys/decrypt-key.sh
set -euo pipefail

SA_EMAIL="${1:?service account email}"
PROJECT_ID="${2:?project id}"
OUT_DIR="${3:?output dir}"
NAME="${SA_EMAIL%%@*}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RECIPIENTS="${RECIPIENTS_FILE:-$HERE/recipients.txt}"
if ! grep -qE '^(ssh-ed25519|ssh-rsa|age1)' "$RECIPIENTS" 2>/dev/null; then
  echo "::error::No public key in gcp-keys/recipients.txt. Add yours once: cat ~/.ssh/id_ed25519.pub >> gcp-keys/recipients.txt, then commit and push (see gcp-keys/README.md)."
  exit 1
fi
command -v age >/dev/null || { sudo apt-get install -y -qq age >/dev/null || { echo "::error::Could not install age"; exit 1; }; }

umask 077
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$OUT_DIR"

old_keys="$(gcloud iam service-accounts keys list --iam-account="$SA_EMAIL" --project="$PROJECT_ID" \
  --managed-by=user --format='value(name.basename())')"
count="$(grep -c . <<<"$old_keys" || true)"
echo "$SA_EMAIL has $count user-managed key(s)."
if [ "${DELETE_OLD_KEYS:-false}" = "true" ] && [ "$count" -gt 0 ]; then
  for k in $old_keys; do
    gcloud iam service-accounts keys delete "$k" --iam-account="$SA_EMAIL" --project="$PROJECT_ID" --quiet
    echo "  deleted old key $k"
  done
elif [ "$count" -ge 10 ]; then
  echo "::error::$SA_EMAIL already has 10 keys (the GCP maximum). Run again with delete_old_keys = true, or delete old keys on its Keys tab."
  exit 1
fi

gcloud iam service-accounts keys create "$WORK/$NAME-key.json" \
  --iam-account="$SA_EMAIL" --project="$PROJECT_ID" --key-file-type=json --quiet 2>/dev/null

# Check the key before handing it out.
KEY_ID="$(python3 - "$WORK/$NAME-key.json" "$SA_EMAIL" "$PROJECT_ID" <<'PY'
import json, sys
k = json.load(open(sys.argv[1]))
assert k.get("type") == "service_account", "not a service account key"
assert k.get("client_email") == sys.argv[2], "key is for another account"
assert k.get("project_id") == sys.argv[3], "key is for another project"
assert "BEGIN PRIVATE KEY" in k.get("private_key", ""), "no private key"
print(k["private_key_id"])
PY
)"

base64 -w 0 "$WORK/$NAME-key.json" > "$WORK/$NAME-key.json.b64"
# Single line, and decodes back to the same key.
[ "$(wc -l < "$WORK/$NAME-key.json.b64")" -eq 0 ] || { echo "::error::base64 is not a single line"; exit 1; }
base64 -d "$WORK/$NAME-key.json.b64" | cmp -s - "$WORK/$NAME-key.json" || { echo "::error::base64 check failed"; exit 1; }

tar -C "$WORK" -czf "$WORK/$NAME-key.tar.gz" "$NAME-key.json" "$NAME-key.json.b64"
grep -E '^(ssh-ed25519|ssh-rsa|age1)' "$RECIPIENTS" > "$WORK/recipients"
age -R "$WORK/recipients" -o "$OUT_DIR/$NAME-key.tar.gz.age" "$WORK/$NAME-key.tar.gz"

echo "New key $KEY_ID for $SA_EMAIL -> $OUT_DIR/$NAME-key.tar.gz.age (encrypted to $(grep -c . "$WORK/recipients") public key(s) in gcp-keys/recipients.txt)"
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  { echo "key_id=$KEY_ID"; echo "file=$OUT_DIR/$NAME-key.tar.gz.age"; echo "name=$NAME"; } >> "$GITHUB_OUTPUT"
fi
