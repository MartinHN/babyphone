#!/usr/bin/env bash
# Installs Mic Stream as a systemd service: starts on boot, restarts on crash.
#
# Run this FROM the babyphone repo directory (where server.js lives), with sudo:
#   cd ~/babyphone && sudo ./install-service.sh
#
# Re-running it is safe — it overwrites the unit file with freshly detected
# paths and restarts the service.

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Needs root (systemd unit files live in /etc/systemd/system)." >&2
  echo "Re-run as: sudo ./install-service.sh" >&2
  exit 1
fi

# The user who ran 'sudo' — NOT root — so the service runs as your normal
# account rather than root (no reason for this to have root privileges).
SERVICE_USER="${SUDO_USER:-$(logname 2>/dev/null || echo pi)}"

# Absolute path to this repo (wherever it actually is, not a hardcoded guess).
WORKDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ ! -f "$WORKDIR/server.js" ]; then
  echo "server.js not found in $WORKDIR — run this script from inside the babyphone repo." >&2
  exit 1
fi

# Full path to node — systemd services get a minimal PATH, so 'ExecStart=node ...'
# silently fails to start if node was installed via nvm or a non-standard location.
# Resolving it as the target user (not root) matters if node is nvm-managed,
# since nvm's shims live under that user's home directory, not root's.
NODE_BIN="$(sudo -u "$SERVICE_USER" bash -lc 'command -v node' 2>/dev/null || true)"
if [ -z "$NODE_BIN" ]; then
  echo "Could not find 'node' in ${SERVICE_USER}'s PATH. Install Node.js first, or" >&2
  echo "edit the generated unit file's ExecStart= line with the correct path." >&2
  exit 1
fi

UNIT_PATH="/etc/systemd/system/mic-stream.service"

echo "Installing service:"
echo "  User:        $SERVICE_USER"
echo "  Working dir: $WORKDIR"
echo "  Node:        $NODE_BIN"
echo

cat > "$UNIT_PATH" <<EOF
[Unit]
Description=Mic Stream signaling server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$WORKDIR
ExecStart=$NODE_BIN $WORKDIR/server.js
Restart=always
RestartSec=3

# Uncomment and edit any of these as needed, then run:
#   sudo systemctl daemon-reload && sudo systemctl restart mic-stream
#
# Environment=PORT=3000
# Environment=ACCESS_TOKEN=pin-a-fixed-token-here-instead-of-the-generated-one
# Environment=TRUST_PROXY=1

# Light, safe sandboxing — doesn't restrict anything server.js actually needs
# (writing certs/ and certs/access-token.txt under WorkingDirectory still works).
NoNewPrivileges=yes
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable mic-stream
systemctl restart mic-stream

echo
echo "Done. Service is enabled (starts on boot) and running now."
echo
sleep 1
systemctl status mic-stream --no-pager -l | head -12
echo
echo "Look for the access token + URL in the logs:"
echo "  journalctl -u mic-stream -n 30 --no-pager"
echo
echo "From now on, use ./mic-stream-ctl.sh to activate/deactivate it."
