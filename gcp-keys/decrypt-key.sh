#!/usr/bin/env bash
# Opens a key downloaded from pipeline GCP 1 or GCP 2 (run on your computer).
#
# Usage: bash gcp-keys/decrypt-key.sh <downloaded .zip or .tar.gz.age> [out-dir]
#   out-dir defaults to e2e/output (gitignored).
#   Uses your SSH private key (~/.ssh/id_ed25519, else ~/.ssh/id_rsa; or SSH_KEY=/path/to/key) -
#   the pair of the public key in gcp-keys/recipients.txt. If that key has a passphrase, age asks for it.
# Result: <account>-key.json and <account>-key.json.b64 (single line, ready to paste as the next
#         pipeline's input).
set -euo pipefail

IN="${1:?usage: decrypt-key.sh <downloaded .zip or .tar.gz.age> [out-dir]}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${2:-$REPO_ROOT/e2e/output}"

command -v age >/dev/null || { echo "age is not installed: sudo apt install age" >&2; exit 1; }
[ -f "$IN" ] || { echo "File not found: $IN" >&2; exit 1; }

if [ -z "${SSH_KEY:-}" ]; then
  for k in "$HOME/.ssh/id_ed25519" "$HOME/.ssh/id_rsa"; do [ -f "$k" ] && { SSH_KEY="$k"; break; }; done
fi
[ -n "${SSH_KEY:-}" ] && [ -f "$SSH_KEY" ] || { echo "No SSH private key found. Set SSH_KEY=/path/to/private-key." >&2; exit 1; }

umask 077
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

ENC="$IN"
case "$IN" in
  *.zip)
    command -v unzip >/dev/null || { echo "Install unzip first: sudo apt install unzip" >&2; exit 1; }
    unzip -q -o "$IN" -d "$WORK/zip"
    ENC="$(find "$WORK/zip" -name '*.tar.gz.age' | head -1)"
    [ -n "$ENC" ] || { echo "No .tar.gz.age file inside $IN" >&2; exit 1; }
    ;;
esac

age -d -i "$SSH_KEY" -o "$WORK/key.tar.gz" "$ENC" \
  || { echo "Could not decrypt with $SSH_KEY. Is its .pub in gcp-keys/recipients.txt (committed before the pipeline ran)?" >&2; exit 1; }

mkdir -p "$OUT_DIR"
tar -C "$OUT_DIR" -xzf "$WORK/key.tar.gz"
FILES="$(tar -tzf "$WORK/key.tar.gz")"
for f in $FILES; do chmod 600 "$OUT_DIR/$f"; echo "Saved: $OUT_DIR/$f"; done
B64="$(grep '\.b64$' <<<"$FILES" | head -1)"

cat <<EOF

Base64 one-liner for the next pipeline's key input:
  $OUT_DIR/$B64
Copy to clipboard:  xclip -selection clipboard < "$OUT_DIR/$B64"    (sudo apt install xclip)
Or print it:        cat "$OUT_DIR/$B64"
EOF
