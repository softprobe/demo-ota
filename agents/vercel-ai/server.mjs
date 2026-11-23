import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateText, stepCountIs, tool } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { z } from 'zod';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOST = process.env.AGENT_HOST ?? '127.0.0.1';
const PORT = Number(process.env.AGENT_PORT ?? 4311);
const OTA_BASE_URL = (process.env.TRAVEL_OTA_BASE_URL ?? 'http://127.0.0.1:8081').replace(/\/+$/, '');
const CONTRACTS_DIR = process.env.CONTRACTS_DIR
  ?? (existsSync('/opt/contracts/travel-policies.json') ? '/opt/contracts' : join(HERE, '../../contracts'));

const SYSTEM_PROMPT = readFileSync(join(CONTRACTS_DIR, 'agent-system-prompt.txt'), 'utf8').trim();
const TRAVEL_POLICY = JSON.parse(readFileSync(join(CONTRACTS_DIR, 'travel-policies.json'), 'utf8'));
const TOOL_SCHEMAS = Object.fromEntries(
  JSON.parse(readFileSync(join(CONTRACTS_DIR, 'agent-tools.schema.json'), 'utf8')).tools.map(t => [t.name, t.description]),
);

const PROVIDERS = {
  google: { label: 'Google Gemini', defaultModel: 'gemini-2.5-flash' },
  openai: { label: 'OpenAI', defaultModel: 'gpt-4.1-mini' },
  anthropic: { label: 'Anthropic', defaultModel: 'claude-sonnet-4-5' },
  compatible: { label: 'OpenAI-compatible', defaultModel: 'local-model' },
};
const SECRET_KEYS = [
  'GOOGLE_GENERATIVE_AI_API_KEY', 'GEMINI_API_KEY', 'GEMINI_KEY',
  'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'AI_COMPATIBLE_API_KEY',
];
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAME_REPLY = /^[A-Za-z][A-Za-z' -]{0,9}\s+[A-Za-z][A-Za-z' -]{0,9}$/;
const ALL_TOOLS = ['travel_search', 'travel_prepare', 'travel_book', 'travel_order'];
const INPUT_SCHEMAS = {
  travel_search: ['search', z.object({ origin: z.string().length(3), destination: z.string().length(3), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })],
  travel_prepare: ['prepare', z.object({ offerId: z.string().min(1).max(200), firstName: z.string().min(1).max(10), lastName: z.string().min(1).max(10) })],
  travel_book: ['book', z.object({ requestId: z.string().uuid() })],
  travel_order: ['order', z.object({})],
};

const traceStorage = new AsyncLocalStorage();
const sessions = new Map();
const httpError = (msg, statusCode = 400) => Object.assign(new Error(msg), { statusCode });
const googleKey = () => process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY || process.env.GEMINI_KEY || '';

function cleanError(error) {
  let msg = String(error?.message ?? 'The model request failed.');
  for (const k of SECRET_KEYS) if (process.env[k]) msg = msg.replaceAll(process.env[k], '[redacted]');
  return msg.slice(0, 500);
}

function compatibleUrl() {
  const raw = process.env.AI_COMPATIBLE_BASE_URL;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const u = new URL(raw);
    return (['http:', 'https:'].includes(u.protocol) && !u.username && !u.password && !u.search && !u.hash) ? u.href.replace(/\/+$/, '') : null;
  } catch { return null; }
}

function configuredProviders() {
  const out = [];
  if (googleKey()) out.push({ id: 'google', ...PROVIDERS.google });
  if (process.env.OPENAI_API_KEY) out.push({ id: 'openai', ...PROVIDERS.openai });
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) out.push({ id: 'anthropic', ...PROVIDERS.anthropic });
  if (compatibleUrl()) out.push({ id: 'compatible', ...PROVIDERS.compatible });
  return out;
}

function resolveSelection(reqProvider, reqModel) {
  const available = configuredProviders();
  const defProv = available.find(p => p.id === process.env.TRAVEL_PROVIDER)?.id ?? available[0]?.id ?? null;
  const defModel = defProv ? (process.env.TRAVEL_MODEL || PROVIDERS[defProv].defaultModel) : '';
  const provider = (typeof reqProvider === 'string' && reqProvider.trim()) ? reqProvider.trim() : defProv;
  if (!provider || !PROVIDERS[provider]) throw httpError('Choose a supported model provider.');
  if (!available.some(p => p.id === provider)) throw httpError(`Configure the ${PROVIDERS[provider].label} API key on this server before selecting it.`);
  const model = (typeof reqModel === 'string' && reqModel.trim()) ? reqModel.trim() : (provider === defProv ? defModel : PROVIDERS[provider].defaultModel);
  if (!MODEL_ID.test(model)) throw httpError('Enter a valid model ID.');
  return { provider, model };
}

