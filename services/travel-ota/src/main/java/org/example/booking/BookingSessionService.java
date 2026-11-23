package org.example.booking;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.example.booking.BookingSessionModels.*;
import org.example.config.RegionTenantCodeConfig;
import org.example.model.BookingRequest;
import org.example.model.BookingResponse;
import org.example.model.FlightSearchRequest;
import org.example.model.FlightSearchResponse;
import org.example.model.OrderQueryRequest;
import org.example.model.PaymentRequest;
import org.example.model.PaymentResponse;
import org.example.service.FlightService;
import org.example.service.OtaPersistenceService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;

@Service
public class BookingSessionService {

    public static final TravelPolicy TRAVEL_POLICY = new TravelPolicy(
            "policy-travel-approval",
            "TRV-01",
            "1.1",
            "Company Travel Policy",
            1000,
            "USD",
            "Flights costing more than $1,000 USD require manager approval before booking. The traveler's confirmation does not count as manager approval.");

    private static final Set<String> SUPPORTED_AIRPORTS = Set.of(
            "LHR", "CDG", "FRA", "AMS", "MAD", "BCN", "FCO", "MXP", "ZRH",
            "VIE", "CPH", "ARN", "OSL", "HEL", "WAW", "PRG", "BUD", "ATH", "IST");

    private static final String SEARCH_CONSTRAINTS =
            "One-way economy, one adult. Synthetic inventory; no payment.";
    private static final long DEFAULT_REVIEW_TTL_MS = 15L * 60L * 1000L;
    private static final Pattern SAFE_NAME = Pattern.compile("^[A-Za-z][A-Za-z' -]{0,9}$");
    private static final Pattern CURRENCY_CODE = Pattern.compile("^[A-Z]{3}$");
    private static final Pattern DATE_PATTERN = Pattern.compile("^\\d{4}-\\d{2}-\\d{2}$");
    private static final Pattern CONFIRMATION_CODE = Pattern.compile("^[A-Z0-9]{6}$");
    private static final Pattern UUID_V4 = Pattern.compile(
            "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", Pattern.CASE_INSENSITIVE);
    private static final DateTimeFormatter ISO_DATE_TIME = DateTimeFormatter.ISO_LOCAL_DATE_TIME;

    private final FlightService flightService;
    private final OtaPersistenceService persistenceService;
    private final ObjectMapper mapper = new ObjectMapper();
    private final ConcurrentHashMap<String, Object> sessionLocks = new ConcurrentHashMap<>();
    private volatile Clock clock = Clock.systemUTC();
    private volatile long reviewTtlMs = DEFAULT_REVIEW_TTL_MS;

    @Autowired
    public BookingSessionService(FlightService flightService, OtaPersistenceService persistenceService) {
        this.flightService = flightService;
        this.persistenceService = persistenceService;
    }

    public void setClockForTesting(Clock clock, long reviewTtlMs) {
        this.clock = clock;
        this.reviewTtlMs = reviewTtlMs;
    }

    public BookingSessionView getSession(String sessionId) {
        validateSessionId(sessionId);
        synchronized (lockFor(sessionId)) {
            SessionState state = loadAndExpire(sessionId);
            return new BookingSessionView(
                    sessionId,
                    state.offers(),
                    state.pending(),
                    deriveBookingView(state.pending()),
                    TRAVEL_POLICY);
        }
    }

    public SearchToolResponse search(String sessionId, String origin, String destination, String date) {
        validateSessionId(sessionId);
        if (origin == null || destination == null
                || !SUPPORTED_AIRPORTS.contains(origin)
                || !SUPPORTED_AIRPORTS.contains(destination)) {
            throw new BookingSessionException(400, "Use one of the supported European airport codes.");
        }
        if (origin.equals(destination)) {
            throw new BookingSessionException(400, "Origin and destination must be different.");
        }
        LocalDate parsedDate = parseFutureDate(date);

        FlightSearchRequest searchReq = new FlightSearchRequest();
        searchReq.setFromCity(origin);
        searchReq.setToCity(destination);
        searchReq.setDepartureDate(parsedDate);
        searchReq.setTripType("ONE_WAY");
        searchReq.setCabinClass("ECONOMY");
        FlightSearchRequest.PassengerInfo paxInfo = new FlightSearchRequest.PassengerInfo();
        paxInfo.setAdults(1);
        paxInfo.setChildren(0);
        paxInfo.setInfants(0);
        searchReq.setPassengerInfo(paxInfo);

        FlightSearchResponse response;
        try {
            response = flightService.searchFlights(searchReq);
        } catch (Exception e) {
            throw new BookingSessionException(502, e.getMessage(), e);
        }

        List<FlightSearchResponse.FlightOption> rawFlights =
                response != null && response.getFlights() != null ? response.getFlights() : List.of();
        List<SessionOffer> offers = rawFlights.stream()
                .map(flight -> toCheapestEconomyOffer(flight, origin, destination, date))
                .flatMap(Optional::stream)
                .sorted(Comparator.comparing(SessionOffer::total))
                .limit(6)
                .toList();

        if (!rawFlights.isEmpty() && offers.isEmpty()) {
            throw new BookingSessionException(
                    502, "Returned inventory did not match the requested route/date or supported fare conditions.");
        }

        synchronized (lockFor(sessionId)) {
            SessionState current = loadRaw(sessionId);
            PendingReview pending = current.pending();
            if (pending != null && ("awaiting_approval".equals(pending.status()) || "approved".equals(pending.status()))) {
                String nextStatus = nowMs() >= pending.expiresAt() ? "expired" : "cancelled";
                pending = withStatus(pending, nextStatus);
            }
            saveState(sessionId, offers, pending);
        }
        return new SearchToolResponse(offers, SEARCH_CONSTRAINTS);
    }

