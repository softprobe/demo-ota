#!/bin/bash
mvn clean install -DskipTests


java -javaagent:/Users/bill/src/arex/backend/sp-agent-java/sp-agent-jar/sp-agent.jar \
    -Dsp.app.id=313ef6b71f66321e \
    -Dsp.storage.service.host=localhost:8090 \
    -Dsp.config.service.host=localhost:8090 \
    -jar target/travel-ota-1.0-SNAPSHOT.jar