#!/usr/bin/env bash
set -euo pipefail

LISTEN_PORT="${PORT:-${TRAVEL_AGENT_PORT:-8080}}"
SERVER_PORT="${SERVER_PORT:-8081}"
AGENT_PORT="${AGENT_PORT:-4311}"
PAYMENT_LISTEN_ADDR="${PAYMENT_LISTEN_ADDR:-127.0.0.1:8082}"
NOTIFICATION_LISTEN_ADDR="${NOTIFICATION_LISTEN_ADDR:-127.0.0.1:8083}"
TRAVEL_OTA_BASE_URL="${TRAVEL_OTA_BASE_URL:-http://127.0.0.1:${SERVER_PORT}}"
AIRLINE_NDC_BASE_URL="${AIRLINE_NDC_BASE_URL:-https://spair.softprobe.ai/ndc/v21.3}"
TENANT_SALES_REGION="${TENANT_SALES_REGION:-MEA}"

export LISTEN_PORT SERVER_PORT AGENT_PORT PAYMENT_LISTEN_ADDR NOTIFICATION_LISTEN_ADDR
export TRAVEL_OTA_BASE_URL AIRLINE_NDC_BASE_URL TENANT_SALES_REGION

mkdir -p /etc/nginx/demo-ota.d /etc/nginx/demo-ota-web.d /etc/nginx/demo-ota-chat.d /run

if [[ -d /etc/demo-ota/init.d ]]; then
  for hook in /etc/demo-ota/init.d/*.sh; do
    if [[ -f "${hook}" ]]; then
      # shellcheck disable=SC1090
      source "${hook}"
    fi
  done
fi

pg_started=0
if [[ -z "${SPRING_DATASOURCE_URL:-}" ]]; then
  PG_BIN="$(echo /usr/lib/postgresql/*/bin | awk '{print $1}')"
  PG_DATA="/tmp/pgdata"
  rm -rf "${PG_DATA}"
  cp -a /var/lib/postgresql/ota-seed "${PG_DATA}"
  chown -R postgres:postgres "${PG_DATA}"
  chmod 700 "${PG_DATA}"
  mkdir -p /var/run/postgresql
  chown postgres:postgres /var/run/postgresql
  su - postgres -c "${PG_BIN}/pg_ctl -D ${PG_DATA} -l /tmp/postgres.log -w start"
  pg_started=1
  export SPRING_DATASOURCE_URL="jdbc:postgresql://127.0.0.1:5432/ota"
  export SPRING_DATASOURCE_USERNAME="postgres"
  export SPRING_DATASOURCE_PASSWORD=""
fi

/usr/local/bin/ota-sandbox &
sandbox_pid=$!

for _ in $(seq 1 50); do
  if curl -fsS "http://${PAYMENT_LISTEN_ADDR}/healthz" >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done

java ${JAVA_OPTS:-} ${APP_JAVA_OPTS:-} -jar /app.jar --server.port="${SERVER_PORT}" &
ota_pid=$!

for _ in $(seq 1 180); do
  if ! kill -0 "${ota_pid}" 2>/dev/null; then
    echo "travel-ota exited unexpectedly during startup" >&2
    exit 1
  fi
  if bash -c "exec 3<>/dev/tcp/127.0.0.1/${SERVER_PORT}" 2>/dev/null; then
    break
  fi
  sleep 0.25
done

agent_pid=""
if [[ -n "${AGENT_CMD:-}" ]]; then
  (
    cd "${AGENT_WORKDIR:-/opt/agent}"
    exec bash -lc "${AGENT_CMD}"
  ) &
  agent_pid=$!
  for _ in $(seq 1 120); do
    if ! kill -0 "${agent_pid}" 2>/dev/null; then
      echo "AI agent exited unexpectedly during startup" >&2
      exit 1
    fi
    if bash -c "exec 3<>/dev/tcp/127.0.0.1/${AGENT_PORT}" 2>/dev/null; then
      break
    fi
    sleep 0.25
  done
fi

extra_pids=()
if [[ -d /etc/demo-ota/post-start.d ]]; then
  for hook in /etc/demo-ota/post-start.d/*.sh; do
    if [[ -f "${hook}" ]]; then
      # shellcheck disable=SC1090
      source "${hook}"
    fi
  done
fi

sed "s/\${LISTEN_PORT}/${LISTEN_PORT}/g" /etc/nginx/nginx.conf.template >/etc/nginx/nginx.conf
nginx -g 'daemon off;' &
nginx_pid=$!

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  for pid in "${extra_pids[@]:-}"; do
    [[ -n "${pid}" ]] && kill -TERM "${pid}" 2>/dev/null || true
  done
  kill -TERM "${nginx_pid}" ${agent_pid:+${agent_pid}} "${ota_pid}" "${sandbox_pid}" 2>/dev/null || true
  wait "${nginx_pid}" 2>/dev/null || true
  if [[ -n "${agent_pid}" ]]; then wait "${agent_pid}" 2>/dev/null || true; fi
  wait "${ota_pid}" 2>/dev/null || true
  wait "${sandbox_pid}" 2>/dev/null || true
  for pid in "${extra_pids[@]:-}"; do
    [[ -n "${pid}" ]] && wait "${pid}" 2>/dev/null || true
  done
  if [[ "${pg_started}" == "1" ]]; then
    PG_BIN="$(echo /usr/lib/postgresql/*/bin | awk '{print $1}')"
    su - postgres -c "${PG_BIN}/pg_ctl -D /tmp/pgdata -m fast -w stop" >/dev/null 2>&1 || true
  fi
  exit "${status}"
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [[ -n "${agent_pid}" ]]; then
  wait -n "${ota_pid}" "${agent_pid}" "${nginx_pid}" "${sandbox_pid}"
else
  wait -n "${ota_pid}" "${nginx_pid}" "${sandbox_pid}"
fi
