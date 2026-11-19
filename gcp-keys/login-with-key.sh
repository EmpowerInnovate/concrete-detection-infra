#!/usr/bin/env bash
# Used by pipelines GCP 1-3: sign in to GCP with a key passed as single-line base64.
#
# Env: KEY_B64      the key from the workflow input: single-line base64 (a pasted JSON key also works)
#      PROJECT_ID   the target project
#      EXPECT_EMAIL optional - fail unless the key belongs to this service account
# Signs in gcloud and sets GOOGLE_APPLICATION_CREDENTIALS (for Terraform) for the next steps.
# The key goes to a temporary file outside the repo; logout-key.sh removes it. Nothing is printed.
set -euo pipefail

KEY_FILE="${RUNNER_TEMP:-/tmp}/gcp-key.json"
umask 077

# Hide the input from the log: every line on its own (a multi-line paste must not leak line 2+),
# plus the joined single-line form. Read from the environment, never from the command line.
python3 -c '
import os, re
raw = os.environ.get("KEY_B64", "")
for part in [l.strip() for l in raw.splitlines()] + [re.sub(r"\s", "", raw)]:
    if len(part) >= 4:
        print("::add-mask::" + part)
'
if [ -z "${KEY_B64:-}${KEY_JSON:-}" ]; then
  echo "::error::No key given: paste the base64 one-liner (.json.b64 contents) into the key input."
  exit 1
fi

# Decode in Python (the key is read from the environment, never from the command line).
# Tolerates what copy/paste adds: spaces, line breaks, quotes, zsh's trailing "%" marker,
# URL-safe base64, missing "=" padding - and also a pasted JSON key. The result is then fully
# validated, so a damaged or wrong key is still rejected.
EMAIL="$(python3 - "$KEY_FILE" <<'PY'
import base64, binascii, json, os, re, sys

out = sys.argv[1]
raw = os.environ.get("KEY_B64") or os.environ.get("KEY_JSON") or ""
def fail(msg):
    print(f"::error::{msg}", file=sys.stderr)
    sys.exit(1)

text = raw.strip().strip("'\"").strip()
if text.startswith("{"):
    data = text.encode()
else:
    unexpected = sorted(set(re.sub(r"[A-Za-z0-9+/=\-_\s]", "", text)))
    cleaned = re.sub(r"[^A-Za-z0-9+/\-_]", "", text).replace("-", "+").replace("_", "/")
    cleaned += "=" * (-len(cleaned) % 4)
    hint = (f"Received {len(cleaned)} base64 characters (a key is usually about 3100-3300)"
            + (f"; ignored unexpected characters: {' '.join(repr(c) for c in unexpected)}" if unexpected else "")
            + ". Copy the whole .json.b64 file, e.g. xclip -selection clipboard < file.json.b64")
    try:
        data = base64.b64decode(cleaned, validate=True)
    except (binascii.Error, ValueError):
        fail("The key input is not valid base64. " + hint)
    if unexpected:
        print(f"Note: ignored characters added by copy/paste: {' '.join(repr(c) for c in unexpected)}", file=sys.stderr)

try:
    k = json.loads(data)
except Exception:
    fail("The key input decodes, but not to a JSON key - the text is probably cut off. " +
         (hint if not text.startswith("{") else "Paste the whole JSON."))
if not isinstance(k, dict) or k.get("type") != "service_account" or "BEGIN PRIVATE KEY" not in k.get("private_key", ""):
    fail("That is not a service account key (type service_account with a private key).")

fd = os.open(out, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, "w") as f:
    json.dump(k, f)
print(k["client_email"])
PY
)" || { rm -f "$KEY_FILE"; exit 1; }

# Mask the private key lines in case anything ever echoes them.
python3 -c 'import json,sys; [print("::add-mask::"+l) for l in json.load(open(sys.argv[1]))["private_key"].splitlines() if l.strip()]' "$KEY_FILE"

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