function buildModel(provider, modelId) {
  if (provider === 'google') return createGoogleGenerativeAI({ apiKey: googleKey() })(modelId);
  if (provider === 'openai') return createOpenAI({ apiKey: process.env.OPENAI_API_KEY })(modelId);
  if (provider === 'anthropic') {
    return createAnthropic(process.env.ANTHROPIC_AUTH_TOKEN ? { authToken: process.env.ANTHROPIC_AUTH_TOKEN } : { apiKey: process.env.ANTHROPIC_API_KEY })(modelId);
  }
  return createOpenAICompatible({ name: 'compatible', baseURL: compatibleUrl(), apiKey: process.env.AI_COMPATIBLE_API_KEY || 'local' }).chatModel(modelId);
}

function systemPromptForToday() {
  const today = new Date().toISOString().slice(0, 10);
  return `${SYSTEM_PROMPT}\nCurrent date (UTC): ${today}. Resolve yearless month/day dates using this date. Search at most once per user travel request; reuse the latest matching search results when the user selects an option or supplies their name. If the app supplies a selected offerId, prepare that exact offer after collecting any missing name; a name reply is never a reason to search again. If no matching search result exists yet, search once when origin, destination, and date are known. After travel_prepare succeeds, stop using tools and say briefly that the review is ready in the trip panel.`;
}

function propagatedHeaders(extra = {}) {
  const inbound = traceStorage.getStore() ?? {};
  const headers = { ...extra };
  // External fetch wrappers skip child-span injection when traceparent is already set on init.headers.
  if (inbound.traceparent && globalThis.fetch.name === 'fetch') headers.traceparent = inbound.traceparent;
  if (inbound.tracestate) headers.tracestate = inbound.tracestate;
  if (inbound.baggage) headers.baggage = inbound.baggage;
  return headers;
}

