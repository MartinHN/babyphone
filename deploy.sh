#!/usr/bin/env bash
# Deploy the relay server to the Raspberry Pi over SSH.
#
# No build step — "deploy" is: copy the runtime files over, install deps on the
# Pi (server.js needs express/ws/selfsigned/json5), then restart the systemd
# service so it picks up the new code.
#
# Usage:
#   ./deploy.sh                 # copy + install deps + restart on the default host
#   ./deploy.sh --no-restart    # copy + install deps only, leave the service alone
#   ./deploy.sh --no-install    # skip 'bun install' on the Pi (deps unchanged)
#   HOST=char ./deploy.sh       # override the SSH host (must be in ~/.ssh/config
#                               #   or otherwise resolvable)
#   REMOTE_DIR=~/foo ./deploy.sh  # override the remote directory
#
# Requires: rsync + ssh on this machine, and key-based SSH already working to
# the target (this script never prompts for a password itself). The remote
# already has the service installed via install-service.sh, and 'bun' on PATH.

set -euo pipefail

HOST="${HOST:-tinmarpi}"
# Where server.js lives on the Pi — must match install-service.sh's WorkingDirectory.
REMOTE_DIR="${REMOTE_DIR:-Built/nilophone}"
SERVICE="${SERVICE:-mic-stream}"

RESTART=1
INSTALL=1
for arg in "$@"; do
  case "$arg" in
    --no-restart) RESTART=0 ;;
    --no-install) INSTALL=0 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "Unknown argument: $arg" >&2; exit 1 ;;
  esac
done

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO"

for f in server.js package.json docs; do
  [ -e "$f" ] || { echo "Missing $f in $REPO — run this from the repo." >&2; exit 1; }
done

echo "Deploying to $HOST:$REMOTE_DIR"
echo

# Make sure the remote directory exists.
ssh "$HOST" "mkdir -p '$REMOTE_DIR/docs'"

# Copy the runtime files. --delete on docs/ so removed static assets don't linger.
# node_modules is NOT copied (built for the wrong arch / not in the repo) — deps
# are installed on the Pi below. certs/ carries the persisted cert + access token.
rsync -av --delete \
  server.js package.json docs certs \
  "$HOST:$REMOTE_DIR/"

# Ship only bun's lockfile. Leaving a stray package-lock.json / pnpm-lock.yaml in
# the remote dir makes bun try to migrate it on every install, which trips
# "lockfile had changes, but lockfile is frozen".
if [ -f bun.lock ]; then
  rsync -av bun.lock "$HOST:$REMOTE_DIR/"
else
  echo "No bun.lock in repo — generate one with 'bun install' and commit it." >&2
  exit 1
fi
ssh "$HOST" "cd '$REMOTE_DIR' && rm -f package-lock.json pnpm-lock.yaml bun.lockb"

if [ "$INSTALL" -eq 1 ]; then
  echo
  echo "Installing deps on $HOST ..."
  ssh "$HOST" "cd '$REMOTE_DIR' && \$HOME/.bun/bin/bun install --production --frozen-lockfile"
fi

# if [ "$RESTART" -eq 1 ]; then
#   echo
#   echo "Restarting $SERVICE ..."
#   ssh -t "$HOST" "sudo systemctl restart '$SERVICE' && sudo systemctl --no-pager status '$SERVICE' | head -6"
# else
#   echo
#   echo "Skipped restart (--no-restart). Restart later with:"
#   echo "  ssh $HOST sudo systemctl restart $SERVICE"
# fi

echo
echo "Done."