    public PendingReview prepare(String sessionId, String offerId, String firstName, String lastName) {
        validateSessionId(sessionId);
        if (offerId == null || offerId.isBlank() || offerId.length() > 200
                || !isValidName(firstName) || !isValidName(lastName)) {
            throw new BookingSessionException(
                    400, "Provide only an offerId and synthetic firstName/lastName of 1-10 safe characters each.");
        }
        synchronized (lockFor(sessionId)) {
            SessionState state = loadAndExpire(sessionId);
            PendingReview existing = state.pending();
            if (existing != null && Set.of("submitting", "completed", "uncertain").contains(existing.status())) {
                throw new BookingSessionException(409, "This conversation already has a submitted booking request.");
            }
            SessionOffer matched = state.offers().stream()
                    .filter(item -> offerId.equals(item.id()))
                    .findFirst()
                    .orElseThrow(() -> new BookingSessionException(
                            404, "Choose an offer returned by this session's search."));

            PendingReview created = new PendingReview(
                    UUID.randomUUID().toString(),
                    "awaiting_approval",
                    matched,
                    new PassengerName(firstName, lastName),
                    nowMs() + reviewTtlMs,
                    initialManagerApproval(matched),
                    null,
                    null,
                    null);
            saveState(sessionId, state.offers(), created);
            return created;
        }
    }

    public ApproveResponse approve(String sessionId, String requestId, Boolean injectSilentBug) {
        validateSessionId(sessionId);
        validateRequestId(requestId);
        synchronized (lockFor(sessionId)) {
            SessionState state = loadAndExpire(sessionId);
            PendingReview pending = requireMatchingRequest(state, requestId);
            if (!"USD".equals(pending.offer().currency())) {
                throw new BookingSessionException(
                        409, "This USD policy cannot be evaluated for a non-USD fare. No reservation has been created.");
            }
            boolean inject = injectSilentBug != null ? injectSilentBug : pending.demoFault() != null;
            boolean waitingForManager = "approved".equals(pending.status())
                    && pending.managerApproval() != null
                    && "pending".equals(pending.managerApproval().status())
                    && pending.demoFault() == null;
            if (!"awaiting_approval".equals(pending.status()) && !(waitingForManager && inject)) {
                throw new BookingSessionException(409, "This request is no longer awaiting approval.");
            }
            BigDecimal threshold = BigDecimal.valueOf(TRAVEL_POLICY.threshold());
            if (inject && pending.offer().total().compareTo(threshold) <= 0) {
                throw new BookingSessionException(
                        409, "This demo bug requires an active flight review above $1,000 USD.");
            }

            ManagerApproval approval = pending.managerApproval() != null
                    ? pending.managerApproval()
                    : initialManagerApproval(pending.offer());
            if (!inject && "not_requested".equals(approval.status())) {
                approval = new ManagerApproval(
                        approval.policyId(),
                        approval.ruleId(),
                        approval.policyVersion(),
                        approval.threshold(),
                        approval.currency(),
                        "pending",
                        nowIso());
            }
            DemoFault fault = inject
                    ? (pending.demoFault() != null
                            ? pending.demoFault()
                            : new DemoFault("skip_manager_approval", nowIso()))
                    : null;

            PendingReview approved = new PendingReview(
                    pending.id(),
                    "approved",
                    pending.offer(),
                    pending.passenger(),
                    pending.expiresAt(),
                    approval,
                    fault,
                    pending.result(),
                    pending.payment());
            saveState(sessionId, state.offers(), approved);
            boolean awaitingManager = !"not_required".equals(approval.status()) && !inject;
            return new ApproveResponse(true, awaitingManager, approved);
        }
    }

