#!/usr/bin/env bash
# Run on the server as the fynixsales user: pulls main, installs, builds, restarts.
set -euo pipefail
cd /srv/fynix-sales
git fetch --quiet origin main
git reset --hard origin/main
npm ci
npm run build
sudo systemctl restart fynix-sales
sleep 2
curl -fsS http://127.0.0.1:3600/health && echo " deployed"
