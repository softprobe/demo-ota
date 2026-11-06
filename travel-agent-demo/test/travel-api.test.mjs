import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TravelAPI } from '../src/travel-api.mjs';
const flight = { flightId: 'fixture-flight', airlineName: 'Fixture Airline', flightNumber: 'XX101', departureAirport: 'LHR', arrivalAirport: 'CDG', departureTime: '2026-11-05T14:21:00', arrivalTime: '2026-11-05T15:56:00', fareOptions: [{ fareId: 'fixture-fare', price: 123, currency: 'USD', cabinClass: 'ECONOMY', fareBrand: 'Basic' }] };
const json = data => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });

test('search uses the deployed JSON contract and retains only real returned offer identifiers', async () => {
  const calls = [];
  const api = new TravelAPI({ now: () => new Date('2026-10-29T12:00:00Z'), fetchFn: async (url, options) => { calls.push({ url, options }); return json({ flights: [flight] }); } });
  const offers = await api.search({ origin: 'LHR', destination: 'CDG', date: '2026-11-05' });
  assert.equal(calls[0].url, 'http://127.0.0.1:8080/api/flights/search');
  assert.deepEqual(JSON.parse(calls[0].options.body), { fromCity: 'LHR', toCity: 'CDG', departureDate: '2026-11-05', tripType: 'ONE_WAY', cabinClass: 'ECONOMY', passengerInfo: { adults: 1, children: 0, infants: 0 } });
  assert.equal(offers[0].flightId, flight.flightId);
  assert.equal(offers[0].fareId, flight.fareOptions[0].fareId);
  assert.equal(offers[0].total, 123);
  await assert.rejects(() => api.search({ origin: 'LHR', destination: 'LHR', date: '2026-11-05' }), /different/i);
  await assert.rejects(() => api.search({ origin: 'LHR', destination: 'CDG', date: '2026-02-31' }), /date/i);
  assert.equal(calls.length, 1);
});

const selected = { id: 'fixture-flight:fixture-fare', flightId: 'fixture-flight', fareId: 'fixture-fare', origin: 'LHR', destination: 'CDG', date: '2026-11-05', departureTime: flight.departureTime, arrivalTime: flight.arrivalTime, flightNumber: 'XX101', total: 123, currency: 'USD', cabinClass: 'ECONOMY' };
const request = { offer: selected, passenger: { firstName: 'Alex', lastName: 'Demo' } };
const booking = { bookingId: 'fixture-booking', confirmationNumber: 'ABC123', status: 'CONFIRMED', flightInfo: { flightId: selected.flightId, flightNumber: selected.flightNumber, departureAirport: 'LHR', arrivalAirport: 'CDG', departureTime: flight.departureTime, arrivalTime: flight.arrivalTime, cabinClass: 'ECONOMY' }, passengers: [{ firstName: 'Alex', lastName: 'Demo', passengerType: 'ADULT' }], paymentInfo: { amount: 123, currency: 'USD', paymentStatus: 'PENDING' } };

test('booking uses synthetic fields and is verified by independent order read-back, without paying', async () => {
  const calls = [];
  const api = new TravelAPI({ fetchFn: async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); return json(booking); } });
  const result = await api.bookAndVerify(request);
  assert.equal(result.verified, true);
  assert.equal(result.paymentStatus, 'PENDING');
  assert.equal(result.confirmationNumber, 'ABC123');
  assert.deepEqual(calls.map(call => new URL(call.url).pathname), ['/api/flights/book', '/api/flights/orders/query']);
  assert.equal(calls[0].body.flightId, selected.flightId);
  assert.equal(calls[0].body.fareId, selected.fareId);
  assert.equal(calls[0].body.passengers[0].nationality, 'US');
  assert.match(calls[0].body.passengers[0].documentNumber, /^DEMO/);
  assert.match(calls[0].body.contactInfo.email, /@example\.com$/);
  assert.deepEqual(calls[1].body, { confirmationNumber: 'ABC123', passengerLastName: 'Demo' });
});

test('CONFIRMED with wrong flight or zero amount is unverified; never retries the booking', async () => {
  let calls = 0;
  const api = new TravelAPI({ fetchFn: async () => { calls += 1; return json({ ...booking, flightInfo: null, paymentInfo: { amount: 0, currency: 'USD', paymentStatus: 'PENDING' } }); } });
  await assert.rejects(() => api.bookAndVerify(request), error => error.confirmationNumber === 'ABC123' && /verif/i.test(error.message));
  assert.equal(calls, 1);
});

test('mismatched independent read-back prevents a success claim and preserves the known reference', async () => {
  let calls = 0;
  const api = new TravelAPI({ fetchFn: async () => json(++calls === 1 ? booking : { ...booking, paymentInfo: { amount: 999, currency: 'USD', paymentStatus: 'PENDING' } }) });
  await assert.rejects(() => api.bookAndVerify(request), error => error.confirmationNumber === 'ABC123' && error.result.verified === false);
  assert.equal(calls, 2);
});

test('verification rejects a supplied conflicting fare ID or non-adult passenger', async () => {
  for (const invalid of [
    { ...booking, flightInfo: { ...booking.flightInfo, fareId: 'unapproved-fare' } },
    { ...booking, passengers: [{ ...booking.passengers[0], passengerType: 'CHILD' }] },
  ]) {
    const api = new TravelAPI({ fetchFn: async () => json(invalid) });
    await assert.rejects(() => api.bookAndVerify(request), /verification failed/);
  }
});
