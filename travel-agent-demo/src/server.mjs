import { createServer, request as httpRequest } from 'node:http';
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { guardBrowserRequest, checkInternalToken, readJSON, publicError } from './security.mjs';
import { TravelAPI } from './travel-api.mjs';
import { TRAVEL_POLICY } from './travel-policy.mjs';

const STATIC = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/styles.css': ['styles.css', 'text/css; charset=utf-8'] };
const HOP_HEADERS = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'host']);

function reply(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function proxyToTravel(req, res, baseUrl) {
  const upstream = new URL(baseUrl);
  const headers = Object.fromEntries(Object.entries(req.headers).filter(([name, value]) => value !== undefined && !HOP_HEADERS.has(name.toLowerCase())));
  headers.host = upstream.host;
  const outgoing = httpRequest({ protocol: upstream.protocol, hostname: upstream.hostname, port: upstream.port || undefined, method: req.method, path: `${req.url}`, headers, timeout: 30_000 }, response => {
    const responseHeaders = Object.fromEntries(Object.entries(response.headers).filter(([name, value]) => value !== undefined && !HOP_HEADERS.has(name.toLowerCase())));
    res.writeHead(response.statusCode ?? 502, responseHeaders);
    response.pipe(res);
  });
  outgoing.on('timeout', () => outgoing.destroy(new Error('The OTA web app did not respond in time.')));
  outgoing.on('error', error => {
    if (!res.headersSent) reply(res, 502, { error: `The OTA web app is unavailable: ${String(error.message).slice(0, 200)}` });
    else res.destroy(error);
  });
  res.on('close', () => { if (!res.writableEnded) outgoing.destroy(); });
  req.pipe(outgoing);
}

export function createGateway({ root, engine, store, internalToken, travel = new TravelAPI(), maxConversations = 3, basePath = '', registryFilePath = join(root, '.runtime/sessions.json') }) {
  if (basePath && (!/^\/[A-Za-z0-9_-]+$/.test(basePath))) throw new Error('basePath must be a single URL path segment.');
  const records = registryFilePath && existsSync(registryFilePath) ? JSON.parse(readFileSync(registryFilePath, 'utf8')) : [];
  if (!Array.isArray(records) || (maxConversations !== null && records.length > 100) || records.some(record => !/^ses_[A-Za-z0-9_-]+$/.test(record.id ?? '') || typeof record.used !== 'boolean' || !Number.isInteger(record.turnCount))) throw new Error('Invalid saved session registry; refusing to reset the usage limit.');
  const sessions = new Map(records.map(record => [record.id, { ...record, busy: Boolean(record.busy || record.stopping), stopping: Boolean(record.busy || record.stopping), generation: record.generation ?? 0, lastError: record.busy || record.stopping ? 'The previous run stopped. Use Stop agent to confirm engine idleness before retrying.' : null }]));
  function persist() {
    if (!registryFilePath) return;
    mkdirSync(dirname(registryFilePath), { recursive: true, mode: 0o700 });
    const temporary = `${registryFilePath}.tmp`;
    writeFileSync(temporary, JSON.stringify([...sessions.values()], null, 2), { mode: 0o600 });
    renameSync(temporary, registryFilePath);
  }
  function getSession(id) {
    const record = sessions.get(id);
    if (!record) throw publicError('This travel conversation was not found.', 404);
    return record;
  }
  function checkPrompt(record) {
    if ([...sessions.values()].some(item => item.stopping)) throw publicError('An earlier turn has not been confirmed stopped. No further model requests are allowed yet.', 409);
    if (record.busy) throw publicError('Wait for the current response or stop it first.', 409);
    if (maxConversations !== null && !record.used && [...sessions.values()].filter(item => item.used).length >= maxConversations) throw publicError('The approved live-test conversation budget is used. Request approval before enabling more model tests.', 409);
  }
  async function stopTurn(record) {
    record.generation = (record.generation ?? 0) + 1;
    const generation = record.generation;
    record.busy = true; record.stopping = true;
    const pending = store.getPending(record.id);
    if (pending && ['awaiting_approval', 'approved'].includes(pending.status)) store.cancel(record.id, pending.id);
    let saveError;
    try { persist(); } catch (error) { saveError = error; }
    try {
      const aborted = await engine.request(`/session/${encodeURIComponent(record.id)}/abort`, { method: 'POST', timeout: 10_000 });
      if (aborted !== true) throw new Error('Engine did not acknowledge cancellation.');
      const statuses = await engine.request('/session/status', { timeout: 5000 });
      if (!statuses || typeof statuses !== 'object' || Array.isArray(statuses) || Object.entries(statuses).some(([id, status]) => !id.startsWith('ses_') || !['idle', 'busy', 'retry'].includes(status?.type))) throw new Error('Engine did not return a valid activity state.');
      if (statuses[record.id] && statuses[record.id].type !== 'idle') throw new Error('The engine still reports an active turn.');
      if (saveError) throw saveError;
      if (record.generation === generation) { record.busy = false; record.stopping = false; persist(); }
    } catch (error) {
      if (record.generation === generation) {
        record.busy = true; record.stopping = true;
        record.lastError = `Stop could not be confirmed. Further model requests are blocked. ${error.message}`;
        try { persist(); } catch { /* remain blocked in memory even if disk is unavailable */ }
      }
      throw publicError(record.lastError ?? 'Stop is not confirmed.', 409);
    }
  }
  function queuePrompt(record, text) {
    checkPrompt(record);
    record.used = true; record.turnCount += 1; record.busy = true; record.lastError = null;
    record.generation = (record.generation ?? 0) + 1;
    const generation = record.generation;
    persist();
    void engine.request(`/session/${encodeURIComponent(record.id)}/message`, { method: 'POST', body: { parts: [{ type: 'text', text }], selectedOfferId: record.selectedOfferId ?? null } })
      .then(result => {
        if (record.generation !== generation) return;
        const error = result?.info?.error;
        if (error) record.lastError = String(error.data?.message ?? error.message ?? error.name ?? 'The model request failed.').slice(0, 500);
      })
      .catch(async error => {
        if (record.generation !== generation) return;
        record.lastError = String(error.message).slice(0, 500);
        try { await stopTurn(record); } catch { /* stopTurn retains the unresolved gate */ }
      })
      .finally(() => {
        if (record.generation !== generation) return;
        record.busy = false;
        try { persist(); } catch (error) { record.lastError = `Could not save local state: ${error.message}`; }
      });
  }
  function requireKeys(args, allowed) {
    if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(key => !allowed.includes(key)) || allowed.some(key => args[key] === undefined)) throw publicError('Invalid travel tool arguments.');
  }
  function appPath(path) { return basePath ? (path === basePath ? '/' : path.startsWith(`${basePath}/`) ? path.slice(basePath.length) : null) : path; }

  const server = createServer(async (req, res) => {
    const port = server.address()?.port;
    let path;
    try { path = new URL(req.url, `http://127.0.0.1:${port}`).pathname; }
    catch { reply(res, 400, { error: 'Invalid request URL.' }); return; }
    const localPath = appPath(path);
    if (basePath && localPath === null) {
      try { guardBrowserRequest(req, port); proxyToTravel(req, res, travel.baseUrl); }
      catch (error) { if (!res.headersSent) reply(res, error.statusCode ?? 400, { error: String(error.message).slice(0, 700) }); }
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try {
      const route = localPath ?? path;
      if (route.startsWith('/internal/')) {
        if (req.headers.origin || req.method !== 'POST' || !checkInternalToken(req.headers.authorization, internalToken)) throw publicError('Internal travel tool capability required.', 403);
        if (req.headers.host !== `127.0.0.1:${port}`) throw publicError('Invalid internal host.', 403);
        const operation = route.slice('/internal/travel/'.length);
        if (!route.startsWith('/internal/travel/') || !['search', 'prepare', 'book', 'order'].includes(operation)) throw publicError('Unknown internal operation.', 404);
        const { sessionId, args } = await readJSON(req, ['sessionId', 'args']);
        const record = getSession(sessionId);
        if (!record.busy || record.stopping) throw publicError('A live, non-stopping travel-agent turn is required.', 409);
        const generation = record.generation;
        const requireCurrentTurn = () => {
          if (!record.busy || record.stopping || record.generation !== generation) throw publicError('This agent turn was stopped. No new application action is allowed.', 409);
        };
        let result;
        if (operation === 'search') {
          requireKeys(args, ['origin', 'destination', 'date']);
          if (record.selectedOfferId) throw publicError('The traveler selected a flight. Reuse that offer instead of searching again.', 409);
          if (record.preparedGeneration === generation) throw publicError('A booking review was just prepared. Start a new agent message before searching again.', 409);
          const offers = await travel.search(args);
          requireCurrentTurn();
          if (record.selectedOfferId) throw publicError('The traveler selected a flight. Reuse that offer instead of searching again.', 409);
          if (record.preparedGeneration === generation) throw publicError('A booking review was just prepared. Start a new agent message before searching again.', 409);
          store.setOffers(sessionId, offers);
          result = { offers: offers.map(offer => ({ ...offer, offerId: offer.id })), constraints: 'One-way economy, one adult. Synthetic inventory; no payment.' };
        } else if (operation === 'prepare') {
          requireKeys(args, ['offerId', 'firstName', 'lastName']);
          if (record.preparedGeneration === generation) throw publicError('A review was already prepared in this agent turn.', 409);
          if (record.selectedOfferId && args.offerId !== record.selectedOfferId) throw publicError('Prepare the exact flight offer selected by the traveler.', 409);
          result = store.prepare(sessionId, { offerId: args.offerId, passenger: { firstName: args.firstName, lastName: args.lastName } });
          record.preparedGeneration = generation;
          delete record.selectedOfferId;
        } else if (operation === 'book') {
          requireKeys(args, ['requestId']);
          result = await store.submit(sessionId, args.requestId, request => travel.bookAndVerify(request));
        } else {
          requireKeys(args, []);
          const request = store.getPending(sessionId);
          const reference = request?.result?.confirmationNumber;
          if (!reference) throw publicError('No known reservation reference exists. Do not repeat an uncertain booking.');
          result = await travel.queryAndVerify(request, reference);
          result = store.completeReadBack(sessionId, request.id, result);
        }
        return reply(res, 200, result);
      }

      guardBrowserRequest(req, port);
      if (req.method === 'GET' && STATIC[route]) {
        const [name, contentType] = STATIC[route];
        const body = await readFile(join(root, 'public', name));
        res.writeHead(200, { 'Content-Type': contentType }); res.end(body); return;
      }
      if (req.method === 'GET' && route === '/api/status') {
        const [runtimeResult, ota] = await Promise.allSettled([
          engine.request('/global/health', { timeout: 2000 }),
          fetch(`${travel.baseUrl}/`, { signal: AbortSignal.timeout(2000), redirect: 'error' }).then(response => response.ok),
        ]);
        const runtimeReady = runtimeResult.status === 'fulfilled' && Boolean(runtimeResult.value?.healthy);
        const travelReady = ota.status === 'fulfilled' && ota.value;
        const providers = typeof engine.availableProviders === 'function' ? engine.availableProviders() : [];
        const defaults = typeof engine.resolveSelection === 'function' ? (() => { try { return engine.resolveSelection(); } catch { return { provider: null, model: '' }; } })() : { provider: null, model: '' };
        const providerConfigured = providers.length > 0 || typeof engine.availableProviders !== 'function';
        const date = new Date(); date.setDate(date.getDate() + 7);
        return reply(res, 200, { ready: runtimeReady && providerConfigured && travelReady, runtime: runtimeReady, providers, defaultProvider: defaults.provider, defaultModel: defaults.model, model: defaults.provider ? `${defaults.provider}/${defaults.model}` : 'No provider configured', travel: travelReady, environment: 'local synthetic demo', defaultDate: date.toISOString().slice(0, 10), conversationLimit: maxConversations, conversationsUsed: [...sessions.values()].filter(item => item.used).length });
      }
      if (req.method === 'POST' && route === '/api/sessions') {
        const requested = await readJSON(req, ['provider', 'model']);
        if (maxConversations !== null && sessions.size >= 100) throw publicError('Local conversation storage is full.', 409);
        let selection;
        try { selection = typeof engine.resolveSelection === 'function' ? engine.resolveSelection(requested.provider, requested.model) : { provider: requested.provider ?? null, model: requested.model ?? '' }; }
        catch (error) { throw publicError(error.message); }
        const created = await engine.request('/session', { method: 'POST', body: selection });
        if (!/^ses_[A-Za-z0-9_-]+$/.test(created?.id ?? '')) throw new Error('The local model runtime did not return a valid session ID.');
        const record = { id: created.id, provider: created.provider ?? selection.provider, model: created.model ?? selection.model, used: false, turnCount: 0, busy: false, stopping: false, generation: 0, lastError: null, createdAt: new Date().toISOString() };
        sessions.set(created.id, record); persist();
        return reply(res, 201, { id: created.id, provider: record.provider, model: record.model });
      }
      const match = route.match(/^\/api\/sessions\/(ses_[A-Za-z0-9_-]+)(?:\/(messages|approve|cancel-booking|abort))?$/);
      if (!match) throw publicError('Not found.', 404);
      const record = getSession(match[1]);
      const action = match[2];
      if (req.method === 'GET' && !action) {
        const raw = await engine.request(`/session/${encodeURIComponent(record.id)}/message`, { timeout: 5000 });
        if (!Array.isArray(raw)) throw new Error('The local model runtime returned an unexpected message list.');
        const messages = raw.map(message => ({
          id: message.info?.id,
          role: message.info?.role,
          text: (message.parts ?? []).filter(part => part.type === 'text' && !part.synthetic).map(part => part.text ?? '').join('\n'),
          tools: (message.parts ?? []).filter(part => part.type === 'tool').map(part => ({ name: part.tool, status: part.state?.status ?? 'pending' })),
        })).filter(message => ['user', 'assistant'].includes(message.role));
        return reply(res, 200, { id: record.id, provider: record.provider, model: record.model, messages, busy: record.busy, pending: store.getPending(record.id), offers: store.getOffers(record.id), booking: store.getBooking(record.id), travelPolicy: TRAVEL_POLICY, lastError: record.lastError });
      }
      if (req.method !== 'POST') throw publicError('Method not allowed.', 405);
      if (action === 'messages') {
        const { text, offerId } = await readJSON(req, ['text', 'offerId']);
        if (typeof text !== 'string' || !text.trim() || text.length > 4000) throw publicError('Enter a message of 1–4000 characters.');
        checkPrompt(record);
        const message = text.trim();
        if (offerId !== undefined) {
          if (typeof offerId !== 'string' || !store.getOffers(record.id).some(offer => offer.id === offerId)) throw publicError('Choose a flight returned by this conversation.', 404);
          record.selectedOfferId = offerId;
        } else if (record.selectedOfferId && !/^[A-Za-z][A-Za-z' -]{0,9}\s+[A-Za-z][A-Za-z' -]{0,9}$/.test(message)) {
          delete record.selectedOfferId;
        }
        queuePrompt(record, message);
        return reply(res, 202, { accepted: true });
      }
      if (action === 'approve') {
        const { requestId, injectSilentBug } = await readJSON(req, ['requestId', 'injectSilentBug']);
        checkPrompt(record);
        if (injectSilentBug !== undefined && typeof injectSilentBug !== 'boolean') throw publicError('injectSilentBug must be a boolean.');
        if (typeof requestId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(requestId)) throw publicError('A valid booking requestId is required.');
        const before = store.getPending(record.id);
        if (!before || before.id !== requestId) throw publicError('Booking request not found in this session.', 404);
        if (before.offer.currency !== 'USD') throw publicError('This USD policy cannot be evaluated for a non-USD fare. No reservation has been created.', 409);
        store.approve(record.id, requestId, { injectSilentBug: injectSilentBug === true });
        const confirmed = store.getPending(record.id);
        if (confirmed.managerApproval?.status !== 'not_required' && injectSilentBug !== true) {
          return reply(res, 200, { accepted: true, awaitingManagerApproval: true });
        }
        const continuation = injectSilentBug === true
          ? `Controlled demo fault: the traveler explicitly enabled the skipped-manager-approval simulation and confirmed this synthetic booking. Manager approval has NOT been granted. For this controlled simulation only, use travel_book with exactly requestId ${requestId}. The gateway will bypass only the manager-approval gate. Do not change the flight, fare, or traveler; do not prepare another request. Report only the actual tool result and the pending payment. This is an injected demo failure, not permission for future bookings.`
          : `I clicked Confirm demo booking in the browser. The local gateway approved requestId ${requestId}. Use travel_book with exactly that requestId, then report the independently verified reservation and pending payment. Do not prepare or book another request.`;
        queuePrompt(record, continuation);
        return reply(res, 202, { accepted: true });
      }
      if (action === 'cancel-booking') {
        const { requestId } = await readJSON(req, ['requestId']);
        if (record.busy) throw publicError('Stop the current agent turn before canceling the review.', 409);
        store.cancel(record.id, requestId);
        return reply(res, 200, { cancelled: true });
      }
      if (action === 'abort') {
        await readJSON(req, []);
        await stopTurn(record);
        return reply(res, 200, { stopped: true });
      }
      throw publicError('Not found.', 404);
    } catch (error) {
      if (!res.headersSent) reply(res, error.statusCode ?? 400, { error: String(error.message ?? 'Request failed').slice(0, 700) });
      else res.end();
    }
  });
  server.requestTimeout = 65_000;
  server.headersTimeout = 10_000;
  return server;
}
