import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../..');
const CONTRACTS_DIR = join(ROOT, 'contracts');
const TRAVEL_POLICY = JSON.parse(readFileSync(join(CONTRACTS_DIR, 'travel-policies.json'), 'utf8'));

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function allocatePort() {
  return new Promise((resolve, reject) => {
    const srv = createNetServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(err => (err ? reject(err) : resolve(port)));
    });
  });
}

async function startMockOtaServer() {
  const sessions = new Map();
  const requests = [];

  function ensureSession(sessionId) {
    if (!sessions.has(sessionId)) {
      sessions.set(sessionId, {
        sessionId,
        offers: [],
        pending: null,
        booking: null,
        travelPolicy: TRAVEL_POLICY,
      });
    }
    return sessions.get(sessionId);
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const body = req.method === 'POST' ? await readBody(req) : null;
    requests.push({
      method: req.method,
      path: url.pathname,
      headers: {
        traceparent: req.headers.traceparent ?? null,
        tracestate: req.headers.tracestate ?? null,
        baggage: req.headers.baggage ?? null,
      },
      body,
    });

    if (req.method === 'GET' && (url.pathname === '/index.html' || url.pathname === '/')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><title>Mock Travel OTA</title>');
      return;
    }

    const match = url.pathname.match(
      /^\/api\/bookings\/sessions\/(ses_[A-Za-z0-9_-]+)(?:\/(approve|pay|cancel|tools\/(?:search|prepare|book|order)))?$/,
    );
    if (!match) {
      sendJson(res, 404, { error: 'Unknown OTA route.' });
      return;
    }

    const session = ensureSession(match[1]);
    const subroute = match[2] ?? '';

    if (req.method === 'GET' && !subroute) {
      sendJson(res, 200, session);
      return;
    }

    if (req.method === 'POST' && subroute === 'tools/search') {
      const { origin, destination, date } = body;
      if (!TRAVEL_POLICY.supportedAirports.includes(origin)) {
        sendJson(res, 400, { error: `Unsupported airport code: ${origin}` });
        return;
      }
      if (!TRAVEL_POLICY.supportedAirports.includes(destination) || origin === destination) {
        sendJson(res, 400, { error: `Invalid destination airport: ${destination}` });
        return;
      }
      if (session.pending && ['awaiting_approval', 'approved'].includes(session.pending.status)) {
        session.pending.status = 'cancelled';
      }
      session.offers = [
        {
          id: 'FL-240:ECO-FLEX',
          offerId: 'FL-240:ECO-FLEX',
          flightId: 'FL-240',
          fareId: 'ECO-FLEX',
          airlineName: 'Air Demo',
          flightNumber: 'AD240',
          origin,
          destination,
          date,
          departureTime: `${date}T09:00:00Z`,
          arrivalTime: `${date}T11:15:00Z`,
          total: 240,
          currency: 'USD',
          cabinClass: 'ECONOMY',
        },
        {
          id: 'FL-1450:ECO-FULL',
          offerId: 'FL-1450:ECO-FULL',
          flightId: 'FL-1450',
          fareId: 'ECO-FULL',
          airlineName: 'Air Demo',
          flightNumber: 'AD900',
          origin,
          destination,
          date,
          departureTime: `${date}T14:00:00Z`,
          arrivalTime: `${date}T16:15:00Z`,
          total: 1450,
          currency: 'USD',
          cabinClass: 'ECONOMY',
        },
      ];
      sendJson(res, 200, {
        offers: session.offers,
        constraints: 'One-way economy, one adult. Synthetic inventory; no payment.',
      });
      return;
    }

    if (req.method === 'POST' && subroute === 'tools/prepare') {
      const offer = session.offers.find(item => item.id === body.offerId);
      if (!offer) {
        sendJson(res, 404, { error: 'Selected offer not found in session.' });
        return;
      }
      session.pending = {
        id: randomUUID(),
        status: 'awaiting_approval',
        offer,
        passenger: { firstName: body.firstName, lastName: body.lastName },
        managerApproval: {
          ruleId: TRAVEL_POLICY.ruleId,
          threshold: TRAVEL_POLICY.threshold,
          currency: 'USD',
          status: offer.total > TRAVEL_POLICY.threshold ? 'not_requested' : 'not_required',
        },
        expiresAt: new Date(Date.now() + 900_000).toISOString(),
      };
      sendJson(res, 200, session.pending);
      return;
    }

    if (req.method === 'POST' && subroute === 'approve') {
      if (!session.pending || session.pending.id !== body.requestId) {
        sendJson(res, 404, { error: 'Booking request not found in this session.' });
        return;
      }
      session.pending.status = 'approved';
      const overThreshold = session.pending.offer.total > TRAVEL_POLICY.threshold;
      if (overThreshold && body.injectSilentBug !== true) {
        session.pending.managerApproval.status = 'pending';
        sendJson(res, 200, { accepted: true, awaitingManagerApproval: true, pending: session.pending });
        return;
      }
      if (overThreshold && body.injectSilentBug === true) {
        session.pending.demoFault = { kind: 'skip_manager_approval', enabledAt: new Date().toISOString() };
      }
      sendJson(res, 200, { accepted: true, awaitingManagerApproval: false, pending: session.pending });
      return;
    }

    if (req.method === 'POST' && subroute === 'tools/book') {
      if (!session.pending || session.pending.id !== body.requestId || session.pending.status !== 'approved') {
        sendJson(res, 409, { error: 'Booking request is not approved.' });
        return;
      }
      const allowed = session.pending.managerApproval.status === 'not_required'
        || session.pending.demoFault?.kind === 'skip_manager_approval';
      if (!allowed) {
        sendJson(res, 409, { error: 'Manager approval is required before booking.' });
        return;
      }
      const booking = {
        bookingId: `BK-${body.requestId.slice(0, 8)}`,
        confirmationNumber: `CNF${body.requestId.slice(0, 6).toUpperCase()}`,
        status: 'CONFIRMED',
        paymentStatus: 'PENDING',
        verified: true,
        amount: session.pending.offer.total,
        currency: session.pending.offer.currency,
        passenger: session.pending.passenger,
        flightInfo: {
          flightNumber: session.pending.offer.flightNumber,
          departureAirport: session.pending.offer.origin,
          arrivalAirport: session.pending.offer.destination,
          departureTime: session.pending.offer.departureTime,
          arrivalTime: session.pending.offer.arrivalTime,
        },
        ...(session.pending.demoFault ? { demoFault: session.pending.demoFault } : {}),
      };
      session.pending.status = 'completed';
      session.booking = booking;
      sendJson(res, 200, booking);
      return;
    }

    if (req.method === 'POST' && subroute === 'tools/order') {
      if (!session.booking) {
        sendJson(res, 404, { error: 'No known reservation reference exists.' });
        return;
      }
      session.booking.verified = true;
      sendJson(res, 200, session.booking);
      return;
    }

    if (req.method === 'POST' && subroute === 'pay') {
      if (!session.pending || session.pending.id !== body.requestId || !session.booking) {
        sendJson(res, 404, { error: 'Verified reservation not found for payment.' });
        return;
      }
      session.booking.paymentStatus = 'PAID';
      session.booking.status = 'TICKETED';
      session.booking.payment = {
        paymentId: `PAY-${body.requestId.slice(0, 8)}`,
        transactionId: `TXN-${body.requestId.slice(0, 8)}`,
        apiStatus: 'SUCCESS',
        apiMessage: 'Ticket issued',
      };
      sendJson(res, 200, { paid: true, booking: session.booking });
      return;
    }

    if (req.method === 'POST' && subroute === 'cancel') {
      if (!session.pending || session.pending.id !== body.requestId) {
        sendJson(res, 404, { error: 'Pending review not found.' });
        return;
      }
      session.pending.status = 'cancelled';
      sendJson(res, 200, { cancelled: true, pending: session.pending });
      return;
    }

    sendJson(res, 405, { error: 'Method not allowed.' });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return { server, port: server.address().port, requests };
}

function messageText(msg) {
  if (!msg) return '';
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content.map(part => (typeof part === 'string' ? part : part?.text ?? '')).join('\n');
  }
  return '';
}

