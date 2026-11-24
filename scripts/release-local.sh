#!/usr/bin/env bash
# Releases origin/main to the server from this computer, the same steps as .github/workflows/deploy.yml.
# Use it when GitHub Actions has run out of minutes. It tests and builds a clean copy of the commit in a temp
# folder, so your working files are not touched.
#
#   DEPLOY_HOST=<server> DEPLOY_USER=<user> DEPLOY_SSH_KEY_FILE=<path to the private key> npm run release:local
#
# Optional: pass another commit or branch, e.g. `npm run release:local -- origin/main~1` to roll back one commit.
set -euo pipefail

: "${DEPLOY_HOST:?Set DEPLOY_HOST to the server name}"
: "${DEPLOY_USER:?Set DEPLOY_USER to the deploy user}"
REF="${1:-origin/main}"

git fetch origin --quiet
SHA="$(git rev-parse "$REF")"
echo "Releasing $SHA ($(git log -1 --format=%s "$SHA"))"

SSH_OPTS=(-o IdentitiesOnly=yes)
[ -n "${DEPLOY_SSH_KEY_FILE:-}" ] && SSH_OPTS+=(-i "$DEPLOY_SSH_KEY_FILE")

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
git archive "$SHA" | tar -x -C "$WORK"
cd "$WORK"

npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm prune --omit=dev
tar -czf release.tgz dist drizzle web package.json package-lock.json node_modules

scp "${SSH_OPTS[@]}" release.tgz "$DEPLOY_USER@$DEPLOY_HOST:/srv/fynix-sales/incoming/$SHA.tgz"
ssh "${SSH_OPTS[@]}" "$DEPLOY_USER@$DEPLOY_HOST" "sudo /usr/local/bin/fynix-sales-release $SHA"
echo "Released $SHA"
