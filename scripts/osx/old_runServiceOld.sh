#!/bin/bash
set -euo pipefail

NODE_SCRIPT="server.js"
BASH_SCRIPT="launchTurn.sh"
LOG_DIR="$HOME/Library/Logs/my-service"
mkdir -p "$LOG_DIR"

pids=()

cleanup() {
  echo "Stopping services..."
  for pid in "${pids[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait
  exit 0
}

trap cleanup SIGTERM SIGINT EXIT

# Start node script
node "$NODE_SCRIPT" >> "$LOG_DIR/niloServer.log" 2>&1 &
pids+=($!)
echo "Started node script, PID ${pids[-1]}"

# Start bash script
bash "$BASH_SCRIPT" >> "$LOG_DIR/coTurn.log" 2>&1 &
pids+=($!)
echo "Started bash script, PID ${pids[-1]}"

# Wait on both; if either dies, cleanup fires and kills the other
wait -n "${pids[@]}"
cleanup