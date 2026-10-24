#!/usr/bin/env bash
# Stops the integration-test dependencies and deletes their data.
set -euo pipefail

FILE="$(dirname "$0")/../../infra/docker/compose.test.yml"
PROJECT="${TEST_COMPOSE_PROJECT:-chat-test}"

if docker compose version >/dev/null 2>&1; then
  docker compose -p "$PROJECT" -f "$FILE" down -v --remove-orphans
else
  docker-compose -p "$PROJECT" -f "$FILE" down -v --remove-orphans
fi
