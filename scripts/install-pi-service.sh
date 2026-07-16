#!/usr/bin/env bash
set -Eeuo pipefail

SERVICE_NAME="venue-audio-box"
SERVICE_USER="${SUDO_USER:-${USER:-}}"
SERVICE_GROUP=""
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE=""
NODE_PATH="$(command -v node || true)"
FORCE=false
UNINSTALL=false

usage() {
  cat <<'USAGE'
Usage: sudo ./scripts/install-pi-service.sh [options]

Options:
  --user USER            Normal Linux user that owns/runs the app
  --group GROUP          Linux group (defaults to USER's primary group)
  --app-dir PATH         Repository path (defaults to this script's parent repo)
  --env-file PATH        Environment file (defaults to APP_DIR/.env)
  --node PATH            Node.js executable (defaults to command -v node)
  --service-name NAME    systemd unit name without .service
  --force                Replace a service previously created by this installer
  --uninstall            Stop, disable, and remove the managed service
  --help                 Show this help
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --user) SERVICE_USER="${2:?Missing value for --user}"; shift 2 ;;
    --group) SERVICE_GROUP="${2:?Missing value for --group}"; shift 2 ;;
    --app-dir) APP_DIR="${2:?Missing value for --app-dir}"; shift 2 ;;
    --env-file) ENV_FILE="${2:?Missing value for --env-file}"; shift 2 ;;
    --node) NODE_PATH="${2:?Missing value for --node}"; shift 2 ;;
    --service-name) SERVICE_NAME="${2:?Missing value for --service-name}"; shift 2 ;;
    --force) FORCE=true; shift ;;
    --uninstall) UNINSTALL=true; shift ;;
    --help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ $EUID -ne 0 ]]; then
  echo "Run this installer with sudo so it can manage /etc/systemd/system." >&2
  exit 1
fi

if [[ ! "$SERVICE_NAME" =~ ^[A-Za-z0-9_.@-]+$ ]]; then
  echo "Invalid service name: $SERVICE_NAME" >&2
  exit 1
fi

UNIT_PATH="/etc/systemd/system/${SERVICE_NAME}.service"
MARKER="# Managed by Venue Audio appliance installer"

if $UNINSTALL; then
  if [[ ! -f "$UNIT_PATH" ]]; then
    echo "$UNIT_PATH is not installed."
    exit 0
  fi
  if ! grep -Fqx "$MARKER" "$UNIT_PATH"; then
    echo "Refusing to remove unrelated service: $UNIT_PATH" >&2
    exit 1
  fi
  systemctl disable --now "${SERVICE_NAME}.service" || true
  rm -f -- "$UNIT_PATH"
  systemctl daemon-reload
  systemctl reset-failed "${SERVICE_NAME}.service" || true
  echo "Removed ${SERVICE_NAME}.service. Application files and config were preserved."
  exit 0
fi

APP_DIR="$(realpath "$APP_DIR")"
ENV_FILE="${ENV_FILE:-$APP_DIR/.env}"
ENV_FILE="$(realpath -m "$ENV_FILE")"
TEMPLATE_PATH="$APP_DIR/scripts/systemd/venue-audio-box.service.template"

if [[ -z "$SERVICE_USER" ]] || ! id "$SERVICE_USER" >/dev/null 2>&1; then
  echo "Supply an existing normal account with --user USER." >&2
  exit 1
fi
SERVICE_GROUP="${SERVICE_GROUP:-$(id -gn "$SERVICE_USER")}" 

if [[ ! -f "$APP_DIR/server/pi-host.js" || ! -f "$TEMPLATE_PATH" ]]; then
  echo "The repository or service template is incomplete at $APP_DIR." >&2
  exit 1
fi
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Environment file not found: $ENV_FILE" >&2
  echo "Copy server/.env.pi.example and fill in local values first." >&2
  exit 1
fi
if [[ -z "$NODE_PATH" || ! -x "$NODE_PATH" ]]; then
  echo "Node.js executable not found. Supply it with --node PATH." >&2
  exit 1
fi

for value in "$APP_DIR" "$ENV_FILE" "$NODE_PATH"; do
  if [[ "$value" == *$'\n'* ]]; then
    echo "Paths containing newlines are not supported." >&2
    exit 1
  fi
done

if [[ -e "$UNIT_PATH" ]]; then
  if ! grep -Fqx "$MARKER" "$UNIT_PATH"; then
    echo "Refusing to overwrite unrelated service: $UNIT_PATH" >&2
    exit 1
  fi
  if ! $FORCE; then
    echo "$UNIT_PATH is already managed by this installer." >&2
    echo "Re-run with --force to update it." >&2
    exit 1
  fi
fi

TEMP_UNIT="$(mktemp)"
trap 'rm -f -- "$TEMP_UNIT"' EXIT
escape_sed_replacement() {
  printf '%s' "$1" | sed 's/[&|\\]/\\&/g'
}
SERVICE_USER_ESCAPED="$(escape_sed_replacement "$SERVICE_USER")"
SERVICE_GROUP_ESCAPED="$(escape_sed_replacement "$SERVICE_GROUP")"
APP_DIR_ESCAPED="$(escape_sed_replacement "$APP_DIR")"
ENV_FILE_ESCAPED="$(escape_sed_replacement "$ENV_FILE")"
NODE_PATH_ESCAPED="$(escape_sed_replacement "$NODE_PATH")"
sed \
  -e "s|@SERVICE_USER@|$SERVICE_USER_ESCAPED|g" \
  -e "s|@SERVICE_GROUP@|$SERVICE_GROUP_ESCAPED|g" \
  -e "s|@APP_DIR@|$APP_DIR_ESCAPED|g" \
  -e "s|@ENV_FILE@|$ENV_FILE_ESCAPED|g" \
  -e "s|@NODE_PATH@|$NODE_PATH_ESCAPED|g" \
  "$TEMPLATE_PATH" >"$TEMP_UNIT"

install -o root -g root -m 0644 "$TEMP_UNIT" "$UNIT_PATH"
systemctl daemon-reload
systemctl enable --now "${SERVICE_NAME}.service"

echo "Installed and started ${SERVICE_NAME}.service."
systemctl --no-pager --full status "${SERVICE_NAME}.service" || true
echo "Logs: journalctl -u ${SERVICE_NAME}.service -f"
