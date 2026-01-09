FROM docker.m.daocloud.io/library/eclipse-temurin:21-jre-jammy

COPY target/*.jar app.jar

# Download the SoftProbe Java Agent
RUN curl -LO https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/latest/download/opentelemetry-javaagent.jar
RUN mv opentelemetry-javaagent.jar otel.jar

ENV SPRING_PROFILES_ACTIVE="prod"
ENV SP_SERVICE_NAME="fbd4ef5d331bf64e"
ENV SP_API_KEY="qCjaffz86DzHp6jGIH0Ks50EP0bOLCg-Iuju3HLSP4I"
ENV SP_STORAGE_SERVICE_HOST="storage-onpremise-gcp.softprobe.ai"
# Add this before ENV VERSION
ARG VERSION=dev-1.0.0
ENV VERSION=${VERSION}

# Start the application
ENTRYPOINT ["sh", "-c", \
 "java ${JAVA_OPTS} \
    -javaagent:otel.jar \
    -Dotel.traces.exporter=none \
    -Dotel.metrics.exporter=none \
    -Dotel.logs.exporter=none \
    -Dotel.resource.attributes=service.name=sp-storage \
    -Dotel.instrumentation.http.server.capture-request-headers=tracestate \
    -Dotel.instrumentation.http.server.capture-response-headers=tracestate \
    -jar /app.jar"]
