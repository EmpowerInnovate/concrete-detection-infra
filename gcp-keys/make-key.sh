#!/usr/bin/env bash
# Used by pipelines GCP 1 and GCP 2.
# Creates a NEW JSON key for a service account (Google never lets you download an existing key
# again) and writes:
#   <out-dir>/<account>-key.json.b64   single-line base64 (same as `base64 -w 0 key.json`) - paste this
#   <out-dir>/<account>-key.json       the JSON key itself
# The workflow uploads <out-dir> as the run's artifact. Nothing secret is printed to the log.
#
# Usage: bash gcp-keys/make-key.sh <service-account-email> <project-id> <out-dir>
# Optional: DELETE_OLD_KEYS=true deletes the account's existing user-managed keys first
#           (GCP allows at most 10; old keys stop working).
set -euo pipefail

SA_EMAIL="${1:?service account email}"
PROJECT_ID="${2:?project id}"
OUT_DIR="${3:?output dir}"
NAME="${SA_EMAIL%%@*}"
JSON="$OUT_DIR/$NAME-key.json"
B64="$OUT_DIR/$NAME-key.json.b64"

umask 077
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

gcloud iam service-accounts keys create "$JSON" \
  --iam-account="$SA_EMAIL" --project="$PROJECT_ID" --key-file-type=json --quiet 2>/dev/null

# Hide every line of the key from the log, just in case.
if [ -n "${GITHUB_ACTIONS:-}" ]; then
  while IFS= read -r line; do [ -n "$line" ] && echo "::add-mask::$line"; done < "$JSON"
fi

# Check the key before handing it out.
KEY_ID="$(python3 - "$JSON" "$SA_EMAIL" "$PROJECT_ID" <<'PY'
import json, sys
k = json.load(open(sys.argv[1]))
assert k.get("type") == "service_account", "not a service account key"
assert k.get("client_email") == sys.argv[2], "key is for another account"
assert k.get("project_id") == sys.argv[3], "key is for another project"
assert "BEGIN PRIVATE KEY" in k.get("private_key", ""), "no private key"
print(k["private_key_id"])
PY
)"

# Single-line base64, no trailing newline; must decode back to the same key.
base64 -w 0 "$JSON" > "$B64"
[ "$(wc -l < "$B64")" -eq 0 ] || { echo "::error::base64 is not a single line"; exit 1; }
base64 -d "$B64" | cmp -s - "$JSON" || { echo "::error::base64 check failed"; exit 1; }
[ -n "${GITHUB_ACTIONS:-}" ] && echo "::add-mask::$(cat "$B64")"

echo "New key $KEY_ID for $SA_EMAIL: $NAME-key.json.b64 ($(wc -c < "$B64") characters, one line) + $NAME-key.json"
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  { echo "key_id=$KEY_ID"; echo "name=$NAME"; echo "dir=$OUT_DIR"; } >> "$GITHUB_OUTPUT"
fi
