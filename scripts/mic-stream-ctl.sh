#!/usr/bin/env bash
# Simple control for the Mic Stream systemd service.
# Run install-service.sh once first to set it up.
#
# Usage: ./mic-stream-ctl.sh <command>
#
#   activate    Enable + start — runs now, and auto-starts on every future boot.
#   deactivate  Stop + disable — stops now, and won't start on boot anymore.
#   start       Start now (without changing boot behavior).
#   stop        Stop now (without changing boot behavior).
#   restart     Restart now (e.g. after editing the unit file or server.js).
#   status      Show whether it's running, and the last few log lines.
#   logs        Follow the live log (Ctrl-C to stop watching).

set -euo pipefail

SERVICE="mic-stream"
CMD="${1:-}"

need_sudo() {
  if [ "$(id -u)" -ne 0 ]; then
    echo "Re-run with sudo: sudo ./mic-stream-ctl.sh $CMD" >&2
    exit 1
  fi
}

case "$CMD" in
  activate)
    need_sudo
    systemctl enable "$SERVICE"
    systemctl start "$SERVICE"
    echo "Activated — running now, and will auto-start on every boot."
    ;;
  deactivate)
    need_sudo
    systemctl stop "$SERVICE"
    systemctl disable "$SERVICE"
    echo "Deactivated — stopped, and won't start on boot until you activate it again."
    ;;
  start)
    need_sudo
    systemctl start "$SERVICE"
    echo "Started."
    ;;
  stop)
    need_sudo
    systemctl stop "$SERVICE"
    echo "Stopped."
    ;;
  restart)
    need_sudo
    systemctl restart "$SERVICE"
    echo "Restarted."
    ;;
  status)
    systemctl status "$SERVICE" --no-pager -l
    ;;
  logs)
    journalctl -u "$SERVICE" -f
    ;;
  *)
    echo "Usage: $0 {activate|deactivate|start|stop|restart|status|logs}"
    echo
    echo "  activate    enable + start (auto-starts on boot, running now)"
    echo "  deactivate  stop + disable (won't start on boot anymore)"
    echo "  start/stop/restart   control the running service without touching boot behavior"
    echo "  status      is it running? recent log lines"
    echo "  logs        follow the live log"
    exit 1
    ;;
esac