    public VerifiedBooking book(String sessionId, String requestId) {
        validateSessionId(sessionId);
        validateRequestId(requestId);

        PendingReview submitting;
        List<SessionOffer> offersSnapshot;
        boolean demoBypass;
        synchronized (lockFor(sessionId)) {
            SessionState state = loadAndExpire(sessionId);
            PendingReview pending = requireMatchingRequest(state, requestId);
            if ("completed".equals(pending.status()) && pending.result() != null) {
                return deriveBookingView(pending);
            }
            if (!"approved".equals(pending.status())) {
                throw new BookingSessionException(409, "Explicit human approval is required before booking.");
            }
            ManagerApproval approval = pending.managerApproval() != null
                    ? pending.managerApproval()
                    : initialManagerApproval(pending.offer());
            demoBypass = pending.demoFault() != null
                    && "skip_manager_approval".equals(pending.demoFault().kind())
                    && "USD".equals(pending.offer().currency())
                    && pending.offer().total().compareTo(BigDecimal.valueOf(TRAVEL_POLICY.threshold())) > 0;
            if (!"not_required".equals(approval.status()) && !demoBypass) {
                throw new BookingSessionException(
                        409, "Manager approval is required before booking. No reservation has been created.");
            }
            submitting = withStatus(pending, "submitting");
            offersSnapshot = state.offers();
            saveState(sessionId, offersSnapshot, submitting);
        }

        BookingResponse created = null;
        try {
            BookingRequest bookingReq = toBookingRequest(submitting);
            created = flightService.bookFlight(bookingReq);
            validateBookingResponse(created, submitting, null, null, "PENDING", null);

            OrderQueryRequest queryReq = new OrderQueryRequest();
            queryReq.setConfirmationNumber(created.getConfirmationNumber());
            queryReq.setPassengerLastName(submitting.passenger().lastName());
            BookingResponse queried = flightService.queryOrder(queryReq);
            VerifiedBooking verified = validateBookingResponse(
                    queried,
                    submitting,
                    created.getConfirmationNumber(),
                    created.getBookingId(),
                    "PENDING",
                    null);
            if (demoBypass) {
                verified = withPolicyEvidence(verified, submitting.managerApproval(), submitting.demoFault());
            }

            synchronized (lockFor(sessionId)) {
                SessionState latest = loadRaw(sessionId);
                PendingReview completed = new PendingReview(
                        submitting.id(),
                        "completed",
                        submitting.offer(),
                        submitting.passenger(),
                        submitting.expiresAt(),
                        submitting.managerApproval(),
                        submitting.demoFault(),
                        verified,
                        null);
                saveState(sessionId, latest.offers(), completed);
                return deriveBookingView(completed);
            }
        } catch (Exception e) {
            VerifiedBooking partial = null;
            if (created != null
                    && created.getConfirmationNumber() != null
                    && CONFIRMATION_CODE.matcher(created.getConfirmationNumber()).matches()) {
                partial = new VerifiedBooking(
                        created.getBookingId(),
                        created.getConfirmationNumber(),
                        "UNVERIFIED",
                        "UNKNOWN",
                        false,
                        null,
                        null,
                        null,
                        null,
                        null,
                        null,
                        null,
                        null,
                        null);
            }
            synchronized (lockFor(sessionId)) {
                SessionState latest = loadRaw(sessionId);
                PendingReview uncertain = new PendingReview(
                        submitting.id(),
                        "uncertain",
                        submitting.offer(),
                        submitting.passenger(),
                        submitting.expiresAt(),
                        submitting.managerApproval(),
                        submitting.demoFault(),
                        partial,
                        null);
                saveState(sessionId, latest.offers(), uncertain);
            }
            throw new BookingSessionException(
                    502,
                    "Booking could not be independently verified. Do not retry the booking. " + e.getMessage(),
                    e);
        }
    }

