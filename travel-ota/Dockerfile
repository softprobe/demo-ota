# travel-ota (demo 主入口) — 挂 SP agent 上报到 tenant-98 (demo 租户)。
#
# agent jar 在 build 时从 demo 租户后端 curl 下来 —— 后端启动时 bake-agent.sh 把
# tenant-98 的上报地址 https://demo.softprobe.ai 内嵌进 jar 的
# META-INF/sp/sp.agent.conf,agent 自动读取(见 packages/opencode/src/server/
# shared/sp-agent-download.ts 的双轨设计)。改成官方 eclipse-temurin(daocloud 被
# 甲方现场网络封,build 会 EOF)。
FROM eclipse-temurin:21-jre-jammy

WORKDIR /app

# 应用 fat jar
COPY target/*.jar /app/app.jar

# SP agent(build 期间从 demo 租户下,含预烤 backend host)
ADD https://demo.softprobe.ai/api/agent/sp-agent.jar /opt/sp-agent.jar

# appId:在 demo 租户后台已通过 /api/applications/create 创建
ENV SP_APP_ID=7524a86498e08a75

# sp-agent v4.3.14 (commit e9c21ab2) 起配置统一到 sp.api.url,老键
# (sp.storage.service.host 等)不再被 agent 读。allinone 的 bake-agent.sh 还在写
# 老键 —— 见 sp-allinone META-INF/sp/sp.agent.conf 内嵌值只有 service.host 三键。
# 显式补一手,不改动 SP 主镜像。
ENV SP_API_URL=https://demo.softprobe.ai

# 退票手续费回归开关(见 FlightService#calculateCancellationFee):
# demo 部两套 travel-ota —— 录制版留空(正确算法),canary 回放版设 true(24→48h)。
ENV SP_DEMO_REFUND_REGRESSION=""

# 是否禁止 agent 录制。canary 只当回放靶,自己不录 —— 否则回放打进来的流量会被当成新
# 录制回灌,越滚越脏。默认空(照常录);canary 部署时在 k8s env 里设 true。
# 键名是 sp.disable.record(ConfigConstants.DISABLE_RECORD),注意是「禁用」语义。
#
# 顺带记一笔:回放靶不靠 agent 打 env tag 定位 —— schedule 的
# DefaultDeploymentEnvironmentProviderImpl.parse() 直接把 createPlan 传的 targetEnv
# 当 URI 解析出 host,所以 targetEnv 填的就是靶机地址本身
# (如 http://travel-ota-canary.demo-air.svc.cluster.local:8080)。
ENV SP_DISABLE_RECORD=""

# 环境标。agent 的标签机制是 -Dsp.tags.<key>=<value>(ConfigService.TAGS_PREFIX),
# 标会随录制数据一起落库,前端可据此区分/筛选这条流量来自哪套部署。
# 录制版 prod、回放靶 canary。
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
