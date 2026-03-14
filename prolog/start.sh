#!/usr/bin/env bash
set -euo pipefail

PIDFILE="${PIDFILE:-/tmp/prolog-mcp.pid}"
SWIPL_PORT="${SWIPL_PORT:-7474}"
KB_DIR="${KB_DIR:-$HOME/.local/share/prolog-mcp}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "prolog-mcp: swipl already running (pid $(cat "$PIDFILE"))"
  exit 0
fi

mkdir -p "$KB_DIR/agents" "$KB_DIR/sessions" "$KB_DIR/scratch"
[ -f "$KB_DIR/core.pl" ] || echo "% core knowledge base" > "$KB_DIR/core.pl"

SWIPL_PORT="$SWIPL_PORT" KB_DIR="$KB_DIR" \
  swipl -q "$SCRIPT_DIR/server.pl" &

echo $! > "$PIDFILE"
echo "prolog-mcp: started swipl (pid $!) on :$SWIPL_PORT"
