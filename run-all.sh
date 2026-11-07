#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -n "${APP_JAR:-}" ]]; then
  app_jar="${APP_JAR}"
elif [[ -f /app.jar ]]; then
  app_jar=/app.jar
else
  app_jar="${SCRIPT_DIR}/travel-ota/target/travel-ota-1.0-SNAPSHOT.jar"
fi
if [[ -n "${TRAVEL_AGENT_DIR:-}" ]]; then
  agent_dir="${TRAVEL_AGENT_DIR}"
elif [[ -d "${SCRIPT_DIR}/travel-agent-demo" ]]; then
  agent_dir="${SCRIPT_DIR}/travel-agent-demo"
else
  agent_dir=/opt/travel-agent-demo
fi
SERVER_PORT="${SERVER_PORT:-8080}"
TRAVEL_AGENT_PORT="${TRAVEL_AGENT_PORT:-4310}"
TRAVEL_AGENT_HOST="${TRAVEL_AGENT_HOST:-127.0.0.1}"
TRAVEL_OTA_BASE_URL="${TRAVEL_OTA_BASE_URL:-http://127.0.0.1:${SERVER_PORT}}"
AIRLINE_NDC_BASE_URL="${AIRLINE_NDC_BASE_URL:-https://spair.softprobe.ai/ndc/v21.3}"
TENANT_SALES_REGION="${TENANT_SALES_REGION:-MEA}"

export SERVER_PORT TRAVEL_AGENT_PORT TRAVEL_AGENT_HOST TRAVEL_OTA_BASE_URL AIRLINE_NDC_BASE_URL TENANT_SALES_REGION

if [[ ! -f "${app_jar}" ]]; then
  echo "OTA application JAR not found: ${app_jar}" >&2
  exit 1
fi
if [[ ! -f "${agent_dir}/src/start.mjs" ]]; then
  echo "Travel agent runtime not found: ${agent_dir}/src/start.mjs" >&2
  exit 1
fi

java_agent_args=()
if [[ -f /otel.jar ]]; then
  java_agent_args+=(
    -javaagent:/otel.jar
    -Dotel.traces.exporter=none
    -Dotel.metrics.exporter=none
    -Dotel.logs.exporter=none
    -Dotel.resource.attributes=service.name=sp-storage
    -Dotel.instrumentation.http.server.capture-request-headers=tracestate
    -Dotel.instrumentation.http.server.capture-response-headers=tracestate
  )
fi

java ${JAVA_OPTS:-} "${java_agent_args[@]}" -jar "${app_jar}" --server.port="${SERVER_PORT}" &
ota_pid=$!

(
  cd "${agent_dir}"
  exec node src/start.mjs
) &
agent_pid=$!

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  kill -TERM "${ota_pid}" "${agent_pid}" 2>/dev/null || true
  wait "${ota_pid}" 2>/dev/null || true
  wait "${agent_pid}" 2>/dev/null || true
  exit "${status}"
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

wait -n "${ota_pid}" "${agent_pid}"
