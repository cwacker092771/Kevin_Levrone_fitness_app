#!/bin/bash
# Pull the latest code and restart the app. Run this ON the EC2 instance
# (via `aws ssm start-session --target <instance-id>` or SSH), as root or sudo.
set -euo pipefail

APP_DIR=/opt/levrone/app
BRANCH="${1:-main}"

cd "$APP_DIR"
sudo -u levrone git fetch origin "$BRANCH"
sudo -u levrone git reset --hard "origin/$BRANCH"
sudo -u levrone npm ci --omit=dev

systemctl restart levrone
sleep 2
systemctl --no-pager --lines=20 status levrone
curl -fsS localhost:3000/healthz && echo
