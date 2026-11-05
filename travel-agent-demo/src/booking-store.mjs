import { randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { managerApprovalFor } from './travel-policy.mjs';

const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const isRecord = value => value !== null && typeof value === 'object'
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exactKeys = (value, keys) => isRecord(value)
  && Reflect.ownKeys(value).length === keys.length
  && keys.every(key => Object.hasOwn(value, key));
// Keep synthetic names within the upstream ASCII/10-character contract.
const validName = value => typeof value === 'string' && value === value.trim()
  && /^[A-Za-z][A-Za-z' -]{0,9}$/.test(value);
const validPassenger = value => exactKeys(value, ['firstName', 'lastName'])
  && validName(value.firstName) && validName(value.lastName);
const validText = value => typeof value === 'string' && value.length > 0 && value.length <= 512
  && value === value.trim() && !/[\p{Cc}\p{Cf}<>]/u.test(value);
const validOffer = value => isRecord(value)
  && ['id', 'flightId', 'fareId', 'origin', 'destination', 'date', 'flightNumber', 'departureTime', 'arrivalTime', 'cabinClass', 'airlineName'].every(key => validText(value[key]))
  && /^[A-Z]{3}$/.test(value.origin) && /^[A-Z]{3}$/.test(value.destination) && value.origin !== value.destination
  && /^\d{4}-\d{2}-\d{2}$/.test(value.date) && value.departureTime.startsWith(`${value.date}T`)
  && Number.isFinite(value.total) && value.total > 0 && /^[A-Z]{3}$/.test(value.currency);
const validOffers = value => Array.isArray(value) && value.every(validOffer)
  && new Set(value.map(offer => offer.id)).size === value.length;
const validTimestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
function validManagerApproval(approval, offer) {
  if (!exactKeys(approval, ['policyId', 'ruleId', 'policyVersion', 'threshold', 'currency', 'status', 'requestedAt'])) return false;
  const initial = managerApprovalFor(offer);
  if (!['policyId', 'ruleId', 'policyVersion', 'threshold', 'currency'].every(key => approval[key] === initial[key])) return false;
  return initial.status === 'not_requested'
    ? (approval.status === 'not_requested' && approval.requestedAt === null) || (approval.status === 'pending' && validTimestamp(approval.requestedAt))
    : approval.status === initial.status && approval.requestedAt === null;
}
const validJSON = value => value === null || typeof value === 'string' || typeof value === 'boolean'
  || (typeof value === 'number' && Number.isFinite(value))
  || (Array.isArray(value) && value.every(validJSON))
  || (isRecord(value) && Object.values(value).every(item => item === undefined || validJSON(item)));

function cloneJSON(value) {
  const copy = structuredClone(value);
  const encoded = JSON.stringify(copy); // Also rejects cycles before recursive validation.
  if (!validJSON(copy)) throw fail(409, 'Booking data must contain only finite JSON values.');
  return JSON.parse(encoded);
}

function partialResult(error, returned) {
  const source = isRecord(error?.result) ? error.result : isRecord(returned) ? returned : {};
  const partial = Object.fromEntries(Object.entries(source).flatMap(([key, value]) => {
    try { return [[key, cloneJSON(value)]]; } catch { return []; }
  }));
  if (validText(error?.confirmationNumber) && !partial.confirmationNumber) partial.confirmationNumber = error.confirmationNumber;
  return Object.keys(partial).length ? { ...partial, verified: false } : undefined;
}

function loadSnapshot(data) {
  const check = condition => { if (!condition) throw new Error('Invalid booking store state; refusing to discard it.'); };
  check(exactKeys(data, ['version', 'sessions']) && data.version === 1 && Array.isArray(data.sessions) && validJSON(data));
  const sessionIds = new Set();
  const requestIds = new Set();
  for (const entry of data.sessions) {
    check(Array.isArray(entry) && entry.length === 2);
    const [sessionId, session] = entry;
    check(validText(sessionId) && !sessionIds.has(sessionId) && isRecord(session));
    sessionIds.add(sessionId);
    check(exactKeys(session, ['offers', ...(Object.hasOwn(session, 'pending') ? ['pending'] : [])]) && validOffers(session.offers));
    if (!Object.hasOwn(session, 'pending')) continue;
    const request = session.pending;
    check(isRecord(request));
    const hasResult = Object.hasOwn(request, 'result');
    check(exactKeys(request, ['id', 'status', 'offer', 'passenger', 'expiresAt', ...(hasResult ? ['result'] : []), ...(Object.hasOwn(request, 'managerApproval') ? ['managerApproval'] : []), ...(Object.hasOwn(request, 'demoFault') ? ['demoFault'] : [])]));
    check(typeof request.id === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(request.id)
      && !requestIds.has(request.id));
    requestIds.add(request.id);
    check(['awaiting_approval', 'approved', 'submitting', 'completed', 'uncertain', 'expired', 'cancelled'].includes(request.status)
      && validOffer(request.offer) && validPassenger(request.passenger)
      && Number.isSafeInteger(request.expiresAt) && request.expiresAt >= 0);
    if (Object.hasOwn(request, 'managerApproval')) check(validManagerApproval(request.managerApproval, request.offer));
    if (Object.hasOwn(request, 'demoFault')) {
      check(exactKeys(request.demoFault, ['kind', 'enabledAt']) && request.demoFault.kind === 'skip_manager_approval'
        && validTimestamp(request.demoFault.enabledAt) && request.offer.currency === 'USD' && request.offer.total > 600
        && validManagerApproval(request.managerApproval, request.offer));
    }
    if (['awaiting_approval', 'approved'].includes(request.status)) {
      check(session.offers.some(offer => isDeepStrictEqual(offer, request.offer)));
    }
    if (hasResult) {
      check(['submitting', 'completed', 'uncertain'].includes(request.status) && isRecord(request.result));
      if (request.status === 'uncertain') check(request.result.verified === false);
    }
    if (request.status === 'completed') {
      check(hasResult && matchesBooking(request.result, request));
      if (request.demoFault) {
        check(isDeepStrictEqual(request.result.managerApproval, request.managerApproval)
          && isDeepStrictEqual(request.result.demoFault, request.demoFault));
      }
    }
  }
  return new Map(data.sessions);
}

function matchesBooking(result, request) {
  const { offer, passenger } = request;
  const flight = result?.flightInfo;
  return isRecord(result) && result.verified === true
    && validText(result.bookingId)
    && typeof result.confirmationNumber === 'string' && /^[A-Z0-9]{6}$/.test(result.confirmationNumber)
    && result.status === 'CONFIRMED' && result.paymentStatus === 'PENDING'
    && result.amount === offer.total && result.currency === offer.currency
    && validPassenger(result.passenger)
    && result.passenger.firstName === passenger.firstName && result.passenger.lastName === passenger.lastName
    && flight?.flightId === offer.flightId && flight?.flightNumber === offer.flightNumber
    && flight?.departureAirport === offer.origin && flight?.arrivalAirport === offer.destination
    && flight?.departureTime === offer.departureTime && flight?.arrivalTime === offer.arrivalTime
    && flight?.cabinClass === offer.cabinClass
    && (flight.fareId === undefined || flight.fareId === offer.fareId)
    && (flight.airlineName === undefined || flight.airlineName === offer.airlineName)
    && ['confirmationNumber', 'bookingId'].every(key => request.result?.[key] == null || request.result[key] === result[key]);
}

/**
 * One booking per conversation, one live writer per optional snapshot file.
 * Pending: { id, status, offer, passenger, expiresAt, result? }; reads return copies.
 * New searches cancel unsubmitted approvals. Only awaiting/approved states expire.
 * submit() persists its barrier before calling the trusted booking/verification adapter.
 * Any ambiguous outcome is non-retryable; completeReadBack() returns a verified result,
 * matching the approved identity and every known reference, without making a booking.
 * Snapshots use file fsync + same-directory atomic rename, not distributed locking.
 */
export class BookingStore {
  #sessions;
  #now;
  #ttlMs;
  #filePath;

  constructor(options = {}) {
    if (!isRecord(options) || !Reflect.ownKeys(options).every(key => ['filePath', 'now', 'ttlMs'].includes(key))) {
      throw fail(400, 'BookingStore accepts only filePath, now and ttlMs options.');
    }
    const { filePath, now = Date.now, ttlMs = 15 * 60 * 1_000 } = options;
    if (typeof now !== 'function' || !Number.isSafeInteger(ttlMs) || ttlMs <= 0
      || (filePath !== undefined && (typeof filePath !== 'string' || !filePath || filePath.includes('\0')))) {
      throw fail(400, 'Use a file path, a clock function and a positive integer TTL.');
    }
    this.#now = now;
    this.#ttlMs = ttlMs;
    this.#time();
    this.#filePath = filePath === undefined ? undefined : resolve(filePath);
    this.#sessions = new Map();
    if (this.#filePath) {
      let data;
      try {
        data = readFileSync(this.#filePath, 'utf8');
      } catch (error) {
        if (error.code === 'ENOENT') return;
        throw error;
      }
      this.#sessions = loadSnapshot(JSON.parse(data));
      let changed = false;
      for (const session of this.#sessions.values()) {
        const request = session.pending;
        if (request?.status === 'submitting') {
          request.status = 'uncertain';
          if (request.result) request.result.verified = false;
          changed = true;
        } else if (request && ['awaiting_approval', 'approved'].includes(request.status) && this.#time() >= request.expiresAt) {
          request.status = 'expired';
          changed = true;
        }
      }
      if (changed) this.#persist(this.#sessions);
    }
  }

  #time() {
    const time = this.#now();
    if (!Number.isSafeInteger(time) || time < 0 || !Number.isSafeInteger(time + this.#ttlMs)) {
      throw fail(400, 'The clock must return a finite nonnegative millisecond timestamp.');
    }
    return time;
  }

  #persist(sessions) {
    if (!this.#filePath) return;
    const data = JSON.stringify({ version: 1, sessions: [...sessions] });
    const directory = dirname(this.#filePath);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temporary = join(directory, `.${basename(this.#filePath)}.${randomUUID()}.tmp`);
    let fd;
    try {
      fd = openSync(temporary, 'wx', 0o600);
      writeFileSync(fd, data, 'utf8');
      fsyncSync(fd);
      closeSync(fd);
      fd = undefined;
      renameSync(temporary, this.#filePath);
    } finally {
      if (fd !== undefined) closeSync(fd);
      rmSync(temporary, { force: true });
    }
  }

  #commit(sessionId, session) {
    const next = new Map(this.#sessions);
    next.set(sessionId, session);
    this.#persist(next);
    this.#sessions = next;
  }

  #setPending(sessionId, pending) {
    this.#commit(sessionId, { ...this.#sessions.get(sessionId), pending });
  }

  setOffers(sessionId, offers) {
    if (!validText(sessionId)) throw fail(400, 'A nonempty session ID is required.');
    let copy;
    try {
      copy = cloneJSON(offers);
      if (!validOffers(copy)) throw new Error('Invalid offers');
    } catch {
      throw fail(400, 'Search must supply valid JSON offers with unique IDs.');
    }
    const session = { ...this.#sessions.get(sessionId), offers: copy };
    if (['awaiting_approval', 'approved'].includes(session.pending?.status)) {
      session.pending = { ...session.pending, status: this.#time() >= session.pending.expiresAt ? 'expired' : 'cancelled' };
    }
    this.#commit(sessionId, session);
  }

  getOffers(sessionId) {
    return structuredClone(this.#sessions.get(sessionId)?.offers ?? []);
  }

  prepare(sessionId, input) {
    if (!exactKeys(input, ['offerId', 'passenger']) || !validPassenger(input.passenger)
      || typeof input.offerId !== 'string' || !input.offerId) {
      throw fail(400, 'Provide only an offerId and synthetic firstName/lastName of 1–10 safe characters each.');
    }
    const { offerId, passenger } = input;
    const session = this.#sessions.get(sessionId);
    if (['submitting', 'completed', 'uncertain'].includes(session?.pending?.status)) {
      throw fail(409, 'This conversation already has a submitted booking request.');
    }
    const offer = session?.offers.find(item => item.id === offerId);
    if (!offer) throw fail(404, 'Choose an offer returned by this session’s search.');
    const pending = {
      id: randomUUID(), status: 'awaiting_approval', offer: structuredClone(offer),
      passenger: structuredClone(passenger), expiresAt: this.#time() + this.#ttlMs,
      managerApproval: managerApprovalFor(offer),
    };
    this.#setPending(sessionId, pending);
    return structuredClone(pending);
  }

  getPending(sessionId) {
    return structuredClone(this.#pending(sessionId));
  }

  getBooking(sessionId) {
    return structuredClone(this.#pending(sessionId)?.result ?? null);
  }

  #pending(sessionId) {
    let request = this.#sessions.get(sessionId)?.pending ?? null;
    if (request && ['awaiting_approval', 'approved'].includes(request.status) && this.#time() >= request.expiresAt) {
      request = { ...request, status: 'expired' };
      this.#setPending(sessionId, request);
    }
    return request;
  }

  #request(sessionId, requestId) {
    const request = this.#sessions.get(sessionId)?.pending;
    if (!request || request.id !== requestId) throw fail(404, 'Booking request not found in this session.');
    return this.#pending(sessionId);
  }

  approve(sessionId, requestId, options) {
    const request = this.#request(sessionId, requestId);
    if (options !== undefined && (!exactKeys(options, ['injectSilentBug']) || typeof options.injectSilentBug !== 'boolean')) throw fail(400, 'An explicit boolean injection flag is required.');
    const inject = options?.injectSilentBug ?? Boolean(request.demoFault);
    const waiting = request.status === 'approved' && request.managerApproval?.status === 'pending' && !request.demoFault;
    if (request.status !== 'awaiting_approval' && !(waiting && inject)) throw fail(409, 'This request is no longer awaiting approval.');
    if (inject && (request.offer.currency !== 'USD' || request.offer.total <= 600)) throw fail(409, 'This demo bug requires an active flight review above $600 USD.');
    const managerApproval = request.managerApproval ?? managerApprovalFor(request.offer);
    const approved = { ...request, status: 'approved', managerApproval: {
      ...managerApproval,
      ...(!inject && managerApproval.status === 'not_requested' ? { status: 'pending', requestedAt: new Date(this.#time()).toISOString() } : {}),
    } };
    if (inject) approved.demoFault = request.demoFault ?? { kind: 'skip_manager_approval', enabledAt: new Date(this.#time()).toISOString() };
    else delete approved.demoFault;
    this.#setPending(sessionId, approved);
    return structuredClone(approved);
  }

  enableSilentBug(sessionId, requestId) {
    const request = this.#request(sessionId, requestId);
    if (!['awaiting_approval', 'approved'].includes(request.status)
      || request.offer.currency !== 'USD' || request.offer.total <= 600) {
      throw fail(409, 'This demo bug requires an active flight review above $600 USD.');
    }
    const enabled = { ...request,
      managerApproval: request.managerApproval ?? managerApprovalFor(request.offer),
      demoFault: { kind: 'skip_manager_approval', enabledAt: new Date(this.#time()).toISOString() },
    };
    this.#setPending(sessionId, enabled);
    return structuredClone(enabled);
  }

  cancel(sessionId, requestId) {
    const request = this.#request(sessionId, requestId);
    if (!['awaiting_approval', 'approved', 'cancelled'].includes(request.status)) {
      throw fail(409, 'Only an unsubmitted request can be cancelled.');
    }
    const cancelled = { ...request, status: 'cancelled' };
    this.#setPending(sessionId, cancelled);
    return structuredClone(cancelled);
  }

  completeReadBack(sessionId, requestId, result) {
    const request = this.#request(sessionId, requestId);
    let copy;
    try { copy = cloneJSON(result); } catch { throw fail(409, 'Read-back must return a JSON booking result.'); }
    if (!['uncertain', 'completed'].includes(request.status) || !matchesBooking(copy, request)) {
      throw fail(409, 'Read-back must verify the exact pending booking and any known reference.');
    }
    if (request.status === 'completed') return structuredClone(request.result);
    if (request.demoFault?.kind === 'skip_manager_approval') {
      copy.managerApproval = structuredClone(request.managerApproval);
      copy.demoFault = structuredClone(request.demoFault);
    }
    this.#setPending(sessionId, { ...request, result: copy, status: 'completed' });
    return structuredClone(copy);
  }

  async submit(sessionId, requestId, book) {
    const request = this.#request(sessionId, requestId);
    if (request.status === 'completed') return structuredClone(request.result);
    if (request.status !== 'approved') throw fail(409, 'Explicit human approval is required before booking.');
    const managerApproval = request.managerApproval ?? managerApprovalFor(request.offer);
    const demoBypass = request.demoFault?.kind === 'skip_manager_approval'
      && request.offer.currency === 'USD' && request.offer.total > 600;
    if (managerApproval.status !== 'not_required' && !demoBypass) throw fail(409, 'Manager approval is required before booking. No reservation has been created.');
    if (typeof book !== 'function') throw fail(400, 'A booking callback is required.');
    const submitting = { ...request, status: 'submitting' };
    this.#setPending(sessionId, submitting);
    let result;
    try {
      result = await book(structuredClone(submitting));
      const savedResult = cloneJSON(result);
      if (!matchesBooking(savedResult, request)) throw fail(409, 'The booking callback did not return a verified result matching the approved request.');
      if (demoBypass) {
        savedResult.managerApproval = structuredClone(managerApproval);
        savedResult.demoFault = structuredClone(request.demoFault);
      }
      this.#setPending(sessionId, { ...submitting, result: savedResult, status: 'completed' });
      return structuredClone(savedResult);
    } catch (error) {
      const uncertain = { ...submitting, status: 'uncertain' };
      const partial = partialResult(error, result);
      if (partial) uncertain.result = partial;
      try {
        this.#setPending(sessionId, uncertain);
      } catch {
        // The durable pre-call barrier is still submitting, so restart also forbids retry.
        this.#sessions.set(sessionId, { ...this.#sessions.get(sessionId), pending: uncertain });
      }
      throw error;
    }
  }
}
