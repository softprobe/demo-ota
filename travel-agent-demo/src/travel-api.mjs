const AIRPORTS = new Set('LHR CDG FRA AMS MAD BCN FCO MXP ZRH VIE CPH ARN OSL HEL WAW PRG BUD ATH IST'.split(' '));
const TAX_RATE_BY_REGION = Object.freeze({ MEA: 0.08, EU: 0.20 });

export class TravelAPI {
  constructor({ baseUrl = 'http://127.0.0.1:8080', fetchFn = fetch, now = () => new Date(), salesRegion = process.env.TENANT_SALES_REGION ?? 'MEA' } = {}) {
    this.baseUrl = baseUrl;
    this.fetch = fetchFn;
    this.now = now;
    const region = typeof salesRegion === 'string' ? salesRegion.trim().toUpperCase() : 'MEA';
    this.taxRate = TAX_RATE_BY_REGION[region] ?? TAX_RATE_BY_REGION.MEA;
  }

  async post(path, body) {
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(25_000), redirect: 'error',
    });
    const text = await response.text();
    if (text.length > 1_000_000) throw new Error('Travel service response was too large.');
    let data;
    try { data = JSON.parse(text); } catch { throw new Error(`Travel service returned a non-JSON response (HTTP ${response.status}).`); }
    if (!response.ok) throw new Error(`Travel service HTTP ${response.status}: ${String(data.message ?? data.error ?? 'Request failed').slice(0, 300)}`);
    return data;
  }

  async search({ origin, destination, date }) {
    if (!AIRPORTS.has(origin) || !AIRPORTS.has(destination)) throw new Error('Use one of the supported European airport codes.');
    if (origin === destination) throw new Error('Origin and destination must be different.');
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date ?? '') ? new Date(`${date}T00:00:00Z`) : new Date(NaN);
    const today = this.now().toISOString().slice(0, 10);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date || date < today) throw new Error('Provide a valid future departure date in YYYY-MM-DD format.');
    const data = await this.post('/api/flights/search', {
      fromCity: origin, toCity: destination, departureDate: date,
      tripType: 'ONE_WAY', cabinClass: 'ECONOMY', passengerInfo: { adults: 1, children: 0, infants: 0 },
    });
    if (!Array.isArray(data.flights)) throw new Error('Travel search response did not contain flights.');
    const offers = data.flights.flatMap(flight => {
      if (!flight.flightId || flight.departureAirport !== origin || flight.arrivalAirport !== destination || !flight.departureTime?.startsWith(`${date}T`)) return [];
      const fare = (flight.fareOptions ?? []).filter(item => item.fareId && item.cabinClass === 'ECONOMY' && Number.isFinite(item.price) && item.price > 0 && /^[A-Z]{3}$/.test(item.currency)).sort((a, b) => a.price - b.price)[0];
      if (!fare) return [];
      return [{ id: `${flight.flightId}:${fare.fareId}`, flightId: flight.flightId, fareId: fare.fareId, airlineName: flight.airlineName, flightNumber: flight.flightNumber, origin, destination, date, departureTime: flight.departureTime, arrivalTime: flight.arrivalTime, total: fare.price, currency: fare.currency, cabinClass: fare.cabinClass, fareBrand: fare.fareBrand }];
    }).sort((a, b) => a.total - b.total).slice(0, 6);
    if (data.flights.length && !offers.length) throw new Error('Returned inventory did not match the requested route/date or supported fare conditions.');
    return offers;
  }

  validateBooking(data, request, expectedConfirmation, expectedBookingId, { paymentStatus = 'PENDING', paymentId = null } = {}) {
    const { offer, passenger } = request;
    const f = data?.flightInfo;
    const p = data?.paymentInfo;
    const traveler = data?.passengers?.[0];
    const returnedPaymentStatusValid = paymentStatus === 'ANY' ? ['PENDING', 'PAID'].includes(p?.paymentStatus) : p?.paymentStatus === paymentStatus;
    const returnedBookingStatusValid = p?.paymentStatus === 'PAID' ? ['TICKETED', 'CONFIRMED'].includes(data?.status) : data?.status === 'CONFIRMED';
    const returnedAmount = p?.amount;
    const amountMatchesApprovedFare = Number.isFinite(returnedAmount) && returnedAmount > 0 && (
      Math.round(returnedAmount * 100) === Math.round(offer.total * 100)
      // OTA search adds the configured sales-region tax; the airline order API returns its pre-tax amount.
      || (p?.paymentStatus === 'PENDING' && Math.round(returnedAmount * (1 + this.taxRate) * 100) === Math.round(offer.total * 100))
    );
    const valid = typeof data?.bookingId === 'string' && data.bookingId.length > 0 && /^[A-Z0-9]{6}$/.test(data.confirmationNumber ?? '')
      && (!expectedConfirmation || data.confirmationNumber === expectedConfirmation)
      && (!expectedBookingId || data.bookingId === expectedBookingId)
      && returnedBookingStatusValid
      && f?.flightId === offer.flightId && f?.flightNumber === offer.flightNumber
      && (f?.fareId === undefined || f.fareId === offer.fareId) && (data.fareId === undefined || data.fareId === offer.fareId)
      && f?.departureAirport === offer.origin && f?.arrivalAirport === offer.destination
      && f?.departureTime === offer.departureTime && f?.arrivalTime === offer.arrivalTime
      && f?.cabinClass === offer.cabinClass && p?.currency === offer.currency && returnedPaymentStatusValid
      && (!paymentId || p?.paymentId === paymentId)
      && amountMatchesApprovedFare
      && data.passengers?.length === 1 && traveler?.passengerType === 'ADULT' && traveler?.firstName === passenger.firstName && traveler?.lastName === passenger.lastName;
    if (!valid) throw new Error('Booking verification failed: returned flight, traveler, price, currency, or payment state does not match the approved request.');
    return { bookingId: data.bookingId, confirmationNumber: data.confirmationNumber, status: data.status, paymentStatus: p.paymentStatus, verified: true, flightInfo: f, amount: offer.total, currency: p.currency, passenger: { firstName: traveler.firstName, lastName: traveler.lastName }, paymentInfo: { paymentId: p.paymentId ?? null, paymentMethod: p.paymentMethod ?? null, paymentStatus: p.paymentStatus, paymentDate: p.paymentDate ?? null } };
  }

  async queryAndVerify(request, confirmationNumber, expectedBookingId = request.result?.bookingId, payment = {}) {
    if (!/^[A-Z0-9]{6}$/.test(confirmationNumber ?? '')) throw new Error('A valid known confirmation number is required for read-back.');
    const data = await this.post('/api/flights/orders/query', { confirmationNumber, passengerLastName: request.passenger.lastName });
    return this.validateBooking(data, request, confirmationNumber, expectedBookingId, payment);
  }

  async bookAndVerify(request) {
    const { offer, passenger } = request;
    if (!offer?.flightId || !offer?.fareId || !Number.isFinite(offer.total) || offer.total <= 0 || !/^[A-Za-z][A-Za-z '-]{0,9}$/.test(passenger?.firstName ?? '') || !/^[A-Za-z][A-Za-z '-]{0,9}$/.test(passenger?.lastName ?? '')) throw new Error('A valid selected offer and synthetic traveler are required.');
    let created;
    try {
      created = await this.post('/api/flights/book', {
        flightId: offer.flightId, fareId: offer.fareId,
        passengers: [{ passengerType: 'ADULT', firstName: passenger.firstName, lastName: passenger.lastName, documentType: 'PASSPORT', documentNumber: 'DEMO000001', dateOfBirth: '1990-01-01', nationality: 'US' }],
        contactInfo: { phone: '+1-202-555-0100', email: 'travel-demo@example.com' },
      });
      this.validateBooking(created, request);
      return await this.queryAndVerify(request, created.confirmationNumber, created.bookingId);
    } catch (cause) {
      const error = new Error(`Booking could not be independently verified. Do not retry the booking. ${cause.message}`, { cause });
      error.statusCode = 502;
      if (/^[A-Z0-9]{6}$/.test(created?.confirmationNumber ?? '')) {
        error.confirmationNumber = created.confirmationNumber;
        error.result = { bookingId: typeof created.bookingId === 'string' ? created.bookingId : undefined, confirmationNumber: created.confirmationNumber, verified: false, status: 'UNVERIFIED', paymentStatus: 'UNKNOWN' };
      }
      throw error;
    }
  }

  async payAndVerify(request) {
    const booking = request?.result;
    const { offer, passenger } = request ?? {};
    if (!booking?.verified || booking.paymentStatus !== 'PENDING' || !booking.bookingId || !/^[A-Z0-9]{6}$/.test(booking.confirmationNumber ?? '')
      || !offer || !passenger || booking.amount !== offer.total || booking.currency !== offer.currency) {
      throw new Error('Only a verified, unpaid reservation can be paid.');
    }
    let paymentError;
    let paymentResponse;
    try {
      paymentResponse = await this.post('/api/flights/payandissue', {
        bookingId: booking.bookingId,
        paymentMethod: 'CREDIT_CARD',
        amount: Number(offer.total).toFixed(2),
        currency: offer.currency,
        paymentDetails: {
          cardNumber: '4111111111111111',
          cardHolderName: `${passenger.firstName} ${passenger.lastName}`,
          expiryDate: '12/28',
          cvv: '123',
        },
      });
    } catch (error) {
      paymentError = error;
    }
    try {
      const paidBooking = await this.queryAndVerify(request, booking.confirmationNumber, booking.bookingId, { paymentStatus: 'PAID' });
      const paymentId = paidBooking.paymentInfo?.paymentId;
      if (!paymentId) throw new Error('Paid order read-back did not return a payment reference.');
      const apiStatus = ['SUCCESS', 'FAILED', 'PENDING', 'CANCELLED'].includes(paymentResponse?.status)
        ? paymentResponse.status : 'UNKNOWN';
      const responseBookingId = typeof paymentResponse?.bookingId === 'string' && paymentResponse.bookingId.trim()
        ? paymentResponse.bookingId : null;
      const parsedAmount = Number(paymentResponse?.amount);
      const responseAmount = Number.isFinite(parsedAmount) && parsedAmount > 0 ? parsedAmount : null;
      const responseCurrency = typeof paymentResponse?.currency === 'string' && /^[A-Z]{3}$/.test(paymentResponse.currency)
        ? paymentResponse.currency : null;
      const responsePaymentId = typeof paymentResponse?.paymentId === 'string' && paymentResponse.paymentId.trim()
        ? paymentResponse.paymentId : null;
      const apiResponseVerified = apiStatus === 'SUCCESS'
        && (!responseBookingId || responseBookingId === booking.bookingId)
        && (responseAmount === null || Math.round(responseAmount * 100) === Math.round(offer.total * 100))
        && (!responseCurrency || responseCurrency === offer.currency)
        && (!responsePaymentId || responsePaymentId === paymentId);
      const apiMessage = typeof paymentResponse?.message === 'string'
        ? paymentResponse.message.replace(/[\p{Cc}\p{Cf}<>]/gu, ' ').trim().slice(0, 512) || null : null;
      return {
        payment: {
          paymentId, transactionId: typeof paymentResponse?.transactionId === 'string' ? paymentResponse.transactionId : null,
          status: 'SUCCESS', bookingId: paidBooking.bookingId, amount: paidBooking.amount, currency: paidBooking.currency,
          paymentMethod: paidBooking.paymentInfo.paymentMethod ?? 'CREDIT_CARD', paymentDate: paidBooking.paymentInfo.paymentDate,
          apiStatus, apiMessage, apiResponseVerified,
        },
        booking: paidBooking,
      };
    } catch (cause) {
      const detail = paymentError ? `${paymentError.message}; ${cause.message}` : cause.message;
      const error = new Error(`Payment could not be independently verified. Do not retry payment. ${detail}`, { cause });
      error.statusCode = 502;
      throw error;
    }
  }
}
