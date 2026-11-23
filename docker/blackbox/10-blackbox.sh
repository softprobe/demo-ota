#!/usr/bin/env bash
set -euo pipefail

if [[ "${SOFTPROBE_DISABLED:-0}" == "1" ]]; then
  return 0 2>/dev/null || exit 0
fi

INGESTION_KEY="${INGESTION_KEY:-${SOFTPROBE_INGESTION_KEY:-}}"
if [[ -z "${INGESTION_KEY}" ]]; then
  echo "ERROR: Set INGESTION_KEY to your Softprobe Explorer Ingestion Key (spk_...)" >&2
  exit 1
fi

TRACES_ENDPOINT="${OTEL_EXPORTER_OTLP_TRACES_ENDPOINT:-${SOFTPROBE_OTLP_ENDPOINT:-https://explorer.softprobe.ai/api/thelake/v1/traces}}"
ENVIRONMENT_NAME="${SOFTPROBE_ENVIRONMENT:-demo}"
OTA_WEB_SERVICE="${SOFTPROBE_OTA_WEB_SERVICE_NAME:-travel-ota-web}"
CHAT_WEB_SERVICE="${SOFTPROBE_CHAT_WEB_SERVICE_NAME:-travel-web}"
AI_SERVICE="${SOFTPROBE_AI_SERVICE_NAME:-travel-agent}"
JAVA_SERVICE="${SOFTPROBE_JAVA_SERVICE_NAME:-travel-ota}"

export INGESTION_KEY
export OTEL_EXPORTER_OTLP_TRACES_ENDPOINT="${TRACES_ENDPOINT}"
export OTEL_EXPORTER_OTLP_TRACES_HEADERS="Authorization=Bearer ${INGESTION_KEY}"
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer ${INGESTION_KEY}"
export OTEL_EXPORTER_OTLP_TRACES_PROTOCOL="http/protobuf"
export SOFTPROBE_ENVIRONMENT="${ENVIRONMENT_NAME}"
export SOFTPROBE_AI_SERVICE_NAME="${AI_SERVICE}"

js_escape() {
  awk -v val="$1" 'BEGIN {
    gsub(/\\/, "\\\\", val);
    gsub(/"/, "\\\"", val);
    gsub(/\r/, "", val);
    gsub(/\n/, "\\n", val);
    printf "%s", val;
  }'
}

JS_KEY="$(js_escape "${INGESTION_KEY}")"
JS_ENDPOINT="$(js_escape "${TRACES_ENDPOINT}")"
JS_ENV="$(js_escape "${ENVIRONMENT_NAME}")"
JS_OTA_SVC="$(js_escape "${OTA_WEB_SERVICE}")"
JS_CHAT_SVC="$(js_escape "${CHAT_WEB_SERVICE}")"

mkdir -p /opt/softprobe/web

cat >/opt/softprobe/web/ota-init.js <<EOF_OTA_JS
if (window.RecordSdk && !window.__softprobeSession) {
  window.__softprobeSession = window.RecordSdk.init({
    ingestionKey: "${JS_KEY}",
    serviceName: "${JS_OTA_SVC}",
    captureSemanticActions: true,
    inputCapture: "secrets-only",
    otlp: {
      tracesEndpoint: "${JS_ENDPOINT}",
      protocol: "http/protobuf"
    },
    resourceAttributes: {
      "deployment.environment.name": "${JS_ENV}"
    },
    httpBodyCapture: {
      routes: [
        { method: "POST", path: "/api/flights/*" }
      ]
    }
  });
}
EOF_OTA_JS

cat >/opt/softprobe/web/chat-init.js <<EOF_CHAT_JS
if (window.RecordSdk && !window.__softprobeSession) {
  window.__softprobeSession = window.RecordSdk.init({
    ingestionKey: "${JS_KEY}",
    serviceName: "${JS_CHAT_SVC}",
    captureSemanticActions: true,
    inputCapture: "secrets-only",
    otlp: {
      tracesEndpoint: "${JS_ENDPOINT}",
      protocol: "http/protobuf"
    },
    resourceAttributes: {
      "deployment.environment.name": "${JS_ENV}"
    },
    httpBodyCapture: {
      routes: [
        { method: "POST", path: "/agent/api/sessions" },
        { method: "POST", path: "/agent/api/sessions/*/messages" },
        { method: "POST", path: "/agent/api/sessions/*/approve" },
        { method: "POST", path: "/agent/api/sessions/*/pay" },
        { method: "POST", path: "/agent/api/sessions/*/cancel-booking" },
        { method: "POST", path: "/agent/api/sessions/*/abort" }
      ]
    }
  });
}
EOF_CHAT_JS

