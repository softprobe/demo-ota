#!/bin/bash
# 本地起跑(挂 SP agent 录制;agent jar 路径按本机实际调整)
mvn clean install -DskipTests

java -javaagent:${SP_AGENT_JAR:-/opt/sp-agent.jar} \
    -Dsp.app.id=7524a86498e08a75 \
    -Dsp.api.url=https://demo.softprobe.ai \
    -jar target/travel-ota-1.0-SNAPSHOT.jar
