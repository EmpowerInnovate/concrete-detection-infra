#!/usr/bin/env bash
# Used by pipeline "GCP 1 - Main service account + key".
# Makes sure the main (admin) service account exists with the 5 admin roles - it is created only
# if missing, never twice - and enables the APIs the later pipelines need.
#
# Usage: bash gcp-keys/main-sa.sh <project-id> <service-account-id>
# gcloud must already be signed in with an account that has Owner on the project.
set -euo pipefail

PROJECT_ID="${1:?project id}"
SA_ID="${2:?service account id}"
SA_EMAIL="$SA_ID@$PROJECT_ID.iam.gserviceaccount.com"
ROLES=(
  roles/owner
  roles/serviceusage.serviceUsageAdmin
  roles/resourcemanager.projectIamAdmin
  roles/iam.serviceAccountAdmin
  roles/iam.serviceAccountKeyAdmin
)

ok() { printf '  ok  %s\n' "$*"; }

if ! gcloud projects get-iam-policy "$PROJECT_ID" --format='value(etag)' >/dev/null 2>&1; then
  echo "::error::$(gcloud config get-value account 2>/dev/null) cannot manage IAM in $PROJECT_ID. Use a key of an account with Owner on $PROJECT_ID."
  exit 1
fi

echo "APIs"
gcloud services enable --project="$PROJECT_ID" \
  iam.googleapis.com iamcredentials.googleapis.com cloudresourcemanager.googleapis.com \
  serviceusage.googleapis.com compute.googleapis.com container.googleapis.com \
  containerregistry.googleapis.com storage.googleapis.com
ok "enabled"

echo "Main service account"
if gcloud iam service-accounts describe "$SA_EMAIL" --project="$PROJECT_ID" >/dev/null 2>&1; then
  ok "$SA_EMAIL already exists - using it (not created again)"
else
  gcloud iam service-accounts create "$SA_ID" --project="$PROJECT_ID" \
    --display-name="$SA_ID" --description="Main admin service account (creates the cluster service account)"
  ok "created $SA_EMAIL"
  # A new account takes a few seconds before IAM accepts it in role bindings.
  sleep "${SA_CREATE_WAIT:-10}"
fi

echo "Roles"
have="$(gcloud projects get-iam-policy "$PROJECT_ID" --flatten='bindings[].members' \
  --filter="bindings.members:serviceAccount:$SA_EMAIL" --format='value(bindings.role)')"
for role in "${ROLES[@]}"; do
  if grep -qx "$role" <<<"$have"; then
    ok "$role"
  else
    gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$SA_EMAIL" \
      --role="$role" --condition=None --quiet --format=none
    ok "$role (granted)"
  fi
done
