#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${SPORTSYNC_APP_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
SERVER_DIR="$APP_DIR/server"
SERVICE_NAME="${SPORTSYNC_SERVICE_NAME:-venue-audio-box}"

echo "Updating Sports Sync Pi appliance..."
echo "Repo: $APP_DIR"

cd "$APP_DIR"

if [ ! -d ".git" ]; then
  echo "ERROR: $APP_DIR is not a git clone."
  echo "Clone https://github.com/Kaelidoscopic/SportsRadioApp.git into $APP_DIR before using this updater."
  exit 1
fi

echo "Pulling latest changes from GitHub..."
git pull --ff-only origin "${SPORTSYNC_GIT_BRANCH:-main}"

if [ ! -d "$SERVER_DIR" ]; then
  echo "ERROR: Server directory not found at $SERVER_DIR."
  exit 1
fi

echo "Installing server dependencies..."
cd "$SERVER_DIR"
npm ci --omit=dev

echo "Restarting $SERVICE_NAME..."
sudo systemctl restart "$SERVICE_NAME"

echo "Service status:"
sudo systemctl status "$SERVICE_NAME" --no-pager

echo "Update complete."
echo "To watch logs, run:"
echo "sudo journalctl -u $SERVICE_NAME -f"
