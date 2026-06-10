# travel-ota 生产镜像 —— 随应用挂 Softprobe agent(流量录制/回放探针)。
FROM eclipse-temurin:21-jre-jammy

WORKDIR /app

# 应用 fat jar
COPY target/*.jar /app/app.jar

# SP agent(build 期从租户后端拉取,内含上报地址)
ADD https://demo.softprobe.ai/api/agent/sp-agent.jar /opt/sp-agent.jar

# SP 后台创建的应用 ID
ENV SP_APP_ID=7524a86498e08a75
ENV SP_API_URL=https://demo.softprobe.ai

# 是否禁止 agent 录制。回放靶实例只接回放流量、自身不录 —— 否则回放打进来的
# 流量会被当成新录制回灌。默认空(照常录);回放靶部署时设 true。
ENV SP_DISABLE_RECORD=""

# 环境标:随录制数据落库,平台侧可按标筛选流量来源(prod / canary)。
ENV SP_ENV_TAG=prod

# 内嵌 redis-server 从 embedded-redis 释放到 /tmp,某些 base image /tmp 是 tmpfs
# 无 exec 权限,提前保障 exec 位。
RUN mkdir -p /tmp && chmod 1777 /tmp

ENTRYPOINT ["sh", "-c", "exec java ${JAVA_OPTS:--Xms384m -Xmx768m} \
  -javaagent:/opt/sp-agent.jar \
  -Dsp.app.id=${SP_APP_ID} \
  -Dsp.api.url=${SP_API_URL} \
  -Dsp.tags.env=${SP_ENV_TAG} \
  ${SP_DISABLE_RECORD:+-Dsp.disable.record=$SP_DISABLE_RECORD} \
  -jar /app/app.jar"]