    public VerifiedBooking queryOrder(String sessionId) {
        validateSessionId(sessionId);
        PendingReview pending;
        synchronized (lockFor(sessionId)) {
            SessionState state = loadAndExpire(sessionId);
            pending = state.pending();
            if (pending == null || pending.result() == null
                    || pending.result().confirmationNumber() == null
                    || !CONFIRMATION_CODE.matcher(pending.result().confirmationNumber()).matches()) {
                throw new BookingSessionException(
                        400, "No known reservation reference exists. Do not repeat an uncertain booking.");
            }
        }

        String confirmationNumber = pending.result().confirmationNumber();
        String expectedBookingId = pending.result().bookingId();
        String expectedPaymentStatus = "PENDING";
        String expectedPaymentId = null;
        if (pending.payment() != null) {
            if ("completed".equals(pending.payment().status()) && pending.payment().result() != null) {
                expectedPaymentStatus = "PAID";
                expectedPaymentId = pending.payment().result().payment().paymentId();
            } else if (Set.of("submitting", "uncertain").contains(pending.payment().status())) {
                expectedPaymentStatus = "ANY";
            }
        }

        OrderQueryRequest queryReq = new OrderQueryRequest();
        queryReq.setConfirmationNumber(confirmationNumber);
        queryReq.setPassengerLastName(pending.passenger().lastName());
        BookingResponse queried;
        try {
            queried = flightService.queryOrder(queryReq);
        } catch (Exception e) {
            throw new BookingSessionException(502, e.getMessage(), e);
        }

        VerifiedBooking verified = validateBookingResponse(
                queried, pending, confirmationNumber, expectedBookingId, expectedPaymentStatus, expectedPaymentId);

        synchronized (lockFor(sessionId)) {
            SessionState latest = loadRaw(sessionId);
            PendingReview current = requireMatchingRequest(latest, pending.id());
            if ("completed".equals(current.status())
                    && current.payment() != null
                    && "completed".equals(current.payment().status())) {
                return deriveBookingView(current);
            }
            if ("completed".equals(current.status())
                    && current.payment() != null
                    && "uncertain".equals(current.payment().status())
                    && "PAID".equals(verified.paymentStatus())) {
                VerifiedPaymentDetail reconciledPayment = new VerifiedPaymentDetail(
                        verified.paymentInfo().paymentId(),
                        null,
                        "SUCCESS",
                        verified.bookingId(),
                        verified.amount(),
                        verified.currency(),
                        verified.paymentInfo().paymentMethod() != null
                                ? verified.paymentInfo().paymentMethod()
                                : "CREDIT_CARD",
                        verified.paymentInfo().paymentDate(),
                        "UNKNOWN",
                        null,
                        false);
                PendingReview updated = new PendingReview(
                        current.id(),
                        "completed",
                        current.offer(),
                        current.passenger(),
                        current.expiresAt(),
                        current.managerApproval(),
                        current.demoFault(),
                        current.result(),
                        new PendingPaymentState(
                                "completed", new PaymentExecutionResult(reconciledPayment, verified)));
                saveState(sessionId, latest.offers(), updated);
                return deriveBookingView(updated);
            }
            if ("uncertain".equals(current.status()) && "PENDING".equals(verified.paymentStatus())) {
                VerifiedBooking resolved = current.demoFault() != null
                        ? withPolicyEvidence(verified, current.managerApproval(), current.demoFault())
                        : verified;
                PendingReview updated = new PendingReview(
                        current.id(),
                        "completed",
                        current.offer(),
                        current.passenger(),
                        current.expiresAt(),
                        current.managerApproval(),
                        current.demoFault(),
                        resolved,
                        current.payment());
                saveState(sessionId, latest.offers(), updated);
                return deriveBookingView(updated);
            }
            if ("completed".equals(current.status())) {
                return deriveBookingView(current);
            }
            throw new BookingSessionException(
                    409, "Read-back must verify the exact pending booking and any known reference.");
        }
    }

