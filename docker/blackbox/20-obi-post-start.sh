#!/usr/bin/env bash
set -euo pipefail

if [[ "${BLACKBOX_OBI_READY:-0}" == "1" && -x /usr/local/bin/obi && -f /opt/softprobe/obi.yaml.template ]]; then
  obi_cfg="$(mktemp /tmp/obi.XXXXXX.yaml)"
  obi_log="/tmp/obi.log"
  chmod 600 "${obi_cfg}"
  awk \
    -v ep="${OTEL_EXPORTER_OTLP_TRACES_ENDPOINT}" \
    -v key="${INGESTION_KEY}" \
    '{
      gsub(/\$\{OTEL_EXPORTER_OTLP_TRACES_ENDPOINT\}/, ep);
      gsub(/\$\{INGESTION_KEY\}/, key);
      print;
    }' /opt/softprobe/obi.yaml.template >"${obi_cfg}"
  OTEL_SERVICE_NAME="${SOFTPROBE_JAVA_SERVICE_NAME:-travel-ota}" /usr/local/bin/obi --config="${obi_cfg}" >"${obi_log}" 2>&1 &
  obi_bg_pid=$!
  extra_pids+=("${obi_bg_pid}")
  for _ in $(seq 1 40); do
    if ! kill -0 "${obi_bg_pid}" 2>/dev/null; then
      cat "${obi_log}" >&2 || true
      break
    fi
    if grep -qE "Launching p\.Tracer|injecting OpenTelemetry eBPF" "${obi_log}" 2>/dev/null; then
      break
    fi
    sleep 0.25
  done
fi
