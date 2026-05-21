#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/home/kael/sports-sync-pi"
SERVICE_NAME="sports-sync-pi"

cd "$APP_DIR"

if [ ! -d ".git" ]; then
  echo "ERROR: $APP_DIR is not a git clone."
  echo "Clone https://github.com/Kaelidoscopic/SportsRadioApp.git into $APP_DIR before using this updater."
  exit 1
fi

git pull origin main

if [ -f "server/package.json" ]; then
  npm install --omit=dev --prefix server
else
  npm install --omit=dev
fi

sudo systemctl restart "$SERVICE_NAME"
sudo systemctl status "$SERVICE_NAME" --no-pager