    public PayResponse pay(String sessionId, String requestId) {
        validateSessionId(sessionId);
        validateRequestId(requestId);

        PendingReview active;
        synchronized (lockFor(sessionId)) {
            SessionState state = loadAndExpire(sessionId);
            PendingReview pending = requireMatchingRequest(state, requestId);
            if (!"completed".equals(pending.status())
                    || pending.result() == null
                    || !Boolean.TRUE.equals(pending.result().verified())) {
                throw new BookingSessionException(409, "Only a verified reservation can be paid.");
            }
            if (pending.payment() != null && "completed".equals(pending.payment().status())) {
                return new PayResponse(true, deriveBookingView(pending));
            }
            if (pending.payment() != null) {
                throw new BookingSessionException(
                        409, "Payment outcome is not clear. Check the order; do not retry payment.");
            }
            if (!"PENDING".equals(pending.result().paymentStatus())) {
                throw new BookingSessionException(409, "This reservation is not awaiting payment.");
            }
            active = new PendingReview(
                    pending.id(),
                    pending.status(),
                    pending.offer(),
                    pending.passenger(),
                    pending.expiresAt(),
                    pending.managerApproval(),
                    pending.demoFault(),
                    pending.result(),
                    new PendingPaymentState("submitting", null));
            saveState(sessionId, state.offers(), active);
        }

        Exception paymentError = null;
        PaymentResponse paymentResponse = null;
        try {
            PaymentRequest payReq = new PaymentRequest();
            payReq.setBookingId(active.result().bookingId());
            payReq.setPaymentMethod("CREDIT_CARD");
            payReq.setAmount(active.offer().total().setScale(2, RoundingMode.HALF_UP));
            payReq.setCurrency(active.offer().currency());
            PaymentRequest.PaymentDetails details = new PaymentRequest.PaymentDetails();
            details.setCardNumber("4111111111111111");
            details.setCardHolderName(active.passenger().firstName() + " " + active.passenger().lastName());
            details.setExpiryDate("12/28");
            details.setCvv("123");
            payReq.setPaymentDetails(details);
            paymentResponse = flightService.payAndIssue(payReq);
        } catch (Exception e) {
            paymentError = e;
        }

        try {
            OrderQueryRequest queryReq = new OrderQueryRequest();
            queryReq.setConfirmationNumber(active.result().confirmationNumber());
            queryReq.setPassengerLastName(active.passenger().lastName());
            BookingResponse queried = flightService.queryOrder(queryReq);
            VerifiedBooking paidBooking = validateBookingResponse(
                    queried,
                    active,
                    active.result().confirmationNumber(),
                    active.result().bookingId(),
                    "PAID",
                    null);
            String paymentId = paidBooking.paymentInfo() != null ? paidBooking.paymentInfo().paymentId() : null;
            if (paymentId == null || paymentId.isBlank()) {
                throw new IllegalStateException("Paid order read-back did not return a payment reference.");
            }
            String rawStatus = paymentResponse != null ? paymentResponse.getStatus() : null;
            String apiStatus = rawStatus != null && Set.of("SUCCESS", "FAILED", "PENDING", "CANCELLED").contains(rawStatus)
                    ? rawStatus
                    : "UNKNOWN";
            String respBookingId = paymentResponse != null && paymentResponse.getBookingId() != null
                    && !paymentResponse.getBookingId().isBlank()
                    ? paymentResponse.getBookingId()
                    : null;
            BigDecimal respAmount = paymentResponse != null && paymentResponse.getAmount() != null
                    && paymentResponse.getAmount().compareTo(BigDecimal.ZERO) > 0
                    ? paymentResponse.getAmount()
                    : null;
            String respCurrency = paymentResponse != null && paymentResponse.getCurrency() != null
                    && CURRENCY_CODE.matcher(paymentResponse.getCurrency()).matches()
                    ? paymentResponse.getCurrency()
                    : null;
            String respPaymentId = paymentResponse != null && paymentResponse.getPaymentId() != null
                    && !paymentResponse.getPaymentId().isBlank()
                    ? paymentResponse.getPaymentId()
                    : null;
            boolean apiVerified = "SUCCESS".equals(apiStatus)
                    && (respBookingId == null || respBookingId.equals(active.result().bookingId()))
                    && (respAmount == null || cents(respAmount) == cents(active.offer().total()))
                    && (respCurrency == null || respCurrency.equals(active.offer().currency()))
                    && (respPaymentId == null || respPaymentId.equals(paymentId));
            String apiMessage = sanitizeMessage(paymentResponse != null ? paymentResponse.getMessage() : null);
            String txId = paymentResponse != null && paymentResponse.getTransactionId() != null
                    && !paymentResponse.getTransactionId().isBlank()
                    ? paymentResponse.getTransactionId()
                    : null;

            VerifiedPaymentDetail paymentDetail = new VerifiedPaymentDetail(
                    paymentId,
                    txId,
                    "SUCCESS",
                    paidBooking.bookingId(),
                    paidBooking.amount(),
                    paidBooking.currency(),
                    paidBooking.paymentInfo().paymentMethod() != null
                            ? paidBooking.paymentInfo().paymentMethod()
                            : "CREDIT_CARD",
                    paidBooking.paymentInfo().paymentDate(),
                    apiStatus,
                    apiMessage,
                    apiVerified);

            synchronized (lockFor(sessionId)) {
                SessionState latest = loadRaw(sessionId);
                PendingReview completed = new PendingReview(
                        active.id(),
                        active.status(),
                        active.offer(),
                        active.passenger(),
                        active.expiresAt(),
                        active.managerApproval(),
                        active.demoFault(),
                        active.result(),
                        new PendingPaymentState(
                                "completed", new PaymentExecutionResult(paymentDetail, paidBooking)));
                saveState(sessionId, latest.offers(), completed);
                return new PayResponse(true, deriveBookingView(completed));
            }
        } catch (Exception e) {
            synchronized (lockFor(sessionId)) {
                SessionState latest = loadRaw(sessionId);
                PendingReview current = latest.pending();
                if (current != null && active.id().equals(current.id())) {
                    PendingReview uncertain = new PendingReview(
                            current.id(),
                            current.status(),
                            current.offer(),
                            current.passenger(),
                            current.expiresAt(),
                            current.managerApproval(),
                            current.demoFault(),
                            current.result(),
                            new PendingPaymentState("uncertain", null));
                    saveState(sessionId, latest.offers(), uncertain);
                }
            }
            String detail = paymentError != null ? paymentError.getMessage() + "; " + e.getMessage() : e.getMessage();
            throw new BookingSessionException(
                    502, "Payment could not be independently verified. Do not retry payment. " + detail, e);
        }
    }

    public CancelResponse cancel(String sessionId, String requestId) {
        validateSessionId(sessionId);
        validateRequestId(requestId);
        synchronized (lockFor(sessionId)) {
            SessionState state = loadAndExpire(sessionId);
            PendingReview pending = requireMatchingRequest(state, requestId);
            if (!Set.of("awaiting_approval", "approved", "cancelled").contains(pending.status())) {
                throw new BookingSessionException(409, "Only an unsubmitted request can be cancelled.");
            }
            PendingReview cancelled = withStatus(pending, "cancelled");
            saveState(sessionId, state.offers(), cancelled);
            return new CancelResponse(true, cancelled);
        }
    }

