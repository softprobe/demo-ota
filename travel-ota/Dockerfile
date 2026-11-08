FROM maven:3.9-eclipse-temurin-21 AS ota-build
WORKDIR /workspace
COPY pom.xml ./pom.xml
COPY travel-ota/pom.xml ./travel-ota/pom.xml
COPY travel-ota/src ./travel-ota/src
RUN mvn -B -DskipTests -pl travel-ota -am package

FROM node:22-bookworm-slim AS node-runtime

FROM node:22-bookworm-slim AS agent-dependencies
WORKDIR /opt/travel-agent-demo
COPY travel-agent-demo/package.json travel-agent-demo/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY travel-agent-demo/src ./src
COPY travel-agent-demo/public ./public
COPY travel-agent-demo/references ./references

FROM docker.m.daocloud.io/library/eclipse-temurin:21-jre-jammy

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=agent-dependencies /opt/travel-agent-demo /opt/travel-agent-demo
COPY --from=ota-build /workspace/travel-ota/target/travel-ota-1.0-SNAPSHOT.jar /app.jar
COPY run-all.sh /run-all.sh

RUN chmod +x /run-all.sh

ENV SPRING_PROFILES_ACTIVE="prod"
ENV SERVER_PORT="8081"
ENV TRAVEL_AGENT_PORT="8080"
ENV TRAVEL_AGENT_HOST="0.0.0.0"
ENV TRAVEL_OTA_BASE_URL="http://127.0.0.1:8081"
ENV AIRLINE_NDC_BASE_URL="https://spair.softprobe.ai/ndc/v21.3"
EXPOSE 8080
ENTRYPOINT ["/run-all.sh"]
