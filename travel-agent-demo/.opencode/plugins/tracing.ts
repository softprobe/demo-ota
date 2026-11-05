import { SoftprobeSessionTracer, createHooksFromTracer } from '@softprobe/opencode-plugin';
import { BridgedSoftprobeClient, releaseTool, releaseSession } from '../../src/trace-bridge.mjs';
import { ModelBudget } from '../../src/model-budget.mjs';
import { FetchSpanExporter } from '../../src/fetch-span-exporter.mjs';

export default {
  id: 'softprobe-travel-demo',
  server: async () => {
    if (process.env.SOFTPROBE_BASE_URL !== 'https://explorer-staging.softprobe.ai/api/thelake' || process.env.SOFTPROBE_ENVIRONMENT !== 'staging') throw new Error('Travel demo requires the staging workspace gateway.');
    const client = new BridgedSoftprobeClient({
      publicKey: process.env.SOFTPROBE_PUBLIC_KEY,
      baseUrl: process.env.SOFTPROBE_BASE_URL,
      otlpEndpoint: 'http://127.0.0.1:4319/v1/traces',
      spanExporter: new FetchSpanExporter({
        onAcknowledged: count => console.info(`[travel-trace] ingest acknowledged ${count} spans`),
      }),
      retryExport: false,
      environment: 'staging',
      serviceName: 'opencode-travel-demo',
      registerProvider: false,
      disableGlobalTracerOnShutdown: false,
      useSimpleProcessor: false,
      timeoutMs: 30_000,
      headers: { 'User-Agent': 'SoftprobeOpenCodePlugin/0.1 TravelDemo' },
    });
    const hooks = createHooksFromTracer(new SoftprobeSessionTracer(client));
    const budget = new ModelBudget({ maxCalls: 35 });
    return {
      ...hooks,
      'chat.params': async (input, output) => {
        await hooks['chat.params']?.(input, output);
        budget.beforeCall(input, output);
      },
      'tool.execute.after': async (input, output) => {
        try { await hooks['tool.execute.after']?.(input, output); }
        finally { releaseTool(input.sessionID, input.callID); }
      },
      event: async (input) => {
        try { await hooks.event?.(input); }
        finally {
          const event = input.event;
          if (event?.type === 'session.idle' || event?.type === 'session.error' || (event?.type === 'session.status' && event.properties?.status?.type === 'idle')) {
            if (event.properties?.sessionID) releaseSession(event.properties.sessionID);
          }
        }
      },
    };
  },
};