    private VerifiedBooking validateBookingResponse(
            BookingResponse data,
            PendingReview request,
            String expectedConfirmation,
            String expectedBookingId,
            String expectedPaymentStatus,
            String expectedPaymentId) {
        SessionOffer offer = request.offer();
        PassengerName passenger = request.passenger();
        BookingResponse.FlightInfo flight = data != null ? data.getFlightInfo() : null;
        BookingResponse.PaymentInfo pay = data != null ? data.getPaymentInfo() : null;
        BookingResponse.PassengerInfo traveler =
                data != null && data.getPassengers() != null && data.getPassengers().size() == 1
                        ? data.getPassengers().get(0)
                        : null;

        String returnedPayStatus = pay != null ? pay.getPaymentStatus() : null;
        boolean paymentStatusOk = "ANY".equals(expectedPaymentStatus)
                ? Set.of("PENDING", "PAID").contains(returnedPayStatus != null ? returnedPayStatus : "")
                : expectedPaymentStatus.equals(returnedPayStatus);
        boolean bookingStatusOk = "PAID".equals(returnedPayStatus)
                ? Set.of("TICKETED", "CONFIRMED").contains(data != null && data.getStatus() != null ? data.getStatus() : "")
                : data != null && "CONFIRMED".equals(data.getStatus());

        BigDecimal returnedAmount = pay != null ? pay.getAmount() : null;
        BigDecimal taxMultiplier = BigDecimal.ONE.add(RegionTenantCodeConfig.currentRegion().getTaxRate());
        boolean amountOk = returnedAmount != null && returnedAmount.compareTo(BigDecimal.ZERO) > 0
                && (cents(returnedAmount) == cents(offer.total())
                        || cents(returnedAmount.multiply(taxMultiplier)) == cents(offer.total()));

        String depTime = flight != null && flight.getDepartureTime() != null
                ? flight.getDepartureTime().format(ISO_DATE_TIME)
                : null;
        String arrTime = flight != null && flight.getArrivalTime() != null
                ? flight.getArrivalTime().format(ISO_DATE_TIME)
                : null;

        boolean valid = data != null
                && data.getBookingId() != null && !data.getBookingId().isBlank()
                && data.getConfirmationNumber() != null
                && CONFIRMATION_CODE.matcher(data.getConfirmationNumber()).matches()
                && (expectedConfirmation == null || expectedConfirmation.equals(data.getConfirmationNumber()))
                && (expectedBookingId == null || expectedBookingId.equals(data.getBookingId()))
                && bookingStatusOk
                && flight != null
                && offer.flightId().equals(flight.getFlightId())
                && offer.flightNumber().equals(flight.getFlightNumber())
                && offer.origin().equals(flight.getDepartureAirport())
                && offer.destination().equals(flight.getArrivalAirport())
                && offer.departureTime().equals(depTime)
                && offer.arrivalTime().equals(arrTime)
                && offer.cabinClass().equals(flight.getCabinClass())
                && pay != null
                && offer.currency().equals(pay.getCurrency())
                && paymentStatusOk
                && (expectedPaymentId == null || expectedPaymentId.equals(pay.getPaymentId()))
                && amountOk
                && traveler != null
                && "ADULT".equals(traveler.getPassengerType())
                && passenger.firstName().equals(traveler.getFirstName())
                && passenger.lastName().equals(traveler.getLastName());

        if (!valid) {
            throw new BookingSessionException(
                    409,
                    "Booking verification failed: returned flight, traveler, price, currency, or payment state does not match the approved request.");
        }

        return new VerifiedBooking(
                data.getBookingId(),
                data.getConfirmationNumber(),
                data.getStatus(),
                returnedPayStatus,
                true,
                new VerifiedFlightInfo(
                        flight.getFlightId(),
                        flight.getFlightNumber(),
                        flight.getDepartureAirport(),
                        flight.getDepartureCity(),
                        depTime,
                        flight.getArrivalAirport(),
                        flight.getArrivalCity(),
                        arrTime,
                        flight.getCabinClass()),
                normalizeMoney(offer.total()),
                pay.getCurrency(),
                new PassengerName(traveler.getFirstName(), traveler.getLastName()),
                new VerifiedPaymentInfo(
                        emptyToNull(pay.getPaymentId()),
                        emptyToNull(pay.getPaymentMethod()),
                        returnedPayStatus,
                        pay.getPaymentDate() != null ? pay.getPaymentDate().format(ISO_DATE_TIME) : null),
                null,
                null,
                null,
                null);
    }

