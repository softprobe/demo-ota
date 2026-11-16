#!/usr/bin/env bash
set -euo pipefail

: "${INGESTION_KEY:?Set INGESTION_KEY}"
TRACES_ENDPOINT="${OTEL_EXPORTER_OTLP_TRACES_ENDPOINT:-https://explorer.softprobe.ai/api/thelake/v1/traces}"
ENVIRONMENT_NAME="${SOFTPROBE_ENVIRONMENT:-demo}"

node - <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";

const endpoint = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || "https://explorer.softprobe.ai/api/thelake/v1/traces";
const origin = new URL(endpoint).origin;
const options = {
  ingestionKey: process.env.INGESTION_KEY,
  serviceName: "travel-web",
  otlp: {
    tracesEndpoint: endpoint,
    protocol: "http/protobuf",
  },
  resourceAttributes: {
    "deployment.environment.name": process.env.SOFTPROBE_ENVIRONMENT || "demo",
  },
  httpBodyCapture: {
    routes: [
      { method: "POST", path: "/agent/api/sessions" },
      { method: "POST", path: "/agent/api/sessions/*/messages" },
      { method: "POST", path: "/agent/api/sessions/*/approve" },
      { method: "POST", path: "/agent/api/sessions/*/pay" },
      { method: "POST", path: "/agent/api/sessions/*/cancel-booking" },
      { method: "POST", path: "/agent/api/sessions/*/abort" },
    ],
  },
};

const htmlPath = "/opt/travel-agent-demo/public/index.html";
let html = readFileSync(htmlPath, "utf8");
if (!html.includes("/agent/web-record.js")) {
  const escaped = JSON.stringify(options).replace(/'/g, "&#39;");
  const tag = `  <script src="/agent/web-record.js" data-softprobe-options='${escaped}' defer></script>\n`;
  html = html.replace("</head>", `${tag}</head>`);
  writeFileSync(htmlPath, html);
}

const serverPath = "/opt/travel-agent-demo/src/server.mjs";
let server = readFileSync(serverPath, "utf8");
if (!server.includes("'/web-record.js'")) {
  server = server.replace(
    "'/styles.css': ['styles.css', 'text/css; charset=utf-8']",
    "'/styles.css': ['styles.css', 'text/css; charset=utf-8'], '/web-record.js': ['web-record.js', 'text/javascript; charset=utf-8']",
  );
  server = server.replace("connect-src 'self'", `connect-src 'self' ${origin}`);
  writeFileSync(serverPath, server);
}
NODE

export OTEL_EXPORTER_OTLP_TRACES_HEADERS="Authorization=Bearer ${INGESTION_KEY}"
export OTEL_EXPORTER_OTLP_TRACES_PROTOCOL="http/protobuf"
export OTEL_SERVICE_NAME="travel-ota"
export SOFTPROBE_AI_SERVICE_NAME="travel-agent"
export NODE_OPTIONS="${NODE_OPTIONS:-} --import /opt/blackbox/init-vercel-ai.mjs"

exec /run-all.sh
