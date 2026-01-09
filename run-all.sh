#!/bin/bash
set -euo pipefail
set -m

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

pids=()
pgids=()

cleanup() {
  for pgid in "${pgids[@]:-}"; do
    if [ -n "${pgid}" ] && kill -0 "-${pgid}" 2>/dev/null; then
      kill -TERM "-${pgid}" 2>/dev/null || true
    fi
  done
  sleep 2
  for pgid in "${pgids[@]:-}"; do
    if [ -n "${pgid}" ] && kill -0 "-${pgid}" 2>/dev/null; then
      kill -KILL "-${pgid}" 2>/dev/null || true
    fi
  done
}

trap cleanup EXIT INT TERM

start_service() {
  local dir="$1"
  (cd "${dir}" && ./run.sh) &
  local pid="$!"
  pids+=("${pid}")
  local pgid
  pgid="$(ps -o pgid= "${pid}" | tr -d ' ')"
  pgids+=("${pgid}")
}

start_service "${SCRIPT_DIR}/sp-airline"
start_service "${SCRIPT_DIR}/travel-ota"

wait
