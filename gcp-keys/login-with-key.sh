#!/usr/bin/env bash
# Used by pipelines GCP 1-3: sign in to GCP with a key passed as single-line base64.
#
# Env: KEY_B64      the base64 key from the workflow input (or KEY_JSON: raw JSON, e.g. a secret)
#      PROJECT_ID   the target project
#      EXPECT_EMAIL optional - fail unless the key belongs to this service account
# Signs in gcloud and sets GOOGLE_APPLICATION_CREDENTIALS (for Terraform) for the next steps.
# The key goes to a temporary file outside the repo; logout-key.sh removes it. Nothing is printed.
set -euo pipefail

KEY_FILE="${RUNNER_TEMP:-/tmp}/gcp-key.json"
umask 077

if [ -n "${KEY_B64:-}" ]; then
  echo "::add-mask::$KEY_B64"
  printf '%s' "$KEY_B64" | tr -d ' \r\n' | base64 -d > "$KEY_FILE" 2>/dev/null \
    || { echo "::error::The key input is not valid base64. Paste the contents of the .json.b64 file (one line)."; exit 1; }
elif [ -n "${KEY_JSON:-}" ]; then
  printf '%s' "$KEY_JSON" > "$KEY_FILE"
else
  echo "::error::No key given: paste the base64 one-liner (.json.b64 contents) into the key input."
  exit 1
fi

# Mask every line of the key in case anything ever echoes it.
while IFS= read -r line; do [ -n "$line" ] && echo "::add-mask::$line"; done < "$KEY_FILE"

EMAIL="$(python3 - "$KEY_FILE" <<'PY'
import json, sys
try:
    k = json.load(open(sys.argv[1]))
except Exception:
    sys.exit("not JSON")
if k.get("type") != "service_account" or "private_key" not in k:
    sys.exit("not a service account key")
print(k["client_email"])
PY
)" || { echo "::error::The key is not a valid service account JSON key."; rm -f "$KEY_FILE"; exit 1; }

if [ -n "${EXPECT_EMAIL:-}" ] && [ "$EMAIL" != "$EXPECT_EMAIL" ]; then
  echo "::error::This key belongs to $EMAIL, but $EXPECT_EMAIL is expected here."
  rm -f "$KEY_FILE"
  exit 1
fi

gcloud auth activate-service-account --key-file="$KEY_FILE" --quiet
gcloud config set project "$PROJECT_ID" --quiet
if [ -n "${GITHUB_ENV:-}" ]; then
  echo "GOOGLE_APPLICATION_CREDENTIALS=$KEY_FILE" >> "$GITHUB_ENV"
fi
echo "Signed in to GCP as $EMAIL (project $PROJECT_ID)."
