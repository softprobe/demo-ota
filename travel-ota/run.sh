#!/bin/bash
mvn clean install -DskipTests


java -javaagent:/Users/bill/src/sp-agent-java/sp-agent-jar/sp-agent.jar \
    -Dsp.app.id=504c5a6db168cdc4 \
    -Dsp.storage.service.host=storage-onpremise-gcp.softprobe.ai \
    -jar target/travel-ota-1.0-SNAPSHOT.jar