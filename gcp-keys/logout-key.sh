#!/usr/bin/env bash
# Used by pipelines GCP 1-3 at the end (always): sign out and delete the temporary key file.
gcloud auth revoke --all --quiet >/dev/null 2>&1 || true
rm -f "${RUNNER_TEMP:-/tmp}/gcp-key.json"
echo "Signed out; temporary key removed."
