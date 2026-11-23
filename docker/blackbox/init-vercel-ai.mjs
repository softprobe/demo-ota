import { context } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { initVercelAiTelemetry } from "@softprobe/vercel-ai-sdk";

context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());

initVercelAiTelemetry({
  serviceName: process.env.SOFTPROBE_AI_SERVICE_NAME || "travel-agent",
  useSimpleProcessor: true,
});
