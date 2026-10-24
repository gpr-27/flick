#!/bin/sh
# Prepares MinIO for the app. Safe to run on every start.
#   1. A PRIVATE bucket: no anonymous access; files are read and written only
#      through short-lived presigned URLs that the api hands out.
#   2. An app user that can only touch that one bucket, so a leaked app key
#      cannot read or delete anything else.
# CORS is set on the server (MINIO_API_CORS_ALLOW_ORIGIN): MinIO has no
# per-bucket CORS. On real S3 / R2, set a bucket CORS rule instead.
set -eu

mc alias set local "${MINIO_ENDPOINT:-http://minio:9000}" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"

mc mb --ignore-existing "local/$S3_BUCKET"
mc anonymous set none "local/$S3_BUCKET"

cat >/tmp/policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": ["s3:ListBucket"], "Resource": ["arn:aws:s3:::$S3_BUCKET"] },
    { "Effect": "Allow", "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"], "Resource": ["arn:aws:s3:::$S3_BUCKET/*"] }
  ]
}
EOF
mc admin policy create local chat-app /tmp/policy.json
mc admin user add local "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY"
# Attaching an already attached policy fails, which is fine on a re-run.
mc admin policy attach local chat-app --user "$S3_ACCESS_KEY_ID" || true

echo "bucket $S3_BUCKET is ready"
