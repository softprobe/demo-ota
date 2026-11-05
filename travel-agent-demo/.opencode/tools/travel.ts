import { tool, type ToolContext } from '@opencode-ai/plugin/tool';
import { toolHeaders } from '../../src/trace-bridge.mjs';

async function invoke(operation: string, args: unknown, context: ToolContext) {
  // OpenCode v1.18.30 spreads internal toolCtx into pluginCtx (registry.ts).
  // callID is present at runtime although the public ToolContext omits it.
  // Fail closed if a future runtime changes that contract.
  const callID = (context as ToolContext & { callID?: string }).callID;
  if (!callID) throw new Error('This OpenCode runtime did not supply tool-call correlation. No travel request sent.');
  const headers = toolHeaders(context.sessionID, callID);
  if (!process.env.TRAVEL_INTERNAL_TOKEN || !process.env.TRAVEL_GATEWAY_URL?.startsWith('http://127.0.0.1:')) throw new Error('Local travel gateway is not configured.');
  const response = await fetch(`${process.env.TRAVEL_GATEWAY_URL}/internal/travel/${operation}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.TRAVEL_INTERNAL_TOKEN}`, ...headers },
    body: JSON.stringify({ sessionId: context.sessionID, args }),
    signal: AbortSignal.any([context.abort, AbortSignal.timeout(60_000)]),
    redirect: 'error',
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? `Travel operation failed (HTTP ${response.status}).`);
  return JSON.stringify(data);
}

export const search = tool({
  description: 'Find real mock flight options for a one-way economy trip, one adult. Returns up to six cheapest flights with exact offerId values. Does not reserve.',
  args: { origin: tool.schema.string().length(3).describe('Supported origin airport code, e.g. LHR'), destination: tool.schema.string().length(3).describe('Supported destination airport code, e.g. CDG'), date: tool.schema.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Exact future date YYYY-MM-DD') },
  execute: (args, context) => invoke('search', args, context),
});
export const prepare = tool({
  description: 'Prepare a review from a returned offerId and a SYNTHETIC traveler name. This does not book. The traveler must click Confirm demo booking in the browser; that is not manager approval. Flights above $600 USD require separate manager approval and normally remain pending. Returns the policy and explicit approval state. Dummy document/contact details are generated for the mock.',
  args: { offerId: tool.schema.string().min(1).max(200), firstName: tool.schema.string().min(1).max(10), lastName: tool.schema.string().min(1).max(10) },
  execute: (args, context) => invoke('prepare', args, context),
});
export const book = tool({
  description: 'Submit exactly one prepared booking AFTER browser confirmation of its exact requestId. The gateway also enforces manager approval above $600 USD, except for an explicitly enabled request-local controlled demo fault. Returns verified=true only after independent order query, with approval evidence for the injected scenario. Payment remains PENDING; no ticket is issued. Never retry an uncertain result.',
  args: { requestId: tool.schema.string().min(1).max(100) },
  execute: (args, context) => invoke('book', args, context),
});
export const order = tool({
  description: 'Read back this conversation’s existing known reservation. No new booking and no payment. If no confirmation is known, do not retry booking.',
  args: {},
  execute: (args, context) => invoke('order', args, context),
});
