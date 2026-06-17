#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
AGENT_JAR="${AGENT_JAR:-$ROOT/sp-agent-java/sp-agent-jar/sp-agent.jar}"
SP_BACKEND_PORT="${SP_BACKEND_PORT:-18090}"

mvn clean install -DskipTests

java -javaagent:"$AGENT_JAR" \
    -Dsp.app.id=travel-ota \
    -Dsp.storage.service.host="127.0.0.1:${SP_BACKEND_PORT}" \
    -Dsp.config.service.host="127.0.0.1:${SP_BACKEND_PORT}" \
    -Dsp.record.save.url="http://127.0.0.1:${SP_BACKEND_PORT}/v1/traces" \
    -jar target/travel-ota-1.0-SNAPSHOT.jar