    private static VerifiedBooking deriveBookingView(PendingReview pending) {
        if (pending == null || pending.result() == null) {
            return null;
        }
        VerifiedBooking base = pending.result();
        PendingPaymentState attempt = pending.payment();
        if (attempt != null && "completed".equals(attempt.status()) && attempt.result() != null) {
            VerifiedBooking paid = attempt.result().booking();
            return new VerifiedBooking(
                    paid.bookingId(),
                    paid.confirmationNumber(),
                    paid.status(),
                    paid.paymentStatus(),
                    paid.verified(),
                    paid.flightInfo(),
                    paid.amount(),
                    paid.currency(),
                    paid.passenger(),
                    paid.paymentInfo(),
                    base.managerApproval(),
                    base.demoFault(),
                    new PaymentAttemptSummary("completed"),
                    attempt.result().payment());
        }
        if (attempt != null) {
            String payStatus = "uncertain".equals(attempt.status()) ? "UNKNOWN" : base.paymentStatus();
            return new VerifiedBooking(
                    base.bookingId(),
                    base.confirmationNumber(),
                    base.status(),
                    payStatus,
                    base.verified(),
                    base.flightInfo(),
                    base.amount(),
                    base.currency(),
                    base.passenger(),
                    base.paymentInfo(),
                    base.managerApproval(),
                    base.demoFault(),
                    new PaymentAttemptSummary(attempt.status()),
                    null);
        }
        return base;
    }

    private static VerifiedBooking withPolicyEvidence(
            VerifiedBooking booking, ManagerApproval approval, DemoFault fault) {
        return new VerifiedBooking(
                booking.bookingId(),
                booking.confirmationNumber(),
                booking.status(),
                booking.paymentStatus(),
                booking.verified(),
                booking.flightInfo(),
                booking.amount(),
                booking.currency(),
                booking.passenger(),
                booking.paymentInfo(),
                approval,
                fault,
                booking.paymentAttempt(),
                booking.payment());
    }

    private static PendingReview withStatus(PendingReview pending, String nextStatus) {
        return new PendingReview(
                pending.id(),
                nextStatus,
                pending.offer(),
                pending.passenger(),
                pending.expiresAt(),
                pending.managerApproval(),
                pending.demoFault(),
                pending.result(),
                pending.payment());
    }

    private static BookingRequest toBookingRequest(PendingReview pending) {
        BookingRequest req = new BookingRequest();
        req.setFlightId(pending.offer().flightId());
        req.setFareId(pending.offer().fareId());
        BookingRequest.Passenger pax = new BookingRequest.Passenger();
        pax.setPassengerType("ADULT");
        pax.setFirstName(pending.passenger().firstName());
        pax.setLastName(pending.passenger().lastName());
        pax.setDocumentType("PASSPORT");
        pax.setDocumentNumber("DEMO000001");
        pax.setDateOfBirth("1990-01-01");
        pax.setNationality("US");
        req.setPassengers(List.of(pax));
        BookingRequest.ContactInfo contact = new BookingRequest.ContactInfo();
        contact.setPhone("+1-202-555-0100");
        contact.setEmail("travel-demo@example.com");
        req.setContactInfo(contact);
        return req;
    }

    private static Optional<SessionOffer> toCheapestEconomyOffer(
            FlightSearchResponse.FlightOption flight, String origin, String destination, String date) {
        if (flight == null
                || flight.getFlightId() == null || flight.getFlightId().isBlank()
                || !origin.equals(flight.getDepartureAirport())
                || !destination.equals(flight.getArrivalAirport())
                || flight.getDepartureTime() == null
                || flight.getArrivalTime() == null) {
            return Optional.empty();
        }
        String depIso = flight.getDepartureTime().format(ISO_DATE_TIME);
        String arrIso = flight.getArrivalTime().format(ISO_DATE_TIME);
        if (!depIso.startsWith(date + "T") || flight.getFareOptions() == null) {
            return Optional.empty();
        }
        return flight.getFareOptions().stream()
                .filter(fare -> fare != null
                        && fare.getFareId() != null && !fare.getFareId().isBlank()
                        && "ECONOMY".equals(fare.getCabinClass())
                        && fare.getPrice() != null && fare.getPrice().compareTo(BigDecimal.ZERO) > 0
                        && fare.getCurrency() != null && CURRENCY_CODE.matcher(fare.getCurrency()).matches())
                .min(Comparator.comparing(FlightSearchResponse.FareOption::getPrice))
                .map(fare -> {
                    String id = flight.getFlightId() + ":" + fare.getFareId();
                    return new SessionOffer(
                            id,
                            id,
                            flight.getFlightId(),
                            fare.getFareId(),
                            flight.getAirlineName() != null ? flight.getAirlineName() : "Airline",
                            flight.getFlightNumber(),
                            origin,
                            destination,
                            date,
                            depIso,
                            arrIso,
                            normalizeMoney(fare.getPrice()),
                            fare.getCurrency(),
                            fare.getCabinClass(),
                            fare.getFareBrand());
                });
    }

    private static ManagerApproval initialManagerApproval(SessionOffer offer) {
        String status;
        if (!TRAVEL_POLICY.currency().equals(offer.currency())) {
            status = "unsupported_currency";
        } else if (offer.total().compareTo(BigDecimal.valueOf(TRAVEL_POLICY.threshold())) > 0) {
            status = "not_requested";
        } else {
            status = "not_required";
        }
        return new ManagerApproval(
                TRAVEL_POLICY.policyId(),
                TRAVEL_POLICY.ruleId(),
                TRAVEL_POLICY.policyVersion(),
                TRAVEL_POLICY.threshold(),
                TRAVEL_POLICY.currency(),
                status,
                null);
    }

