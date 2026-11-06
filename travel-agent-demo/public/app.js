(() => {
  'use strict';

  const byId = (id) => document.getElementById(id);
  const ui = {
    connection: byId('connection-label'), dot: byId('connection-dot'),
    gateway: byId('gateway-banner'), gatewayMessage: byId('gateway-message'),
    retryConnection: byId('retry-connection'), newConversation: byId('new-conversation'),
    provider: byId('model-provider'), modelInput: byId('model-id'),
    runtime: byId('runtime-status'), travel: byId('travel-status'),
    model: byId('model-status'), environment: byId('environment-status'),
    conversationState: byId('conversation-state'), tripLink: byId('trip-link'),
    workspace: byId('workspace'), conversationHeader: byId('conversation-header'),
    scroll: byId('conversation-scroll'), empty: byId('empty-state'),
    messages: byId('messages'), activity: byId('activity'), latest: byId('jump-latest'),
    actionHistory: byId('conversation-actions'), actionSummary: byId('actions-summary'), actionList: byId('actions-list'),
    error: byId('error-banner'), errorText: byId('error-text'),
    retrySession: byId('retry-session'), dismissError: byId('dismiss-error'),
    notice: byId('notice'), composer: byId('composer'), input: byId('message-input'),
    send: byId('send-button'), stop: byId('stop-button'), announcer: byId('announcer'),
    tripPanel: byId('trip-panel'), pending: byId('pending-review'),
    pendingStatus: byId('pending-status'), pendingDetail: byId('pending-status-detail'),
    managerStatus: byId('manager-approval-status'),
    pendingOffer: byId('pending-offer'), passenger: byId('pending-passenger'),
    expiry: byId('pending-expiry'), injectBug: byId('inject-bug-button'), approve: byId('approve-button'),
    bugDialog: byId('inject-bug-dialog'), bugEnable: byId('enable-silent-bug'),
    bugCancel: byId('cancel-silent-bug'), bugDisable: byId('disable-silent-bug'), bugHint: byId('inject-bug-hint'),
    cancel: byId('cancel-button'), approvalHint: byId('approval-hint'),
    offersSection: byId('offers-section'), offers: byId('offers'), offersCount: byId('offers-count'),
    booking: byId('booking-result'), bookingTitle: byId('booking-title'),
    bookingVerification: byId('booking-verification'), bookingNote: byId('booking-verification-note'),
    bookingDetails: byId('booking-details'), skippedReceipt: byId('skipped-approval-receipt'),
  };

  const SESSION_KEY = 'demo-ota.travel.sessionId';
  const MODEL_PREF_KEY = 'demo-ota.travel.model';
  const API_BASE = window.location.pathname === '/agent' || window.location.pathname.startsWith('/agent/') ? '/agent' : '';
  const savedModel = readStoredModel();
  const savedSession = readStoredSession();
  const state = {
    status: null, statusChecking: false, statusError: '',
    modelProvider: savedModel?.provider ?? '', modelId: savedModel?.model ?? '',
    sessionId: savedSession, session: null, restoring: Boolean(savedSession),
    syncing: false, request: '', recoveryNeeded: false,
    error: '', errorKind: '', dismissedServerError: '', notice: '',
    selectedOfferId: null, approvalRequestId: null, followOutput: true,
    injectSilentBug: false, bugReviewKey: null, bugDialogKey: null, bugAttemptKey: null,
  };
  const messageViews = new Map();
  let generation = 0;
  let statusTimer = null;
  let sessionTimer = null;
  let expiryTimer = null;
  let offersSignature = '';
  let pendingSignature = '';
  let bookingSignature = '';
  let actionSignature = '';
  class ApiError extends Error {
    constructor(message, status = 0) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
    }
  }

  function hasValue(value) {
    return value !== null && value !== undefined && String(value).trim() !== '';
  }

  function text(value, fallback = 'Not returned') {
    if (!hasValue(value)) return fallback;
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  }

  function setText(node, value) {
    const next = String(value);
    if (node.textContent !== next) node.textContent = next;
  }

  function element(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = String(value);
    return node;
  }

  function announce(message) {
    setText(ui.announcer, message);
  }

  async function api(path, method = 'GET', body) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`${API_BASE}${path}`, {
        method,
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        headers: { Accept: 'application/json', ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const raw = await response.text();
      let data = null;
      if (raw) {
        try { data = JSON.parse(raw); }
        catch { throw new ApiError('The gateway returned an unreadable response. Refresh before retrying an action.', response.status); }
      }
      if (!response.ok) {
        throw new ApiError(typeof data?.error === 'string' ? data.error : `The gateway returned HTTP ${response.status}.`, response.status);
      }
      return data;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error.name === 'AbortError') throw new ApiError('The local gateway did not respond in time.');
      throw new ApiError('Could not reach the local gateway. Check that it is running.');
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function serviceLabel(value) {
    if (value === true) return 'Ready';
    if (value === false) return 'Unavailable';
    return text(value, 'Not checked');
  }

  function readStoredModel() {
    try {
      const value = JSON.parse(window.localStorage.getItem(MODEL_PREF_KEY) ?? 'null');
      return value && typeof value.provider === 'string' && typeof value.model === 'string' ? value : null;
    } catch { return null; }
  }

  function storeModel() {
    try { window.localStorage.setItem(MODEL_PREF_KEY, JSON.stringify({ provider: state.modelProvider, model: state.modelId })); }
    catch { /* model preferences are optional and never contain credentials */ }
  }

  function renderModelChoice() {
    const providers = Array.isArray(state.status?.providers) ? state.status.providers : [];
    const current = state.session?.provider;
    const available = providers.slice();
    if (current && !available.some(item => item.id === current)) available.push({ id: current, label: current });
    const signature = available.map(item => `${item.id}:${item.label}`).join('|');
    if (ui.provider.dataset.options !== signature) {
      ui.provider.replaceChildren(...available.map(item => {
        const option = document.createElement('option');
        option.value = item.id; option.textContent = item.label; option.dataset.defaultModel = item.defaultModel ?? '';
        return option;
      }));
      ui.provider.dataset.options = signature;
    }
    if (state.session?.provider) {
      state.modelProvider = state.session.provider;
      state.modelId = state.session.model ?? '';
    } else if (available.length) {
      if (!available.some(item => item.id === state.modelProvider)) {
        state.modelProvider = state.status?.defaultProvider || available[0].id;
        state.modelId = '';
      }
      const selected = available.find(item => item.id === state.modelProvider) ?? available[0];
      if (!state.modelId) state.modelId = selected.defaultModel ?? state.status?.defaultModel ?? '';
    } else {
      state.modelProvider = ''; state.modelId = '';
    }
    ui.provider.value = state.modelProvider;
    ui.modelInput.value = state.modelId;
    const locked = Boolean(state.sessionId) || providers.length === 0;
    ui.provider.disabled = locked;
    ui.modelInput.disabled = locked;
  }


  function renderStatus() {
    const ready = state.status?.ready === true && !state.statusError;
    setText(ui.connection, ready ? 'Connected' : state.statusError ? 'Unavailable' : state.status ? 'Starting up' : 'Connecting');
    ui.dot.dataset.state = ready ? 'ready' : state.statusError ? 'error' : 'waiting';
    ui.gateway.hidden = ready;
    setText(ui.gatewayMessage, state.statusError
      ? `${state.statusError} Retrying automatically.`
      : state.status?.providers?.length === 0 ? 'Configure a model provider key on the server to start the agent.'
        : state.status ? 'Waiting for the Vercel AI runtime and travel service. Retrying automatically.' : 'Connecting to the local gateway…');
    ui.retryConnection.disabled = state.statusChecking;
    setText(ui.runtime, serviceLabel(state.status?.runtime));
    setText(ui.travel, serviceLabel(state.status?.travel));
    renderModelChoice();
    const activeModel = state.session?.provider ? `${state.session.provider}/${state.session.model}` : state.status?.model;
    setText(ui.model, text(activeModel));
    setText(ui.environment, text(state.status?.environment, 'Not checked'));
  }


  function readStoredSession() {
    try {
      const value = window.sessionStorage.getItem(SESSION_KEY);
      return typeof value === 'string' && value.length > 0 ? value : null;
    } catch { return null; }
  }

  function storeSession(id) {
    try {
      if (id === null) window.sessionStorage.removeItem(SESSION_KEY);
      else window.sessionStorage.setItem(SESSION_KEY, id);
    } catch {
      state.notice = 'Browser storage is unavailable. This conversation cannot be restored after a refresh.';
    }
  }

  function sessionPath(id = state.sessionId) {
    return `/api/sessions/${encodeURIComponent(id)}`;
  }

  function canSend() {
    return state.status?.ready === true && !state.statusError && !state.request &&
      !state.syncing && !state.restoring && !state.recoveryNeeded && !state.session?.busy;
  }

  function renderControls() {
    const busy = state.session?.busy === true;
    const hasTrip = Boolean(state.session?.pending || state.session?.booking || state.session?.offers?.length);
    const initial = !state.session?.messages?.length && !hasTrip && !busy && !state.request && !state.restoring;
    ui.workspace.classList.toggle('workspace--single', !hasTrip);
    ui.workspace.classList.toggle('workspace--initial', Boolean(initial));
    ui.conversationHeader.hidden = Boolean(initial);
    ui.tripPanel.hidden = !hasTrip;
    ui.tripLink.hidden = !hasTrip;
    ui.newConversation.hidden = !state.sessionId;
    ui.scroll.tabIndex = initial ? -1 : 0;
    ui.send.disabled = !canSend() || !ui.input.value.trim();
    ui.newConversation.disabled = busy || Boolean(state.request) || state.syncing;
    ui.stop.hidden = !busy && !['message', 'approve'].includes(state.request);
    ui.stop.disabled = !busy || Boolean(state.request) || state.syncing;
    setText(ui.stop, state.request === 'abort' ? 'Stopping…' : 'Stop agent');
    setText(ui.send, state.request === 'message' ? 'Sending…' : 'Send message');
    setText(ui.conversationState, state.restoring ? 'Restoring conversation' : state.request ? 'Updating' :
      state.recoveryNeeded ? 'Needs refresh' : busy ? 'Agent working' :
      awaitingManagerApproval() ? 'Awaiting manager approval' :
      state.session?.pending?.status === 'awaiting_approval' ? 'Review ready' :
      state.sessionId ? 'Conversation ready' : 'No session yet');
    const activities = {
      message: 'Sending your message…', approve: 'Sending your confirmation…',
      cancel: 'Discarding the review request…', abort: 'Requesting the agent to stop…',
    };
    const activity = activities[state.request] ||
      (state.restoring ? 'Restoring your conversation…' : busy ? 'Agent is working…' : '');
    ui.activity.hidden = !activity;
    setText(ui.activity, activity);
    ui.messages.setAttribute('aria-busy', String(busy));
    ui.empty.hidden = Boolean(state.session?.messages?.length) || Boolean(activity);
    ui.retrySession.hidden = !state.sessionId;
    ui.retrySession.disabled = state.syncing || Boolean(state.request);
    renderTripControls();
  }

  function renderErrors() {
    const serverError = typeof state.session?.lastError === 'string' ? state.session.lastError : '';
    const error = state.error || (serverError !== state.dismissedServerError ? serverError : '');
    ui.error.hidden = !error;
    setText(ui.errorText, error);
    const completedConfirmation = (state.session?.pending?.status === 'completed' || awaitingManagerApproval()) && state.notice.startsWith('Confirmation sent.');
    ui.notice.hidden = !state.notice || completedConfirmation;
    setText(ui.notice, state.notice);
  }

  function renderToolActivity(messages) {
    if (!ui.actionHistory) return false;
    const tools = messages.flatMap((message) => Array.isArray(message.tools) ? message.tools : []);
    const signature = JSON.stringify(tools);
    if (signature === actionSignature) return false;
    actionSignature = signature;
    ui.actionHistory.hidden = tools.length === 0;
    const failed = tools.some((tool) => tool.status === 'error');
    if (failed && ui.actionHistory.dataset.failed !== 'true') ui.actionHistory.open = true;
    if (!tools.length) ui.actionHistory.open = false;
    ui.actionHistory.dataset.failed = String(failed);
    setText(ui.actionSummary, failed ? 'Agent activity · action failed' : `Agent activity · ${tools.length} ${tools.length === 1 ? 'action' : 'actions'}`);
    ui.actionList.replaceChildren();
    const names = { travel_search: 'Search flights', travel_prepare: 'Prepare booking', travel_book: 'Book and verify', travel_order: 'Check reservation' };
    for (const tool of tools) {
      const row = element('li', 'tool-row');
      const label = element('span', 'tool-name', Object.hasOwn(names, tool.name) ? names[tool.name] : text(tool.name));
      const known = ['pending', 'running', 'completed', 'error'].includes(tool.status);
      const status = element('span', 'tool-status', known ? {
        pending: 'Pending', running: 'Running', completed: '', error: 'Failed',
      }[tool.status] : text(tool.status, 'Unknown'));
      status.dataset.state = known ? tool.status : 'unknown';
      status.hidden = tool.status === 'completed';
      row.append(label, status);
      ui.actionList.append(row);
    }
    return true;
  }

  function appendInlineMarkdown(target, source) {
    const pattern = /(`[^`]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_)/g;
    let cursor = 0;
    for (const match of source.matchAll(pattern)) {
      if (match.index > cursor) target.append(document.createTextNode(source.slice(cursor, match.index)));
      const token = match[0];
      const code = token.startsWith('`');
      const strong = token.startsWith('**') || token.startsWith('__');
      const wrapper = document.createElement(code ? 'code' : strong ? 'strong' : 'em');
      const content = token.slice(strong ? 2 : 1, strong ? -2 : -1);
      if (code) wrapper.textContent = content;
      else appendInlineMarkdown(wrapper, content);
      target.append(wrapper);
      cursor = match.index + token.length;
    }
    if (cursor < source.length) target.append(document.createTextNode(source.slice(cursor)));
  }

  function renderMarkdown(target, source) {
    target.replaceChildren();
    const lines = source.replace(/\r/g, '').split('\n');
    let paragraph = [];
    let list = null;
    const flushParagraph = () => {
      if (!paragraph.length) return;
      const block = document.createElement('p');
      paragraph.forEach((line, index) => {
        if (index) block.append(document.createElement('br'));
        appendInlineMarkdown(block, line);
      });
      target.append(block);
      paragraph = [];
    };
    for (const line of lines) {
      if (!line.trim()) { flushParagraph(); list = null; continue; }
      const item = line.match(/^\s{0,3}([-*+]\s+|\d+[.)]\s+)(.+)$/);
      if (item) {
        flushParagraph();
        const tag = /^\d/.test(item[1]) ? 'ol' : 'ul';
        if (!list || list.tagName.toLowerCase() !== tag) {
          list = document.createElement(tag);
          target.append(list);
        }
        const entry = document.createElement('li');
        appendInlineMarkdown(entry, item[2]);
        list.append(entry);
        continue;
      }
      list = null;
      const heading = line.match(/^\s{0,3}(#{1,3})\s+(.+)$/);
      if (heading) {
        flushParagraph();
        const title = document.createElement(`h${heading[1].length + 2}`);
        appendInlineMarkdown(title, heading[2]);
        target.append(title);
      } else paragraph.push(line);
    }
    flushParagraph();
  }

  function renderMessages() {
    const allMessages = state.session?.messages || [];
    let changed = renderToolActivity(allMessages);
    const messages = allMessages.filter((message) => typeof message.text === 'string' && message.text.trim());
    const keep = new Set();
    for (const [index, message] of messages.entries()) {
      const key = message.id;
      keep.add(key);
      let view = messageViews.get(key);
      if (!view) {
        const row = element('li', `message message--${message.role}`);
        const article = element('article');
        const heading = element('header', 'message-heading');
        const author = element('p', 'message-author');
        const body = element('div', 'message-body');
        const original = element('details', 'original-message');
        const originalText = element('div', 'original-message-body');
        original.append(element('summary', '', 'Original message'), originalText);
        original.hidden = true;
        heading.append(author);
        article.append(heading, body, original);
        row.append(article);
        view = { row, author, body, original, originalText, renderedText: null };
        messageViews.set(key, view);
        changed = true;
      }
      const internalConfirmation = message.role === 'user' && /^I clicked Confirm demo booking in the browser\. The local gateway approved requestId [0-9a-f-]{36}\. Use travel_book with exactly that requestId, then report the independently verified reservation and pending payment\. Do not prepare or book another request\.$/i.test(message.text);
      const internalDemoFault = message.role === 'user' && /^Controlled demo fault: the traveler explicitly enabled the skipped-manager-approval simulation and confirmed this synthetic booking\. Manager approval has NOT been granted\. For this controlled simulation only, use travel_book with exactly requestId [0-9a-f-]{36}\. The gateway will bypass only the manager-approval gate\. Do not change the flight, fare, or traveler; do not prepare another request\. Report only the actual tool result and the pending payment\. This is an injected demo failure, not permission for future bookings\.$/i.test(message.text);
      const internalOfferRequest = message.role === 'user' && /^I would like to review offer .+\. Ask for first and last name if needed\. Do not book it yet\.$/i.test(message.text);
      const staleApprovalInstruction = message.role === 'assistant' && awaitingManagerApproval() && /please click\s+\*{0,2}Confirm demo booking\*{0,2}/i.test(message.text);
      view.row.className = `message message--${internalDemoFault ? 'system' : message.role}`;
      setText(view.author, internalDemoFault ? 'Approval simulation' : message.role === 'user' ? 'You' : 'Assistant');
      const displayText = internalDemoFault ? 'Approval-failure simulation enabled.' : internalConfirmation ? 'Booking confirmation sent.' : internalOfferRequest ? 'Prepare this flight for review.' : staleApprovalInstruction ? 'Separate manager approval is pending. No reservation has been placed.' : message.text;
      if (view.renderedText !== displayText) {
        renderMarkdown(view.body, displayText);
        view.renderedText = displayText;
        changed = true;
      }
      view.original.hidden = !internalConfirmation && !internalDemoFault && !internalOfferRequest;
      setText(view.originalText, internalConfirmation || internalDemoFault || internalOfferRequest ? message.text : '');
      if (ui.messages.children[index] !== view.row) {
        ui.messages.insertBefore(view.row, ui.messages.children[index] || null);
        changed = true;
      }
    }
    for (const [key, view] of messageViews) {
      if (!keep.has(key)) {
        view.row.remove();
        messageViews.delete(key);
        changed = true;
      }
    }
    if (changed && state.followOutput) ui.scroll.scrollTop = ui.scroll.scrollHeight;
    if (changed && !state.followOutput) ui.latest.hidden = false;
  }

  function money(amount, currency) {
    if (!hasValue(amount)) return 'Price not returned';
    return hasValue(currency) ? `${text(currency)} ${text(amount)}` : `${text(amount)} (currency not returned)`;
  }

  function fullName(passenger) {
    return [passenger?.firstName, passenger?.lastName].filter(hasValue).map((part) => text(part)).join(' ') || 'Not returned';
  }

  function fillDetails(target, pairs) {
    target.replaceChildren();
    for (const [label, value] of pairs) {
      const row = element('div');
      row.append(element('dt', '', label), element('dd', '', text(value)));
      target.append(row);
    }
  }

  function flightEndpoint(airport, value, flightDate) {
    const endpoint = element('div', 'flight-endpoint');
    endpoint.append(element('p', 'airport', text(airport, '—')));
    const raw = text(value, 'Time not returned');
    const match = raw.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(Z|[+-]\d{2}:\d{2})?$/);
    const time = element('time', 'flight-time', match
      ? `${match[2]}${match[3] ? ` ${match[3] === 'Z' ? 'UTC' : match[3]}` : ''}` : raw);
    time.title = raw;
    if (match) time.dateTime = raw;
    endpoint.append(time);
    if (match && match[1] !== flightDate) endpoint.append(element('span', 'flight-day', match[1]));
    return endpoint;
  }

  function flightSummary(offer) {
    const summary = element('div', 'flight-summary');
    const identity = [offer?.airlineName, offer?.flightNumber].filter(hasValue).map((value) => text(value)).join(' · ');
    summary.append(element('p', 'flight-heading', identity || 'Flight information not returned'));
    summary.append(element('p', 'flight-date', text(offer?.date, 'Date not returned')));
    const route = element('div', 'flight-route');
    const separator = element('span', 'route-separator', '→');
    separator.setAttribute('aria-label', 'to');
    route.append(flightEndpoint(offer?.origin, offer?.departureTime, offer?.date), separator,
      flightEndpoint(offer?.destination, offer?.arrivalTime, offer?.date));
    const fare = element('div', 'fare-line');
    fare.append(element('p', 'fare-price', money(offer?.total, offer?.currency)),
      element('p', 'fare-cabin', text(offer?.cabinClass, 'Cabin not returned')));
    const details = element('details', 'fare-details');
    const list = element('dl', 'detail-list');
    details.append(element('summary', '', 'Offer details'), list);
    fillDetails(list, [['Offer ID', offer?.id], ['Flight ID', offer?.flightId], ['Fare ID', offer?.fareId]]);
    summary.append(route, fare, details);
    return summary;
  }

  function expiryTime(pending) {
    if (!hasValue(pending?.expiresAt)) return NaN;
    return new Date(pending.expiresAt).getTime();
  }

  function reviewComplete(pending) {
    return hasValue(pending?.id) && hasValue(pending?.offer?.id) &&
      hasValue(pending?.passenger?.firstName) && hasValue(pending?.passenger?.lastName);
  }

  function canApprove() {
    const pending = state.session?.pending;
    return canSend() && state.session?.busy === false && pending?.status === 'awaiting_approval' &&
      pending.offer?.currency === 'USD' && pending.managerApproval?.status !== 'unsupported_currency' &&
      reviewComplete(pending) && expiryTime(pending) > Date.now() && state.approvalRequestId !== pending.id;
  }

  function canDiscard() {
    const pending = state.session?.pending;
    return canSend() && state.session?.busy === false && hasValue(pending?.id) &&
      ((pending.status === 'awaiting_approval' && state.approvalRequestId !== pending.id) || awaitingManagerApproval());
  }

  function bugReviewKey() {
    const pending = state.session?.pending;
    return pending ? JSON.stringify([state.sessionId, pending.id, pending.offer?.id, pending.offer?.total, pending.offer?.currency]) : null;
  }

  function awaitingManagerApproval() {
    const pending = state.session?.pending;
    return pending?.status === 'approved' && pending.managerApproval?.status === 'pending' &&
      pending.demoFault?.kind !== 'skip_manager_approval';
  }

  function injectionUnavailableReason() {
    const pending = state.session?.pending;
    const offer = pending?.offer;
    const threshold = Number(pending?.managerApproval?.threshold ?? state.session?.travelPolicy?.threshold ?? 1000);
    const thresholdText = `$${threshold.toLocaleString('en-US')} USD`;
    if (offer?.currency !== 'USD') return `This simulation is available only for USD fares above ${thresholdText}.`;
    const total = hasValue(offer.total) ? Number(offer.total) : NaN;
    if (!Number.isFinite(total) || total < 0) return 'A valid USD fare is required to simulate skipped approval.';
    if (total <= threshold) return `Manager approval is not required for fares of ${thresholdText} or less. No skipped approval to simulate.`;
    return '';
  }

  function canInjectBug() {
    const pending = state.session?.pending;
    if (!pending || injectionUnavailableReason() || state.bugAttemptKey === bugReviewKey()) return false;
    if (canApprove()) return true;
    // A second POST is permitted only to explicitly inject the demo fault into
    // this already traveler-confirmed, manager-pending request, never to resend
    // a normal traveler confirmation or retry an uncertain submission.
    return awaitingManagerApproval() && canSend() && state.session.busy === false &&
      reviewComplete(pending) && expiryTime(pending) > Date.now();
  }

  function canContinueWithBug() {
    return state.injectSilentBug && awaitingManagerApproval() && canInjectBug();
  }

  function syncBugReview() {
    const key = bugReviewKey();
    if (key === state.bugReviewKey) return;
    state.bugReviewKey = key;
    state.injectSilentBug = false;
    state.bugDialogKey = null;
    if (ui.bugDialog.open) ui.bugDialog.close();
  }

  function blockedOfferChoice() {
    const pending = state.session?.pending;
    return ['approved', 'submitting', 'uncertain'].includes(pending?.status) ||
      (hasValue(pending?.id) && state.approvalRequestId === pending.id);
  }

  function renderTripControls() {
    syncBugReview();
    const pending = state.session?.pending;
    const managerPending = awaitingManagerApproval();
    ui.injectBug.disabled = !canInjectBug();
    ui.bugEnable.disabled = !canInjectBug();
    ui.injectBug.setAttribute('aria-pressed', String(state.injectSilentBug));
    setText(ui.injectBug, state.injectSilentBug ? 'Simulation armed' : 'Simulate skipped approval');
    ui.bugDisable.hidden = !state.injectSilentBug;
    ui.bugDisable.disabled = !canInjectBug();
    setText(ui.bugHint, injectionUnavailableReason() || (state.injectSilentBug
      ? managerPending ? 'Simulation armed for this request. Click Run simulation to submit it.' : 'Simulation armed for this request. Confirm booking to continue.'
      : canInjectBug() ? 'Simulate the manager-approval policy failure for this request.' : 'The simulation is unavailable until this request is ready for review.'));
    ui.approve.hidden = managerPending && !state.injectSilentBug;
    ui.approve.disabled = !canApprove() && !canContinueWithBug();
    ui.cancel.disabled = !canDiscard();
    setText(ui.approve, state.request === 'approve' ? 'Sending confirmation…' : managerPending && state.injectSilentBug ? 'Run simulation' : 'Confirm booking');
    setText(ui.cancel, state.request === 'cancel' ? 'Discarding…' : 'Discard request');
    for (const button of ui.offers.querySelectorAll('button[data-offer-id]')) {
      button.disabled = !canSend() || blockedOfferChoice() || !button.dataset.offerId || button.dataset.selected === 'true';
    }
    if (!pending) return;
    const states = {
      awaiting_approval: ['Awaiting confirmation', 'Review the passenger and fare before confirming.'],
      approved: ['Confirmation received', 'The agent is continuing this approved request. Do not submit it again.'],
      submitting: ['Submitting reservation', 'Waiting for the travel service. Do not submit this request again.'],
      completed: ['Request completed', 'Check the reservation record and its verification state in this panel.'],
      uncertain: ['Outcome uncertain', 'The reservation outcome is not confirmed. Do not book again. Ask the agent to check the existing reservation.'],
      expired: ['Request expired', 'Ask the agent for a fresh offer and review before confirming.'],
      cancelled: ['Request discarded', 'This review is no longer active. Discarding a request does not cancel an existing reservation.'],
    };
    const expiredHere = pending.status === 'awaiting_approval' && Number.isFinite(expiryTime(pending)) && expiryTime(pending) <= Date.now();
    const [label, detail] = expiredHere
      ? ['Review window ended', 'This request’s expiry time has passed. Ask the agent for a fresh review.']
      : awaitingManagerApproval()
        ? ['Awaiting manager approval', 'Your traveler confirmation was received. Manager approval is required before booking. No reservation has been created.']
        : Object.hasOwn(states, pending.status) ? states[pending.status] : ['Status unavailable', 'Refresh the conversation before taking any action.'];
    setText(ui.pendingStatus, label);
    ui.pendingStatus.dataset.state = pending.status === 'uncertain' ? 'uncertain' : 'review';
    setText(ui.pendingDetail, detail);
    const managerStates = {
      not_requested: 'Manager approval not requested.',
      pending: 'Manager approval pending.',
      not_required: 'Manager approval not required.',
      unsupported_currency: 'Manager approval policy cannot be evaluated for this currency.',
    };
    setText(ui.managerStatus, managerStates[pending.managerApproval?.status] || 'Manager approval status not returned.');
    let hint = '';
    if (pending.status === 'awaiting_approval') {
      if (state.approvalRequestId === pending.id) hint = 'Confirmation was attempted for this request. Check its status in chat before making a new request.';
      else if (!reviewComplete(pending)) hint = 'The review is incomplete. Ask the agent to prepare a fresh review.';
      else if (!Number.isFinite(expiryTime(pending))) hint = 'No valid expiry was returned. Ask the agent for a fresh review.';
      else if (expiredHere) hint = 'This review can no longer be confirmed.';
      else if (state.session?.busy || state.request) hint = 'Wait for the agent to finish before confirming.';
      else if (state.syncing || state.recoveryNeeded) hint = 'The latest conversation state must be checked before confirming.';
      else if (state.status?.ready !== true || state.statusError) hint = 'Reconnect to the gateway before confirming.';
      else if (state.injectSilentBug) hint = 'Confirm only to run this approval-failure simulation.';
      else if (pending.managerApproval?.status === 'not_requested') hint = 'Your confirmation is not manager approval. This fare will wait for separate approval.';
      else hint = 'Confirm to submit this booking request.';
    } else if (awaitingManagerApproval()) {
      hint = state.injectSilentBug
        ? 'Simulation only: this submits the request without the required approval.'
        : 'Manager approval is pending. No reservation has been placed.';
    }
    setText(ui.approvalHint, hint);
    ui.approvalHint.hidden = !hint;
  }

  function renderTrip() {
    const pending = state.session?.pending || null;
    const booking = state.session?.booking || null;
    const offers = state.session?.offers || [];
    const completed = booking?.verified === true && pending?.status === 'completed';

    ui.pending.hidden = !pending || completed;
    ui.booking.hidden = !booking;
    ui.offersSection.hidden = offers.length === 0 || completed;
    setText(ui.tripLink, pending?.status === 'awaiting_approval' ? 'Review booking' : 'Review trip');

    const nextPending = JSON.stringify(pending);
    if (nextPending !== pendingSignature) {
      pendingSignature = nextPending;
      ui.pendingOffer.replaceChildren();
      ui.passenger.replaceChildren();
      if (pending) {
        ui.pendingOffer.append(flightSummary(pending.offer));
        fillDetails(ui.passenger, [['Traveler', fullName(pending.passenger)], ['Request ID', pending.id]]);
        const expires = expiryTime(pending);
        setText(ui.expiry, Number.isFinite(expires)
          ? `Review expires ${new Date(expires).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'long' })}`
          : 'Review expiry not returned.');
        ui.expiry.title = text(pending.expiresAt, '');
      }
    }

    const selectedId = pending?.status === 'awaiting_approval' ? pending.offer?.id : state.selectedOfferId;
    const nextOffers = JSON.stringify([offers, selectedId]);
    if (nextOffers !== offersSignature) {
      offersSignature = nextOffers;
      ui.offers.replaceChildren();
      setText(ui.offersCount, `${offers.length} ${offers.length === 1 ? 'option' : 'options'}`);
      for (const offer of offers) {
        const row = element('li', 'offer');
        row.append(flightSummary(offer));
        const actions = element('div', 'offer-actions');
        const selected = hasValue(offer?.id) && offer.id === selectedId;
        actions.append(element('span', 'offer-selection', selected ? 'Chosen for review' : ''));
        const choose = element('button', 'button button-secondary', 'Choose');
        choose.type = 'button';
        choose.dataset.offerId = text(offer?.id, '');
        choose.dataset.selected = String(selected);
        choose.setAttribute('aria-label', `Choose offer ${text(offer?.id)}, ${text(offer?.flightNumber)} from ${text(offer?.origin)} to ${text(offer?.destination)}`);
        choose.addEventListener('click', () => {
          if (!canSend() || blockedOfferChoice() || !hasValue(offer?.id) || selected) return;
          void sendMessage(`I would like to review offer ${text(offer.id)}. Ask for first and last name if needed. Do not book it yet.`, { offerId: offer.id });
        });
        actions.append(choose);
        row.append(actions);
        ui.offers.append(row);
      }
    }

    const nextBooking = JSON.stringify(booking);
    if (nextBooking !== bookingSignature) {
      bookingSignature = nextBooking;
      ui.bookingDetails.replaceChildren();
      if (booking) {
        const verified = booking.verified === true;
        setText(ui.bookingTitle, verified ? 'Demo reservation' : 'Reservation reported');
        setText(ui.bookingVerification, verified ? 'Verified' : 'Unverified');
        ui.bookingVerification.dataset.state = verified ? 'verified' : 'uncertain';
        setText(ui.bookingNote, verified
          ? 'The gateway verified this reservation with the travel service.'
          : 'Verification is not confirmed. Ask the agent to check this reservation before making another request.');
        fillDetails(ui.bookingDetails, [
          ['Booking ID', booking.bookingId], ['Confirmation', booking.confirmationNumber],
          ['Status', booking.status], ['Payment status', booking.paymentStatus],
          ['Traveler', fullName(booking.passenger)], ['Flight', booking.flightInfo?.flightNumber],
          ['From', booking.flightInfo?.departureAirport], ['To', booking.flightInfo?.arrivalAirport],
          ['Departs', booking.flightInfo?.departureTime], ['Arrives', booking.flightInfo?.arrivalTime],
          ['Amount', money(booking.amount, booking.currency)],
        ]);
      }
    }
    const skipped = pending?.status === 'completed' && Boolean(booking) &&
      (booking.demoFault?.kind === 'skip_manager_approval' || pending.demoFault?.kind === 'skip_manager_approval');
    ui.skippedReceipt.hidden = !skipped;
    renderTripControls();
  }

  function scheduleExpiry() {
    window.clearTimeout(expiryTimer);
    const pending = state.session?.pending;
    const remaining = expiryTime(pending) - Date.now();
    if (pending?.status === 'awaiting_approval' && remaining > 0) {
      expiryTimer = window.setTimeout(() => {
        renderTripControls();
        if (expiryTime(state.session?.pending) <= Date.now()) announce('The review window has ended. Ask the agent for a fresh review.');
        else scheduleExpiry();
      }, Math.min(remaining + 25, 2147483647));
    }
  }

  function render() {
    renderStatus();

    renderControls();
    renderErrors();
    renderMessages();
    renderTrip();
  }

  function validateSession(result, id) {
    if (!result || result.id !== id || typeof result.busy !== 'boolean' ||
      !Array.isArray(result.messages) || !Array.isArray(result.offers) ||
      !result.messages.every((message) => message && typeof message.id === 'string' &&
        ['user', 'assistant'].includes(message.role) && typeof message.text === 'string')) {
      throw new ApiError('The gateway returned an invalid conversation response.');
    }
    return result;
  }

  function forgetSession(notice = '') {
    generation += 1;
    window.clearTimeout(sessionTimer);
    window.clearTimeout(expiryTimer);
    state.sessionId = null;
    state.session = null;
    state.syncing = false;
    state.restoring = false;
    state.request = '';
    state.recoveryNeeded = false;
    state.error = '';
    state.errorKind = '';
    state.dismissedServerError = '';
    state.selectedOfferId = null;
    state.approvalRequestId = null;
    state.injectSilentBug = false;
    state.bugAttemptKey = null;
    state.followOutput = true;
    state.notice = notice;
    storeSession(null);
    ui.latest.hidden = true;
  }

  async function refreshSession() {
    if (!state.sessionId || state.syncing) return false;
    const id = state.sessionId;
    const version = generation;
    window.clearTimeout(sessionTimer);
    state.syncing = true;
    renderControls();
    let loaded = false;
    try {
      const result = validateSession(await api(sessionPath(id)), id);
      if (version !== generation || id !== state.sessionId) return false;
      const wasBusy = state.session?.busy === true;
      const previousPendingId = state.session?.pending?.id;
      const wasVerified = state.session?.booking?.verified === true;
      state.session = result;
      scheduleExpiry();
      state.recoveryNeeded = false;
      if (state.errorKind === 'sync') { state.error = ''; state.errorKind = ''; }
      if (wasBusy && !result.busy) announce('The conversation has been updated.');
      if (result.pending?.status === 'awaiting_approval' && result.pending.id !== previousPendingId) {
        announce('A booking review is ready in the trip panel. Review it before confirming.');
      }
      if (result.booking?.verified === true && !wasVerified) announce('The reservation is verified. Payment remains pending; no ticket was issued.');
      loaded = true;
    } catch (error) {
      if (version !== generation || id !== state.sessionId) return false;
      if (error.status === 404) {
        forgetSession('This conversation is no longer available. Send a message to start a new one.');
        announce(state.notice);
      } else {
        if (!state.error || state.errorKind === 'sync') {
          state.error = `${error.message} The displayed conversation may be out of date. Retrying the read automatically.`;
          state.errorKind = 'sync';
        }
        state.recoveryNeeded = true;
        void checkStatus();
      }
    } finally {
      if (version === generation && id === state.sessionId) {
        state.syncing = false;
        state.restoring = false;
        if (state.session?.busy || state.recoveryNeeded) {
          sessionTimer = window.setTimeout(refreshSession, state.recoveryNeeded ? 3000 : 1000);
        }
      }
      render();
    }
    return loaded;
  }

  function sizeInput() {
    ui.input.style.height = 'auto';
    ui.input.style.height = `${Math.min(ui.input.scrollHeight, 220)}px`;
  }

  async function sendMessage(message, { clearDraft = false, offerId = null } = {}) {
    if (typeof message !== 'string' || !message.trim() || !canSend()) return;
    const version = generation;
    const focusAfter = document.activeElement === ui.send || document.activeElement === ui.input || offerId !== null;
    state.request = 'message';
    state.error = '';
    state.errorKind = '';
    state.dismissedServerError = state.session?.lastError || '';
    state.notice = '';
    state.followOutput = true;
    render();
    let attemptedMessage = false;
    try {
      if (!state.sessionId) {
        const created = await api('/api/sessions', 'POST', { provider: state.modelProvider, model: state.modelId });
        if (!created || typeof created.id !== 'string' || !created.id) throw new ApiError('The gateway did not return a valid session ID.');
        if (version !== generation) return;
        state.sessionId = created.id;
        storeSession(created.id);
      }
      attemptedMessage = true;
      await api(`${sessionPath()}/messages`, 'POST', { text: message });
      if (version !== generation) return;
      if (clearDraft && ui.input.value === message) { ui.input.value = ''; sizeInput(); }
      if (offerId !== null) state.selectedOfferId = offerId;
      await refreshSession();
    } catch (error) {
      if (version !== generation) return;
      const uncertain = attemptedMessage && !(error.status >= 400 && error.status < 500);
      state.error = `${error.message}${uncertain ? ' Message delivery is uncertain. Check the refreshed conversation before sending it again; it will not be retried automatically.' : ''}`;
      state.errorKind = 'message';
      if (state.sessionId) await refreshSession();
    } finally {
      if (version === generation) {
        state.request = '';
        render();
        if (focusAfter && (document.activeElement === ui.send || document.activeElement === ui.input || offerId !== null)) ui.input.focus();
      }
    }
  }

  async function sessionAction(action, endpoint, body, acceptedNotice) {
    if (!state.sessionId || state.request) return;
    const version = generation;
    const id = state.sessionId;
    state.request = action;
    state.error = '';
    state.errorKind = '';
    state.dismissedServerError = state.session?.lastError || '';
    state.notice = '';
    render();
    try {
      await api(`${sessionPath(id)}/${endpoint}`, 'POST', body);
      if (version !== generation) return;
      state.notice = acceptedNotice;
      await refreshSession();
    } catch (error) {
      if (version !== generation) return;
      const uncertain = !(error.status >= 400 && error.status < 500);
      state.error = `${error.message}${uncertain ? ' The action may have reached the gateway. Check the refreshed state; it will not be retried automatically.' : ''}`;
      state.errorKind = action;
      await refreshSession();
    } finally {
      if (version === generation) { state.request = ''; render(); }
    }
  }

  function newConversation() {
    if (state.session?.busy || state.request || state.syncing) return;
    forgetSession();
    ui.input.value = '';
    sizeInput();
    render();
    announce('New conversation. A session will be created only when you send a message.');
    ui.input.focus();
  }

  async function checkStatus() {
    if (state.statusChecking) return;
    window.clearTimeout(statusTimer);
    state.statusChecking = true;
    renderStatus();
    try {
      const result = await api('/api/status');
      if (!result || typeof result.ready !== 'boolean') throw new ApiError('The gateway returned an invalid status response.');
      state.status = result;
      state.statusError = '';
      if (result.ready && state.sessionId && state.restoring && !state.session && !state.syncing) void refreshSession();
    } catch (error) {
      state.statusError = error.message;
    } finally {
      state.statusChecking = false;
      render();
      if (state.status?.ready !== true || state.statusError) statusTimer = window.setTimeout(checkStatus, 3000);
    }
  }

  ui.retryConnection.addEventListener('click', checkStatus);
  ui.provider.addEventListener('change', () => {
    const selected = state.status?.providers?.find(item => item.id === ui.provider.value);
    state.modelProvider = ui.provider.value;
    state.modelId = selected?.defaultModel ?? '';
    storeModel();
    render();
  });
  ui.modelInput.addEventListener('change', () => {
    state.modelId = ui.modelInput.value.trim();
    storeModel();
    render();
  });
  ui.modelInput.addEventListener('input', () => { state.modelId = ui.modelInput.value; storeModel(); renderControls(); });
  ui.newConversation.addEventListener('click', newConversation);
  ui.retrySession.addEventListener('click', () => { void refreshSession(); });
  ui.dismissError.addEventListener('click', () => {
    state.error = '';
    state.errorKind = '';
    state.dismissedServerError = state.session?.lastError || '';
    renderErrors();
    ui.input.focus();
  });
  ui.composer.addEventListener('submit', (event) => {
    event.preventDefault();
    void sendMessage(ui.input.value, { clearDraft: true });
  });
  ui.input.addEventListener('input', () => { sizeInput(); renderControls(); });
  ui.input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
      event.preventDefault();
      ui.composer.requestSubmit();
    }
  });
  ui.stop.addEventListener('click', () => {
    if (state.session?.busy !== true || state.request || state.syncing) return;
    void sessionAction('abort', 'abort', {}, 'Stop requested. This does not cancel an existing reservation; any submitted request may still need verification.');
  });
  ui.injectBug.addEventListener('click', () => {
    if (!canInjectBug() || ui.bugDialog.open) return;
    state.bugDialogKey = bugReviewKey();
    ui.bugDialog.showModal();
  });
  ui.bugDialog.addEventListener('close', () => {
    state.bugDialogKey = null;
    if (!ui.injectBug.disabled) ui.injectBug.focus();
  });
  ui.bugCancel.addEventListener('click', () => ui.bugDialog.close());
  ui.bugEnable.addEventListener('click', () => {
    if (!ui.bugDialog.open || state.bugDialogKey !== bugReviewKey() || !canInjectBug()) return;
    state.injectSilentBug = true;
    ui.bugDialog.close();
    renderTripControls();
  });
  ui.bugDisable.addEventListener('click', () => {
    if (!canInjectBug()) return;
    state.injectSilentBug = false;
    renderTripControls();
    ui.injectBug.focus();
  });
  ui.approve.addEventListener('click', () => {
    if (!canApprove() && !canContinueWithBug()) return;
    const requestId = state.session.pending.id;
    const injectSilentBug = state.injectSilentBug;
    state.approvalRequestId = requestId;
    if (injectSilentBug) state.bugAttemptKey = bugReviewKey();
    void sessionAction('approve', 'approve', { requestId, injectSilentBug }, 'Confirmation sent. Checking the approval and booking status; do not submit this request again.');
  });
  ui.cancel.addEventListener('click', () => {
    if (!canDiscard()) return;
    void sessionAction('cancel', 'cancel-booking', { requestId: state.session.pending.id }, 'The discard request was sent. This only invalidates the review; it does not cancel an existing reservation.');
  });
  ui.scroll.addEventListener('scroll', () => {
    state.followOutput = ui.scroll.scrollHeight - ui.scroll.scrollTop - ui.scroll.clientHeight < 80;
    if (state.followOutput) ui.latest.hidden = true;
  }, { passive: true });
  ui.latest.addEventListener('click', () => {
    state.followOutput = true;
    ui.scroll.scrollTop = ui.scroll.scrollHeight;
    ui.latest.hidden = true;
    ui.scroll.focus();
  });
  window.addEventListener('online', () => { void checkStatus(); });
  window.addEventListener('offline', () => {
    state.statusError = 'The browser is offline.';
    render();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void checkStatus();
      if (state.sessionId && !state.request) void refreshSession();
    }
  });
  window.addEventListener('pagehide', () => {
    window.clearTimeout(statusTimer);
    window.clearTimeout(sessionTimer);
    window.clearTimeout(expiryTimer);
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      void checkStatus();
      if (state.sessionId) void refreshSession();
    }
  });
  render();
  void checkStatus();
})();
