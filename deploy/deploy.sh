#!/usr/bin/env bash
#
# Forced command for the `deploy` user's GitHub Actions key (see authorized_keys).
# Usage over SSH:  echo "$GHCR_TOKEN" | ssh deploy@host "<git-sha> <github-actor>"
# The command arrives as $SSH_ORIGINAL_COMMAND and is validated before use.
set -euo pipefail

read -r TAG ACTOR <<<"${SSH_ORIGINAL_COMMAND:-${1:-} ${2:-}}"

[[ "$TAG" =~ ^[0-9a-f]{40}$ ]] || { echo "rejected: bad tag '$TAG'" >&2; exit 1; }
[[ "$ACTOR" =~ ^[A-Za-z0-9-]{1,39}$ ]] || { echo "rejected: bad actor '$ACTOR'" >&2; exit 1; }

cd /var/www/tuition-lms
export DOCKER_CONFIG=/var/www/tuition-lms/.docker

docker login ghcr.io -u "$ACTOR" --password-stdin
trap 'docker logout ghcr.io >/dev/null 2>&1 || true' EXIT

PREVIOUS=$(sed -n 's/^IMAGE_TAG=//p' .env 2>/dev/null || true)
IMAGE_TAG="$TAG" docker compose pull

# Migrate with the NEW image before switching traffic. Owner credentials come from
# migrate.env and are passed only to this one-off container, never to the running API.
# Migrations must stay compatible with the old code still running (expand → contract).
set -a; . ./migrate.env; set +a
IMAGE_TAG="$TAG" docker compose run --rm --no-deps -e MIGRATION_DATABASE_URL api node dist/migrate.js latest

echo "IMAGE_TAG=$TAG" > .env
echo "$(date -u +%FT%TZ) $PREVIOUS -> $TAG" >> deploy.log
docker compose up -d --remove-orphans
docker image prune -f >/dev/null
echo "deployed $TAG"