    private PendingReview requireMatchingRequest(SessionState state, String requestId) {
        PendingReview pending = state.pending();
        if (pending == null || !requestId.equals(pending.id())) {
            throw new BookingSessionException(404, "Booking request not found in this session.");
        }
        return pending;
    }

    private SessionState loadAndExpire(String sessionId) {
        SessionState state = loadRaw(sessionId);
        PendingReview pending = state.pending();
        if (pending != null
                && Set.of("awaiting_approval", "approved").contains(pending.status())
                && nowMs() >= pending.expiresAt()) {
            PendingReview expired = withStatus(pending, "expired");
            saveState(sessionId, state.offers(), expired);
            return new SessionState(state.offers(), expired);
        }
        return state;
    }

    private SessionState loadRaw(String sessionId) {
        Optional<OtaPersistenceService.BookingSessionRow> rowOpt = persistenceService.loadBookingSession(sessionId);
        if (rowOpt.isEmpty()) {
            return new SessionState(List.of(), null);
        }
        OtaPersistenceService.BookingSessionRow row = rowOpt.get();
        try {
            List<SessionOffer> offers = row.offersJson() == null || row.offersJson().isBlank()
                    ? List.of()
                    : mapper.readValue(row.offersJson(), new TypeReference<List<SessionOffer>>() {});
            PendingReview pending = row.pendingJson() == null || row.pendingJson().isBlank()
                    ? null
                    : mapper.readValue(row.pendingJson(), PendingReview.class);
            return new SessionState(offers, pending);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Corrupt booking session state for " + sessionId, e);
        }
    }

    private void saveState(String sessionId, List<SessionOffer> offers, PendingReview pending) {
        try {
            String offersJson = mapper.writeValueAsString(offers == null ? List.of() : offers);
            String pendingJson = pending == null ? null : mapper.writeValueAsString(pending);
            persistenceService.saveBookingSession(sessionId, offersJson, pendingJson);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Failed to serialize booking session state", e);
        }
    }

    private LocalDate parseFutureDate(String date) {
        if (date == null || !DATE_PATTERN.matcher(date).matches()) {
            throw new BookingSessionException(400, "Provide a valid future departure date in YYYY-MM-DD format.");
        }
        try {
            LocalDate parsed = LocalDate.parse(date, DateTimeFormatter.ISO_LOCAL_DATE);
            LocalDate todayUtc = LocalDate.now(clock.withZone(ZoneOffset.UTC));
            if (!parsed.toString().equals(date) || parsed.isBefore(todayUtc)) {
                throw new BookingSessionException(400, "Provide a valid future departure date in YYYY-MM-DD format.");
            }
            return parsed;
        } catch (DateTimeParseException e) {
            throw new BookingSessionException(400, "Provide a valid future departure date in YYYY-MM-DD format.");
        }
    }

    private static void validateSessionId(String sessionId) {
        if (sessionId == null || sessionId.isBlank() || sessionId.length() > 128
                || !sessionId.equals(sessionId.trim())
                || sessionId.chars().anyMatch(ch -> Character.isISOControl(ch) || ch == '<' || ch == '>')) {
            throw new BookingSessionException(400, "A valid session ID is required.");
        }
    }

    private static void validateRequestId(String requestId) {
        if (requestId == null || !UUID_V4.matcher(requestId).matches()) {
            throw new BookingSessionException(400, "A valid booking requestId is required.");
        }
    }

    private static boolean isValidName(String value) {
        return value != null && value.equals(value.trim()) && SAFE_NAME.matcher(value).matches();
    }

    private static BigDecimal normalizeMoney(BigDecimal value) {
        if (value == null) {
            return null;
        }
        if (value.scale() > 0 && value.remainder(BigDecimal.ONE).compareTo(BigDecimal.ZERO) == 0) {
            return value.setScale(0, RoundingMode.UNNECESSARY);
        }
        return value;
    }

    private static long cents(BigDecimal value) {
        return value.multiply(BigDecimal.valueOf(100)).setScale(0, RoundingMode.HALF_UP).longValueExact();
    }

    private static String emptyToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }

    private static String sanitizeMessage(String value) {
        if (value == null) {
            return null;
        }
        String cleaned = value.replaceAll("[\\p{Cntrl}<>]", " ").trim();
        if (cleaned.isEmpty()) {
            return null;
        }
        return cleaned.length() > 512 ? cleaned.substring(0, 512) : cleaned;
    }

    private Object lockFor(String sessionId) {
        return sessionLocks.computeIfAbsent(sessionId, ignored -> new Object());
    }

    private long nowMs() {
        return Instant.now(clock).toEpochMilli();
    }

    private String nowIso() {
        return Instant.now(clock).toString();
    }

    private record SessionState(List<SessionOffer> offers, PendingReview pending) {}
}