cat >/etc/nginx/demo-ota.d/blackbox.conf <<'NGINX_COMMON'
location = /__softprobe/web-record.js {
    alias /opt/softprobe/web/web-record.js;
    default_type application/javascript;
    add_header Cache-Control "no-store";
}
location = /__softprobe/ota-init.js {
    alias /opt/softprobe/web/ota-init.js;
    default_type application/javascript;
    add_header Cache-Control "no-store";
}
location = /__softprobe/chat-init.js {
    alias /opt/softprobe/web/chat-init.js;
    default_type application/javascript;
    add_header Cache-Control "no-store";
}
NGINX_COMMON

cat >/etc/nginx/demo-ota-web.d/blackbox.conf <<'NGINX_WEB'
sub_filter '</head>' '<script src="/__softprobe/web-record.js"></script><script src="/__softprobe/ota-init.js"></script></head>';
sub_filter_once on;
NGINX_WEB

cat >/etc/nginx/demo-ota-chat.d/blackbox.conf <<'NGINX_CHAT'
sub_filter '</head>' '<script src="/__softprobe/web-record.js"></script><script src="/__softprobe/chat-init.js"></script></head>';
sub_filter_once on;
NGINX_CHAT

if [[ -f /opt/softprobe/node/init-vercel-ai.mjs ]]; then
  export NODE_OPTIONS="${NODE_OPTIONS:-} --import /opt/softprobe/node/init-vercel-ai.mjs"
fi

if [[ -f /opt/softprobe/python/sitecustomize.py ]]; then
  export PYTHONPATH="/opt/softprobe/python${PYTHONPATH:+:${PYTHONPATH}}"
fi

BLACKBOX_JAVA_CAPTURE="${BLACKBOX_JAVA_CAPTURE:-auto}"
export BLACKBOX_OBI_READY="0"

if [[ "${OBI_ENABLED:-1}" != "0" && "${BLACKBOX_JAVA_CAPTURE}" != "none" ]]; then
  can_use_ebpf=0
  if [[ -x /usr/local/bin/obi ]]; then
    mkdir -p /sys/fs/bpf /sys/kernel/tracing /sys/kernel/debug 2>/dev/null || true
    mountpoint -q /sys/fs/bpf 2>/dev/null || mount -t bpf bpf /sys/fs/bpf 2>/dev/null || true
    mountpoint -q /sys/kernel/tracing 2>/dev/null || mount -t tracefs tracefs /sys/kernel/tracing 2>/dev/null || true
    mountpoint -q /sys/kernel/debug 2>/dev/null || mount -t debugfs debugfs /sys/kernel/debug 2>/dev/null || true
    if [[ -d /sys/kernel/tracing/events || -d /sys/kernel/debug/tracing/events ]]; then
      if [[ "${BLACKBOX_JAVA_CAPTURE}" == "obi" || -w /sys/kernel/tracing || -w /sys/kernel/debug/tracing || -w /sys/fs/bpf ]]; then
        can_use_ebpf=1
      fi
    fi
  fi

  if [[ "${BLACKBOX_JAVA_CAPTURE}" == "otel" || ( "${BLACKBOX_JAVA_CAPTURE}" == "auto" && "${can_use_ebpf}" == "0" ) ]]; then
    if [[ -f /opt/softprobe/java/opentelemetry-javaagent.jar ]]; then
      APP_JAVA_OPTS="${APP_JAVA_OPTS:-} -javaagent:/opt/softprobe/java/opentelemetry-javaagent.jar"
      APP_JAVA_OPTS="${APP_JAVA_OPTS} -Dotel.service.name=${JAVA_SERVICE}"
      APP_JAVA_OPTS="${APP_JAVA_OPTS} -Dotel.resource.attributes=deployment.environment.name=${ENVIRONMENT_NAME}"
      APP_JAVA_OPTS="${APP_JAVA_OPTS} -Dotel.exporter.otlp.protocol=http/protobuf"
      APP_JAVA_OPTS="${APP_JAVA_OPTS} -Dotel.exporter.otlp.traces.endpoint=${TRACES_ENDPOINT}"
      APP_JAVA_OPTS="${APP_JAVA_OPTS} -Dotel.exporter.otlp.headers=Authorization=Bearer%20${INGESTION_KEY}"
      APP_JAVA_OPTS="${APP_JAVA_OPTS} -Dotel.metrics.exporter=none -Dotel.logs.exporter=none"
      export APP_JAVA_OPTS
    fi
  elif [[ "${can_use_ebpf}" == "1" ]]; then
    export BLACKBOX_OBI_READY="1"
    export OTEL_RESOURCE_ATTRIBUTES="deployment.environment.name=${ENVIRONMENT_NAME}${OTEL_RESOURCE_ATTRIBUTES:+,${OTEL_RESOURCE_ATTRIBUTES}}"
  fi
fi