function parseJsonSafe(raw) {
  if (typeof raw !== 'string') return raw ?? {};
  try { return JSON.parse(raw); } catch { return { raw }; }
}

async function startMockLlmServer() {
  const calls = [];

  function decideReply(body) {
    const messages = body.messages ?? [];
    const offeredTools = (body.tools ?? []).map(item => item.function?.name ?? item.name).filter(Boolean);
    const last = messages.at(-1);

    if (last?.role === 'tool') {
      const toolPayload = parseJsonSafe(messageText(last));
      let toolName = last.name ?? '';
      if (!toolName && last.tool_call_id) {
        for (let i = messages.length - 2; i >= 0; i -= 1) {
          const tc = (messages[i]?.tool_calls ?? []).find(item => item.id === last.tool_call_id);
          if (tc?.function?.name) {
            toolName = tc.function.name;
            break;
          }
        }
      }
      if (toolPayload && typeof toolPayload.error === 'string') {
        return { text: `Tool error: ${toolPayload.error}` };
      }
      if (toolName === 'travel_search') {
        const count = Array.isArray(toolPayload?.offers) ? toolPayload.offers.length : 0;
        return { text: `Found ${count} economy options. Select an offer and provide traveler name.` };
      }
      if (toolName === 'travel_prepare') {
        return { text: 'The review is ready in the trip panel.' };
      }
      if (toolName === 'travel_book' && offeredTools.includes('travel_order')) {
        return { toolCall: { name: 'travel_order', args: {} } };
      }
      if (toolName === 'travel_order') {
        return {
          text: `Verified reservation ${toolPayload?.confirmationNumber ?? 'UNKNOWN'}. Payment status: ${toolPayload?.paymentStatus ?? 'PENDING'}.`,
        };
      }
      return { text: 'Completed requested travel tool step.' };
    }

    const prompt = messageText(last);
    if (/XXX/i.test(prompt) && offeredTools.includes('travel_search')) {
      return { toolCall: { name: 'travel_search', args: { origin: 'XXX', destination: 'CDG', date: '2026-12-01' } } };
    }
    if (/LHR\s+to\s+CDG/i.test(prompt) && offeredTools.includes('travel_search')) {
      return { toolCall: { name: 'travel_search', args: { origin: 'LHR', destination: 'CDG', date: '2026-12-01' } } };
    }
    const prepMatch = prompt.match(/Prepare offer\s+(\S+)\s+for\s+([A-Za-z]+)\s+([A-Za-z]+)/i);
    if (prepMatch && offeredTools.includes('travel_prepare')) {
      return {
        toolCall: {
          name: 'travel_prepare',
          args: { offerId: prepMatch[1], firstName: prepMatch[2], lastName: prepMatch[3] },
        },
      };
    }
    const bookMatch = prompt.match(/requestId\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    if (bookMatch && offeredTools.includes('travel_book')) {
      return { toolCall: { name: 'travel_book', args: { requestId: bookMatch[1] } } };
    }
    if (/check.*reservation/i.test(prompt) && offeredTools.includes('travel_order')) {
      return { toolCall: { name: 'travel_order', args: {} } };
    }
    return { text: 'Ready to help with your flight.' };
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (req.method !== 'POST' || !url.pathname.endsWith('/chat/completions')) {
      sendJson(res, 404, { error: 'Unknown LLM route.' });
      return;
    }
    const body = await readBody(req);
    const offeredTools = (body.tools ?? []).map(item => item.function?.name ?? item.name).filter(Boolean);
    calls.push({ model: body.model, offeredTools, messageCount: (body.messages ?? []).length });
    const decision = decideReply(body);
    const completionId = `chatcmpl_${randomUUID().replaceAll('-', '')}`;
    const created = Math.floor(Date.now() / 1000);

    if (body.stream === true) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' });
      if (decision.toolCall) {
        const callId = `call_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
        const chunk = {
          id: completionId,
          object: 'chat.completion.chunk',
          created,
          model: body.model ?? 'local-model',
          choices: [{
            index: 0,
            delta: {
              role: 'assistant',
              tool_calls: [{
                index: 0,
                id: callId,
                type: 'function',
                function: { name: decision.toolCall.name, arguments: JSON.stringify(decision.toolCall.args) },
              }],
            },
            finish_reason: 'tool_calls',
          }],
        };
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      } else {
        const chunk = {
          id: completionId,
          object: 'chat.completion.chunk',
          created,
          model: body.model ?? 'local-model',
          choices: [{ index: 0, delta: { role: 'assistant', content: decision.text }, finish_reason: 'stop' }],
        };
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    const message = decision.toolCall
      ? {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: `call_${randomUUID().replaceAll('-', '').slice(0, 16)}`,
          type: 'function',
          function: { name: decision.toolCall.name, arguments: JSON.stringify(decision.toolCall.args) },
        }],
      }
      : { role: 'assistant', content: decision.text };

    sendJson(res, 200, {
      id: completionId,
      object: 'chat.completion',
      created,
      model: body.model ?? 'local-model',
      choices: [{ index: 0, message, finish_reason: decision.toolCall ? 'tool_calls' : 'stop' }],
      usage: { prompt_tokens: 30, completion_tokens: 15, total_tokens: 45 },
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return { server, port: server.address().port, calls };
}

async function waitForReady(baseUrl, child, logs) {
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Agent process exited prematurely (${child.exitCode}):\n${logs.join('')}`);
    }
    try {
      const res = await fetch(`${baseUrl}/agent/api/status`, { signal: AbortSignal.timeout(1_500) });
      if (res.ok) {
        const json = await res.json();
        if (json.ready === true) return json;
      }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for ${baseUrl}/agent/api/status:\n${logs.join('')}`);
}

async function apiJson(baseUrl, method, path, body, extraHeaders = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...extraHeaders,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const data = await res.json();
  return { status: res.status, data };
}

function makeTraceHeaders(sessionId, tagHex) {
  const traceId = `${tagHex.padEnd(32, 'a').slice(0, 32)}`;
  const spanId = `${tagHex.padEnd(16, 'b').slice(0, 16)}`;
  return {
    traceparent: `00-${traceId}-${spanId}-01`,
    tracestate: `conformance=${tagHex}`,
    baggage: `sp.session.id=${sessionId}`,
  };
}

async function verifyRuntime(spec, ota, llm) {
  const port = await allocatePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const logs = [];
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR ?? '/tmp',
    UV_CACHE_DIR: process.env.UV_CACHE_DIR ?? join(process.env.HOME ?? '/tmp', '.cache/uv'),
    AGENT_HOST: '127.0.0.1',
    AGENT_PORT: String(port),
    CONTRACTS_DIR,
    TRAVEL_OTA_BASE_URL: `http://127.0.0.1:${ota.port}`,
    AI_COMPATIBLE_BASE_URL: `http://127.0.0.1:${llm.port}/v1`,
    AI_COMPATIBLE_API_KEY: 'conformance-secret-token',
  };

  const child = spawn(spec.cmd, spec.args, { cwd: spec.cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', chunk => logs.push(chunk.toString('utf8')));
  child.stderr.on('data', chunk => logs.push(chunk.toString('utf8')));

  try {
    const status = await waitForReady(baseUrl, child, logs);
    assert.equal(status.ready, true, `${spec.flavor}: status.ready`);
    assert.equal(status.runtime, true, `${spec.flavor}: status.runtime`);
    assert.equal(status.runtimeFlavor, spec.flavor, `${spec.flavor}: status.runtimeFlavor`);
    assert.equal(status.travel, true, `${spec.flavor}: status.travel`);
    assert.equal(status.defaultProvider, 'compatible', `${spec.flavor}: defaultProvider`);
    assert.equal(status.defaultModel, 'local-model', `${spec.flavor}: defaultModel`);
    assert.equal(status.conversationLimit, null, `${spec.flavor}: conversationLimit`);

    const directStatus = await apiJson(baseUrl, 'GET', '/api/status');
    assert.equal(directStatus.status, 200, `${spec.flavor}: /api/status dual mount`);
    assert.equal(directStatus.data.runtimeFlavor, spec.flavor, `${spec.flavor}: /api/status runtimeFlavor`);

    const created = await apiJson(baseUrl, 'POST', '/agent/api/sessions', {});
    assert.equal(created.status, 201, `${spec.flavor}: create session returns 201`);
    assert.match(created.data.id, /^ses_[0-9a-f-]{36}$/i, `${spec.flavor}: session id format`);
    const sid = created.data.id;

    const searchTrace = makeTraceHeaders(sid, '1111');
    const searchRes = await apiJson(
      baseUrl,
      'POST',
      `/agent/api/sessions/${sid}/messages`,
      { text: 'Find flights from LHR to CDG on 2026-12-01' },
      searchTrace,
    );
    assert.equal(searchRes.status, 200, `${spec.flavor}: search turn status`);
    assert.deepEqual(searchRes.data, { accepted: true, completed: true }, `${spec.flavor}: search turn body`);

    const searchOtaCall = ota.requests.findLast(r => r.path === `/api/bookings/sessions/${sid}/tools/search`);
    assert.ok(searchOtaCall, `${spec.flavor}: OTA /tools/search called`);
    assert.equal(searchOtaCall.headers.traceparent, searchTrace.traceparent, `${spec.flavor}: search traceparent propagated`);
    assert.equal(searchOtaCall.headers.tracestate, searchTrace.tracestate, `${spec.flavor}: search tracestate propagated`);
    assert.equal(searchOtaCall.headers.baggage, searchTrace.baggage, `${spec.flavor}: search baggage propagated`);

    let state = (await apiJson(baseUrl, 'GET', `/agent/api/sessions/${sid}`)).data;
    assert.equal(state.offers.length, 2, `${spec.flavor}: 2 offers persisted`);
    assert.equal(state.messages.length, 2, `${spec.flavor}: user + assistant messages recorded`);
    assert.deepEqual(state.messages[1].tools, [{ name: 'travel_search', status: 'completed' }], `${spec.flavor}: search tool status`);

    const errTrace = makeTraceHeaders(sid, '2222');
    const badSearch = await apiJson(
      baseUrl,
      'POST',
      `/agent/api/sessions/${sid}/messages`,
      { text: 'Search flights from XXX to CDG on 2026-12-01' },
      errTrace,
    );
    assert.equal(badSearch.status, 200, `${spec.flavor}: 400 tool error handled without crashing`);
    state = (await apiJson(baseUrl, 'GET', `/agent/api/sessions/${sid}`)).data;
    assert.match(state.messages.at(-1).text, /Unsupported airport code: XXX/, `${spec.flavor}: assistant reports 400 tool error`);
    assert.deepEqual(state.messages.at(-1).tools, [{ name: 'travel_search', status: 'error' }], `${spec.flavor}: 400 tool marked error`);

    const llmBeforePrepare = llm.calls.length;
    const prepTrace = makeTraceHeaders(sid, '3333');
    const prepRes = await apiJson(
      baseUrl,
      'POST',
      `/agent/api/sessions/${sid}/messages`,
      { text: 'Prepare offer FL-240:ECO-FLEX for Alex Demo', offerId: 'FL-240:ECO-FLEX' },
      prepTrace,
    );
    assert.equal(prepRes.status, 200, `${spec.flavor}: prepare turn status`);
    assert.equal(llm.calls.length - llmBeforePrepare, 1, `${spec.flavor}: stops immediately after travel_prepare succeeds`);

    state = (await apiJson(baseUrl, 'GET', `/agent/api/sessions/${sid}`)).data;
    assert.equal(state.pending?.status, 'awaiting_approval', `${spec.flavor}: pending awaiting_approval`);
    assert.equal(state.pending?.managerApproval?.status, 'not_required', `${spec.flavor}: <= $1000 managerApproval not_required`);
    assert.equal(state.messages.at(-1).text, 'The review is ready in the trip panel.', `${spec.flavor}: prepare fallback text`);
    assert.deepEqual(state.messages.at(-1).tools, [{ name: 'travel_prepare', status: 'completed' }], `${spec.flavor}: prepare tool status`);

    const approveTrace = makeTraceHeaders(sid, '4444');
    const approveRes = await apiJson(
      baseUrl,
      'POST',
      `/agent/api/sessions/${sid}/approve`,
      { requestId: state.pending.id },
      approveTrace,
    );
    assert.equal(approveRes.status, 200, `${spec.flavor}: <= $1000 approve status`);
    assert.deepEqual(
      approveRes.data,
      { accepted: true, awaitingManagerApproval: false, completed: true },
      `${spec.flavor}: <= $1000 approve response`,
    );

    for (const suffix of ['approve', 'tools/book', 'tools/order']) {
      const hit = ota.requests.findLast(r => r.path === `/api/bookings/sessions/${sid}/${suffix}`);
      assert.ok(hit, `${spec.flavor}: OTA /${suffix} called during approve`);
      assert.equal(hit.headers.traceparent, approveTrace.traceparent, `${spec.flavor}: /${suffix} traceparent propagated`);
      assert.equal(hit.headers.baggage, approveTrace.baggage, `${spec.flavor}: /${suffix} baggage propagated`);
    }

    state = (await apiJson(baseUrl, 'GET', `/agent/api/sessions/${sid}`)).data;
    assert.equal(state.booking?.verified, true, `${spec.flavor}: booking verified`);
    assert.equal(state.booking?.paymentStatus, 'PENDING', `${spec.flavor}: booking paymentStatus PENDING`);
    assert.equal(
      state.messages.at(-2).text,
      TRAVEL_POLICY.confirmContinuationTemplate.replaceAll('{{requestId}}', state.pending.id),
      `${spec.flavor}: confirmContinuationTemplate recorded verbatim`,
    );
    assert.deepEqual(
      state.messages.at(-1).tools,
      [{ name: 'travel_book', status: 'completed' }, { name: 'travel_order', status: 'completed' }],
      `${spec.flavor}: travel_book + travel_order tools recorded`,
    );

    await apiJson(baseUrl, 'POST', `/agent/api/sessions/${sid}/messages`, { text: 'Please check my reservation' });
    assert.deepEqual(llm.calls.at(-2).offeredTools, ['travel_order'], `${spec.flavor}: post-booking tools restricted to travel_order`);

    const payTrace = makeTraceHeaders(sid, '5555');
    const payRes = await apiJson(baseUrl, 'POST', `/agent/api/sessions/${sid}/pay`, { requestId: state.pending.id }, payTrace);
    assert.equal(payRes.status, 200, `${spec.flavor}: /pay status`);
    assert.equal(payRes.data.paid, true, `${spec.flavor}: /pay paid=true`);
    assert.equal(payRes.data.booking?.paymentStatus, 'PAID', `${spec.flavor}: /pay booking PAID`);
    const payOtaCall = ota.requests.findLast(r => r.path === `/api/bookings/sessions/${sid}/pay`);
    assert.equal(payOtaCall.headers.traceparent, payTrace.traceparent, `${spec.flavor}: /pay traceparent propagated`);
    assert.equal(payOtaCall.headers.baggage, payTrace.baggage, `${spec.flavor}: /pay baggage propagated`);

    const sid2 = (await apiJson(baseUrl, 'POST', '/agent/api/sessions', {})).data.id;
    await apiJson(baseUrl, 'POST', `/agent/api/sessions/${sid2}/messages`, { text: 'Find flights from LHR to CDG on 2026-12-01' });
    await apiJson(
      baseUrl,
      'POST',
      `/agent/api/sessions/${sid2}/messages`,
      { text: 'Prepare offer FL-1450:ECO-FULL for Pat Highfare', offerId: 'FL-1450:ECO-FULL' },
    );
    let state2 = (await apiJson(baseUrl, 'GET', `/agent/api/sessions/${sid2}`)).data;
    assert.equal(state2.pending?.managerApproval?.status, 'not_requested', `${spec.flavor}: > $1000 managerApproval not_requested`);

    const blockedApprove = await apiJson(
      baseUrl,
      'POST',
      `/agent/api/sessions/${sid2}/approve`,
      { requestId: state2.pending.id, injectSilentBug: false },
    );
    assert.equal(blockedApprove.status, 200, `${spec.flavor}: > $1000 hold status`);
    assert.deepEqual(
      blockedApprove.data,
      { accepted: true, awaitingManagerApproval: true },
      `${spec.flavor}: TRV-01 blocks > $1000 without manager approval`,
    );
    state2 = (await apiJson(baseUrl, 'GET', `/agent/api/sessions/${sid2}`)).data;
    assert.equal(state2.booking, null, `${spec.flavor}: no booking created while awaiting manager approval`);

    const bugApprove = await apiJson(
      baseUrl,
      'POST',
      `/agent/api/sessions/${sid2}/approve`,
      { requestId: state2.pending.id, injectSilentBug: true },
    );
    assert.equal(bugApprove.status, 200, `${spec.flavor}: injectSilentBug approve status`);
    assert.deepEqual(
      bugApprove.data,
      { accepted: true, awaitingManagerApproval: false, completed: true },
      `${spec.flavor}: injectSilentBug bypasses manager approval gate`,
    );
    state2 = (await apiJson(baseUrl, 'GET', `/agent/api/sessions/${sid2}`)).data;
    assert.equal(state2.booking?.verified, true, `${spec.flavor}: silent bug booking verified`);
    assert.equal(state2.booking?.demoFault?.kind, 'skip_manager_approval', `${spec.flavor}: demoFault attached`);
    assert.equal(
      state2.messages.at(-2).text,
      TRAVEL_POLICY.silentBugContinuationTemplate.replaceAll('{{requestId}}', state2.pending.id),
      `${spec.flavor}: silentBugContinuationTemplate recorded verbatim`,
    );

    const sid3 = (await apiJson(baseUrl, 'POST', '/api/sessions', {})).data.id;
    await apiJson(baseUrl, 'POST', `/api/sessions/${sid3}/messages`, { text: 'Find flights from LHR to CDG on 2026-12-01' });
    await apiJson(baseUrl, 'POST', `/api/sessions/${sid3}/messages`, {
      text: 'Prepare offer FL-240:ECO-FLEX for Sam Cancel',
      offerId: 'FL-240:ECO-FLEX',
    });
    const state3 = (await apiJson(baseUrl, 'GET', `/api/sessions/${sid3}`)).data;
    const cancelRes = await apiJson(baseUrl, 'POST', `/api/sessions/${sid3}/cancel-booking`, { requestId: state3.pending.id });
    assert.deepEqual(cancelRes.data, { cancelled: true }, `${spec.flavor}: /cancel-booking returns cancelled: true`);
    const abortRes = await apiJson(baseUrl, 'POST', `/api/sessions/${sid3}/abort`, {});
    assert.deepEqual(abortRes.data, { stopped: true }, `${spec.flavor}: /abort returns stopped: true`);

    console.log(`PASS ${spec.flavor}: status, dual-mount, 200/400 search, immediate-stop prepare, TRV-01 hold + silent-bug, approve/book/order, pay, cancel, abort, W3C traceparent+baggage`);
  } finally {
    child.kill('SIGTERM');
    await new Promise(resolve => {
      if (child.exitCode !== null) return resolve();
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, 3_000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}

const ota = await startMockOtaServer();
const llm = await startMockLlmServer();

const runtimes = [
  {
    flavor: 'vercel-ai',
    cwd: join(ROOT, 'agents/vercel-ai'),
    cmd: process.execPath,
    args: ['server.mjs'],
  },
  {
    flavor: 'langgraph-py',
    cwd: join(ROOT, 'agents/langgraph-py'),
    cmd: 'uv',
    args: ['run', 'python', 'server.py'],
  },
  {
    flavor: 'google-adk-py',
    cwd: join(ROOT, 'agents/google-adk-py'),
    cmd: 'uv',
    args: ['run', 'python', 'server.py'],
  },
];

try {
  for (const runtime of runtimes) {
    await verifyRuntime(runtime, ota, llm);
  }
  console.log(`Agent conformance suite passed across all ${runtimes.length} runtimes.`);
} finally {
  ota.server.close();
  llm.server.close();
}
