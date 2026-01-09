FROM eclipse-temurin:21-jre-jammy

COPY target/*.jar app.jar

# Download the SoftProbe Java Agent
RUN curl -LO https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/latest/download/opentelemetry-javaagent.jar
RUN mv opentelemetry-javaagent.jar otel.jar

ENV SP_SERVICE_NAME="1ddf2ffa9666a3e6"
ENV SP_STORAGE_SERVICE_HOST="storage-onpremise-gcp.softprobe.ai"

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
