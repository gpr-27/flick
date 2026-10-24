#!/usr/bin/env bash
# Starts Postgres, Redis and MinIO for integration tests, waits until
# they are healthy, creates the bucket, then prints the env vars
# the tests need:
#
#   eval "$(scripts/dev/test-deps-up.sh)"
#   npm run test:integration
#   scripts/dev/test-deps-down.sh
#
# Progress goes to stderr so that stdout is only the export lines.
set -euo pipefail

FILE="$(dirname "$0")/../../infra/docker/compose.test.yml"
PROJECT="${TEST_COMPOSE_PROJECT:-chat-test}"

# Prefer the `docker compose` plugin, fall back to the standalone binary.
if docker compose version >/dev/null 2>&1; then
  compose() { docker compose -p "$PROJECT" -f "$FILE" "$@"; }
else
  compose() { docker-compose -p "$PROJECT" -f "$FILE" "$@"; }
fi

compose up -d --wait postgres redis minio >&2
# `run` waits for the one-shot job and fails if it fails.
compose run --rm minio-init >&2

cat <<EOF
export DATABASE_URL=postgres://chat:chat@localhost:${TEST_POSTGRES_PORT:-55432}/chat_test
export TEST_DATABASE_URL=postgres://chat:chat@localhost:${TEST_POSTGRES_PORT:-55432}/chat_test
export REDIS_URL=redis://localhost:${TEST_REDIS_PORT:-56379}
export S3_ENDPOINT=http://localhost:${TEST_MINIO_PORT:-59000}
export S3_PUBLIC_ENDPOINT=http://localhost:${TEST_MINIO_PORT:-59000}
export S3_REGION=us-east-1
export S3_BUCKET=chat-media-test
export S3_ACCESS_KEY_ID=chat-test
export S3_SECRET_ACCESS_KEY=chat-test-secret
export S3_FORCE_PATH_STYLE=true
EOF