async function otaRequest(method, path, body, signal) {
  const combined = signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000);
  const headers = propagatedHeaders(body !== undefined ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: 'application/json' });
  const res = await fetch(`${OTA_BASE_URL}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal: combined, redirect: 'error' });
  const text = await res.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { data = { error: text.slice(0, 300) }; } }
  return { ok: res.ok, status: res.status, data };
}

async function checkOtaReady() {
  for (const probe of ['/index.html', '/']) {
    try {
      const res = await fetch(`${OTA_BASE_URL}${probe}`, { headers: propagatedHeaders(), signal: AbortSignal.timeout(2_000), redirect: 'error' });
      if (res.ok) return true;
      if (res.status !== 404) return false;
    } catch { return false; }
  }
  return false;
}

async function readJson(req, allowedKeys) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 16_384) throw httpError('Request body is too large.', 413);
    chunks.push(c);
  }
  if (!size) return {};
  let val;
  try { val = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw httpError('Malformed JSON.'); }
  if (!val || typeof val !== 'object' || Array.isArray(val)) throw httpError('A JSON object is required.');
  if (allowedKeys && Object.keys(val).some(k => !allowedKeys.includes(k))) throw httpError('Unexpected request fields.');
  return val;
}

async function executeTurn(session, promptText, allowedTools) {
  if (session.busy) throw httpError('Wait for the current response or stop it first.', 409);
  const controller = new AbortController();
  const turnTools = [];
  let prepared = false;

  const tools = Object.fromEntries(Object.entries(INPUT_SCHEMAS).map(([name, [suffix, inputSchema]]) => [
    name,
    tool({
      description: TOOL_SCHEMAS[name],
      inputSchema,
      execute: async (args, opts) => {
        const res = await otaRequest('POST', `/api/bookings/sessions/${encodeURIComponent(session.id)}/tools/${suffix}`, args, opts?.abortSignal ?? controller.signal);
        if (!res.ok) {
          turnTools.push({ name, status: 'error' });
          return { error: typeof res.data?.error === 'string' ? res.data.error : `Travel operation failed (HTTP ${res.status}).` };
        }
        turnTools.push({ name, status: 'completed' });
        if (name === 'travel_prepare') prepared = true;
        return res.data ?? {};
      },
    }),
  ]));

  const telemetry = { isEnabled: true, functionId: 'travel-agent-turn', recordInputs: true, recordOutputs: true, metadata: { sessionId: session.id }, includeRuntimeContext: { sessionId: true } };
  Object.assign(session, { busy: true, used: true, lastError: null, controller });
  session.messages.push({ id: randomUUID(), role: 'user', text: promptText, tools: [] });
  const task = generateText({
    model: buildModel(session.provider, session.model),
    system: systemPromptForToday(),
    messages: [...session.history, { role: 'user', content: promptText }],
    tools,
    activeTools: allowedTools,
    stopWhen: [stepCountIs(10), () => prepared],
    maxOutputTokens: 1024,
    abortSignal: controller.signal,
    telemetry,
    experimental_telemetry: telemetry,
    runtimeContext: { sessionId: session.id },
  });
  session.task = task;

  try {
    const result = await task;
    session.history.push({ role: 'user', content: promptText }, ...(result.response?.messages ?? []));
    if (prepared) session.selectedOfferId = null;
    const raw = (result.text ?? '').trim();
    session.messages.push({ id: randomUUID(), role: 'assistant', text: prepared && !raw ? 'The review is ready in the trip panel.' : raw, tools: turnTools });
  } catch (err) {
    session.lastError = cleanError(err);
    throw httpError(session.lastError, 502);
  } finally {
    Object.assign(session, { busy: false, controller: null, task: null });
  }
}

const sendJson = (res, status, data) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(data));
};

const server = createServer((req, res) => {
  const inbound = {
    traceparent: typeof req.headers.traceparent === 'string' ? req.headers.traceparent.trim() : '',
    tracestate: typeof req.headers.tracestate === 'string' ? req.headers.tracestate.trim() : '',
    baggage: typeof req.headers.baggage === 'string' ? req.headers.baggage.trim() : '',
  };
  traceStorage.run(inbound, async () => {
    try {
      const { pathname } = new URL(req.url ?? '/', `http://${req.headers.host || '127.0.0.1'}`);
      const route = pathname.startsWith('/agent/api/') || pathname === '/agent/api' ? pathname.slice('/agent'.length) : pathname;

      if (req.method === 'GET' && route === '/api/status') {
        const providers = configuredProviders();
        const defProv = providers.find(p => p.id === process.env.TRAVEL_PROVIDER)?.id ?? providers[0]?.id ?? null;
        const defModel = defProv ? (process.env.TRAVEL_MODEL || PROVIDERS[defProv].defaultModel) : '';
        const travel = await checkOtaReady();
        return sendJson(res, 200, {
          ready: providers.length > 0 && travel, runtime: true, runtimeFlavor: 'vercel-ai', providers,
          defaultProvider: defProv, defaultModel: defModel, model: defProv ? `${defProv}/${defModel}` : 'No provider configured',
          travel, environment: 'local synthetic demo', defaultDate: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10),
          conversationLimit: null, conversationsUsed: [...sessions.values()].filter(s => s.used).length,
        });
      }

      if (req.method === 'POST' && route === '/api/sessions') {
        const body = await readJson(req, ['provider', 'model']);
        const sel = resolveSelection(body.provider, body.model);
        const id = `ses_${randomUUID()}`;
        const ota = await otaRequest('GET', `/api/bookings/sessions/${encodeURIComponent(id)}`);
        if (!ota.ok) throw httpError(ota.data?.error ?? `Travel service returned HTTP ${ota.status}.`, 502);
        sessions.set(id, { id, ...sel, messages: [], history: [], selectedOfferId: null, busy: false, lastError: null, used: false, controller: null, task: null });
        return sendJson(res, 201, { id, ...sel });
      }

      const match = route.match(/^\/api\/sessions\/(ses_[A-Za-z0-9_-]+)(?:\/(messages|approve|pay|cancel-booking|abort))?$/);
      if (!match) throw httpError('Not found.', 404);
      const session = sessions.get(match[1]);
      if (!session) throw httpError('This travel conversation was not found.', 404);
      const action = match[2];

      if (req.method === 'GET' && !action) {
        const ota = await otaRequest('GET', `/api/bookings/sessions/${encodeURIComponent(session.id)}`);
        if (!ota.ok) throw httpError(ota.data?.error ?? `Travel service returned HTTP ${ota.status}.`, 502);
        return sendJson(res, 200, {
          id: session.id, provider: session.provider, model: session.model, messages: session.messages, busy: session.busy,
          offers: ota.data?.offers ?? [], pending: ota.data?.pending ?? null, booking: ota.data?.booking ?? null,
          travelPolicy: ota.data?.travelPolicy ?? TRAVEL_POLICY, lastError: session.lastError,
        });
      }
      if (req.method !== 'POST') throw httpError('Method not allowed.', 405);

      if (action === 'messages') {
        const { text, offerId } = await readJson(req, ['text', 'offerId']);
        if (typeof text !== 'string' || !text.trim() || text.length > 4000) throw httpError('Enter a message of 1-4000 characters.');
        if (session.busy) throw httpError('Wait for the current response or stop it first.', 409);
        const ota = await otaRequest('GET', `/api/bookings/sessions/${encodeURIComponent(session.id)}`);
        if (!ota.ok) throw httpError(ota.data?.error ?? `Travel service returned HTTP ${ota.status}.`, 502);
        const prompt = text.trim();
        if (offerId !== undefined && offerId !== null) {
          if (typeof offerId !== 'string' || !(ota.data?.offers ?? []).some(o => o.id === offerId)) throw httpError('Choose a flight returned by this conversation.', 404);
          session.selectedOfferId = offerId;
        } else if (session.selectedOfferId && !NAME_REPLY.test(prompt)) {
          session.selectedOfferId = null;
        }
        const restricted = ['completed', 'submitting', 'uncertain'].includes(ota.data?.pending?.status);
        const allowed = restricted ? ['travel_order'] : (session.selectedOfferId ? ALL_TOOLS.filter(t => t !== 'travel_search') : ALL_TOOLS);
        await executeTurn(session, prompt, allowed);
        return sendJson(res, 200, { accepted: true, completed: true });
      }

      if (action === 'approve') {
        const { requestId, injectSilentBug } = await readJson(req, ['requestId', 'injectSilentBug']);
        if (session.busy) throw httpError('Wait for the current response or stop it first.', 409);
        if (typeof requestId !== 'string' || !UUID_RE.test(requestId)) throw httpError('A valid booking requestId is required.');
        if (injectSilentBug !== undefined && typeof injectSilentBug !== 'boolean') throw httpError('injectSilentBug must be a boolean.');
        const resOta = await otaRequest('POST', `/api/bookings/sessions/${encodeURIComponent(session.id)}/approve`, { requestId, injectSilentBug: injectSilentBug === true });
        if (!resOta.ok) throw httpError(resOta.data?.error ?? `Approval failed (HTTP ${resOta.status}).`, resOta.status);
        if (resOta.data?.awaitingManagerApproval === true) return sendJson(res, 200, { accepted: true, awaitingManagerApproval: true });
        const tpl = injectSilentBug === true ? TRAVEL_POLICY.silentBugContinuationTemplate : TRAVEL_POLICY.confirmContinuationTemplate;
        await executeTurn(session, tpl.replaceAll('{{requestId}}', requestId), ['travel_book', 'travel_order']);
        return sendJson(res, 200, { accepted: true, awaitingManagerApproval: false, completed: true });
      }

      if (action === 'pay' || action === 'cancel-booking') {
        const { requestId } = await readJson(req, ['requestId']);
        if (session.busy) throw httpError('Wait for the current agent action to finish.', 409);
        if (typeof requestId !== 'string' || !UUID_RE.test(requestId)) throw httpError('A valid booking requestId is required.');
        const suffix = action === 'pay' ? 'pay' : 'cancel';
        const out = await otaRequest('POST', `/api/bookings/sessions/${encodeURIComponent(session.id)}/${suffix}`, { requestId });
        if (!out.ok) throw httpError(out.data?.error ?? `Operation failed (HTTP ${out.status}).`, out.status);
        return sendJson(res, 200, action === 'pay' ? { paid: true, booking: out.data?.booking ?? null } : { cancelled: true });
      }

      await readJson(req, []);
      if (session.busy) {
        session.controller?.abort(new Error('The user stopped this agent turn.'));
        await session.task?.catch(() => {});
        session.busy = false;
      }
      return sendJson(res, 200, { stopped: true });
    } catch (err) {
      if (!res.headersSent) sendJson(res, err.statusCode ?? 500, { error: cleanError(err) });
      else res.end();
    }
  });
});

server.listen(PORT, HOST, () => console.log(`vercel-ai agent listening on http://${HOST}:${server.address().port}`));
