import { initVercelAiTelemetry } from "@softprobe/vercel-ai-sdk";

initVercelAiTelemetry({
  serviceName: process.env.SOFTPROBE_AI_SERVICE_NAME || "travel-agent",
});
