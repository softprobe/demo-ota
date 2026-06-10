package org.example.service;

import com.airline.common.model.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.example.config.AirlineApiConfig;
import org.example.entity.Order;
import org.example.entity.Passenger;
import org.example.repository.OrderRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * OTA 核心编排层。
 *
 * <p>每个业务接口都编排多个真实下游,让 SP agent 录制入口请求时能同时看到三类
 * 下游 span —— JDBC SQL(H2 / JPA)、Redis(Lettuce)、HTTP(sp-airline):
 * <ul>
 *   <li>DB:通过 {@link OrderRepository}(Spring Data JPA)读写订单主数据</li>
 *   <li>Redis:通过 {@link StringRedisTemplate} 做航班搜索缓存 / 订单缓存</li>
 *   <li>HTTP:通过 {@link RestTemplate} 调 sp-airline 出票 / 支付 / 退改 / 行李</li>
 * </ul>
 *
 * <p>订单缓存键用 {@code order:{confirmationNumber}}:查单入口只携带 PNR
 * 确认号,以它为键缓存才自洽(下单写入、查单命中)。
 */
@Service
public class FlightService {
    private static final Logger logger = LoggerFactory.getLogger(FlightService.class);

    // ---- sp-airline endpoints ----
    private static final String FLIGHT_SEARCH_ENDPOINT = "/flights/search";
    private static final String FLIGHT_BOOK_ENDPOINT = "/flights/book";
    private static final String PAYMENT_PROCESS_ENDPOINT = "/payment/process";
    private static final String REFUND_PROCESS_ENDPOINT = "/refund/process";
    private static final String FLIGHT_CHANGE_ENDPOINT = "/flights/change";
    private static final String BAGGAGE_PURCHASE_ENDPOINT = "/baggage/purchase";

    // ---- Redis keys / TTL ----
    private static final String SEARCH_CACHE_PREFIX = "flights:";
    private static final String ORDER_CACHE_PREFIX = "order:";
    private static final long SEARCH_CACHE_TTL_MINUTES = 5;

    @Autowired
    private RestTemplate restTemplate;

    @Autowired
    private AirlineApiConfig airlineApiConfig;

    @Autowired
    private OrderRepository orderRepository;

    @Autowired
    private StringRedisTemplate redisTemplate;

    @Autowired
    private ObjectMapper objectMapper;

    // ==================== FLIGHT SEARCH ====================

    /**
     * 搜航班:先查 Redis 缓存 → 未命中调 sp-airline → 回填 Redis(TTL 5min)。
     * 命中缓存则直接返回,跳过 HTTP 下游。
     */
    public FlightSearchResponse searchFlights(FlightSearchRequest request) {
        String cacheKey = buildSearchCacheKey(request);

        // 1) Redis GET —— 命中即返
        String cached = redisTemplate.opsForValue().get(cacheKey);
        if (cached != null) {
            logger.info("Flight search cache HIT: {}", cacheKey);
            return fromJson(cached, FlightSearchResponse.class);
        }
        logger.info("Flight search cache MISS: {}", cacheKey);

        // 2) HTTP —— 调 sp-airline 搜索
        String url = airlineApiConfig.getBaseUrl() + FLIGHT_SEARCH_ENDPOINT;
        logger.info("AirlineApiConfig baseUrl: {}", airlineApiConfig.getBaseUrl());
        logger.info("Environment AIRLINE_BASE_URL: {}", System.getenv("AIRLINE_BASE_URL"));
        logger.info("Calling airline API for flight search at: {}", url);
        logger.info("Flight search request: {}", request);
        FlightSearchResponse flightResponse = postToAirline(url, request, FlightSearchResponse.class,
                "Failed to get response from airline API", "flight search");

        // 3) Redis SET —— 回填缓存
        redisTemplate.opsForValue().set(cacheKey, toJson(flightResponse),
                SEARCH_CACHE_TTL_MINUTES, TimeUnit.MINUTES);
        logger.info("Flight search cache SET: {} (ttl {}min)", cacheKey, SEARCH_CACHE_TTL_MINUTES);

        return flightResponse;
    }

    // ==================== ORDER CREATION ====================

    /**
     * 下单出票:调 sp-airline 出票 → JPA 落库订单+乘客(DB INSERT)→ Redis 缓存订单。
     */
    public BookingResponse bookFlight(BookingRequest request) {
        // 与旧逻辑一致:先预热 sp-airline 的航班库存,保证 flightId 可被出票命中
        prePopulateFlights(request);

        // HTTP —— 调 sp-airline 出票
        String url = airlineApiConfig.getBaseUrl() + FLIGHT_BOOK_ENDPOINT;
        logger.info("Calling airline API at: {}", url);
        logger.info("Booking request: {}", request);
        BookingResponse bookingResponse = postToAirline(url, request, BookingResponse.class,
                "Failed to book flight through airline API", "flight booking");
        logger.info("Airline API response body: {}", bookingResponse);

        // DB —— 落库订单主数据 + 乘客
        Order order = toOrderEntity(bookingResponse);
        orderRepository.save(order);
        logger.info("Order persisted: bookingId={}, confirmationNumber={}",
                order.getBookingId(), order.getConfirmationNumber());

        // Redis —— 缓存整单(供查单命中)
        cacheOrder(bookingResponse);

        return bookingResponse;
    }

    // ==================== PAYMENT ====================

    /**
     * 支付出票:JPA 查订单(DB SELECT)→ 调 sp-airline 支付 → JPA 置 PAID(DB UPDATE)
     * → 刷新 Redis 订单缓存。
     */
    public PaymentResponse payAndIssue(PaymentRequest request) {
        // DB —— 定位订单
        Order order = orderRepository.findByBookingId(request.getBookingId())
                .orElseThrow(() -> new RuntimeException("Order not found for bookingId: " + request.getBookingId()));

        // HTTP —— 调 sp-airline 支付
        String url = airlineApiConfig.getBaseUrl() + PAYMENT_PROCESS_ENDPOINT;
        logger.info("Calling airline API for payment at: {}", url);
        logger.info("Payment request: {}", request);
        PaymentResponse paymentResponse = postToAirline(url, request, PaymentResponse.class,
                "Failed to process payment through airline API", "payment processing");
        logger.info("Airline API payment response body: {}", paymentResponse);

        // DB —— 置为已支付。用定向 UPDATE 而非 save(order):save 走 merge 会级联
        // 比对 passengers 集合,回放时产生录制里没有的 SQL(mock 匹配不上)。
        if ("SUCCESS".equals(paymentResponse.getStatus())) {
            orderRepository.updatePaymentStatus(order.getBookingId(), "PAID");
            order.setPaymentStatus("PAID"); // 同步内存对象,供下面缓存刷新用
            logger.info("Order marked PAID: bookingId={}", order.getBookingId());

            // Redis —— 刷新订单缓存(反映最新支付状态)
            refreshOrderCache(order);
        }

        return paymentResponse;
    }

    // ==================== ORDER QUERY ====================

    /**
     * 查单:Redis GET 命中直返;未命中 JPA 查库(DB SELECT)→ 回填 Redis。
     */
    public BookingResponse queryOrder(OrderQueryRequest request) {
        String cacheKey = ORDER_CACHE_PREFIX + request.getConfirmationNumber();

        // Redis GET —— 命中即返
        String cached = redisTemplate.opsForValue().get(cacheKey);
        if (cached != null) {
            logger.info("Order cache HIT: {}", cacheKey);
            return fromJson(cached, BookingResponse.class);
        }
        logger.info("Order cache MISS: {}", cacheKey);

        // DB —— 查库
        Order order = orderRepository.findByConfirmationNumber(request.getConfirmationNumber())
                .orElseThrow(() -> new RuntimeException(
                        "Order not found for confirmationNumber: " + request.getConfirmationNumber()));

        BookingResponse response = toBookingResponse(order);

        // Redis SET —— 回填缓存
        redisTemplate.opsForValue().set(cacheKey, toJson(response));
        logger.info("Order cache backfilled: {}", cacheKey);

        return response;
    }

    // ==================== REFUND ====================

    /**
     * 退票:JPA 查订单 → 本地计算手续费 → 调 sp-airline /refund/process → 以本地
     * 计费覆盖响应金额 → JPA 置 REFUNDED → 失效缓存。
     *
     * <p>手续费按平台收费政策在 travel-ota 侧计算(航司只负责退票执行,不参与定价),
     * 响应给用户的金额一律以平台计费为准。
     */
    public RefundResponse processRefund(RefundRequest request) {
        // DB —— 定位订单
        Order order = orderRepository.findByBookingId(request.getBookingId())
                .orElseThrow(() -> new RuntimeException("Order not found for bookingId: " + request.getBookingId()));

        // 本地计算手续费
        long hoursUntilDeparture = hoursUntilDeparture(order.getDepartureTime());
        BigDecimal totalAmount = order.getAmount() != null ? order.getAmount() : BigDecimal.ZERO;
        BigDecimal cancellationFee = calculateCancellationFee(hoursUntilDeparture, request.getRefundReason(), totalAmount);
        BigDecimal netRefundAmount = totalAmount.subtract(cancellationFee);

        // HTTP —— 调 sp-airline 执行退票
        String url = airlineApiConfig.getBaseUrl() + REFUND_PROCESS_ENDPOINT;
        logger.info("Calling airline API for refund at: {}", url);
        logger.info("Refund request: {}", request);
        RefundResponse response = postToAirline(url, request, RefundResponse.class,
                "Failed to process refund through airline API", "refund processing");
        logger.info("Airline API refund response body: {}", response);

        // 金额以平台计费为准回填响应
        response.setRefundAmount(totalAmount);
        response.setCancellationFee(cancellationFee);
        response.setNetRefundAmount(netRefundAmount);
        if (order.getCurrency() != null) {
            response.setCurrency(order.getCurrency());
        }

        // DB —— 置为已退票(定向 UPDATE,理由同 payAndIssue)
        if ("SUCCESS".equals(response.getStatus())) {
            orderRepository.updateStatus(order.getBookingId(), "REFUNDED");
            logger.info("Order marked REFUNDED: bookingId={}", order.getBookingId());
            evictOrderCache(order);
        }

        return response;
    }

    // ==================== FLIGHT CHANGE ====================

    /**
     * 改签:JPA 查订单 → 调 sp-airline 改签 → JPA 更新航班/状态(DB UPDATE)→ 失效缓存。
     */
    public ChangeFlightResponse changeFlight(ChangeFlightRequest request) {
        // DB —— 定位订单
        Order order = orderRepository.findByBookingId(request.getOriginalBookingId())
                .orElseThrow(() -> new RuntimeException(
                        "Order not found for bookingId: " + request.getOriginalBookingId()));
        // 记录原确认号:改签可能签发新 PNR,需按原键失效缓存
        String originalConfirmationNumber = order.getConfirmationNumber();

        // 与旧逻辑一致:改签前预热目标航班库存
        if (request.getNewDepartureCity() != null && request.getNewArrivalCity() != null) {
            FlightSearchRequest searchRequest = new FlightSearchRequest();
            searchRequest.setFromCity(request.getNewDepartureCity());
            searchRequest.setToCity(request.getNewArrivalCity());
            searchRequest.setDepartureDate(request.getNewDepartureDate() != null
                    ? request.getNewDepartureDate() : LocalDate.now().plusDays(1));
            searchRequest.setTripType("ONE_WAY");
            searchRequest.setCabinClass("ECONOMY");
            FlightSearchRequest.PassengerInfo passengerInfo = new FlightSearchRequest.PassengerInfo();
            passengerInfo.setAdults(1);
            searchRequest.setPassengerInfo(passengerInfo);
            logger.info("Pre-searching flights for change operation...");
            searchFlights(searchRequest);
        }

        // HTTP —— 调 sp-airline 改签
        String url = airlineApiConfig.getBaseUrl() + FLIGHT_CHANGE_ENDPOINT;
        logger.info("Calling airline API for flight change at: {}", url);
        logger.info("Flight change request: {}", request);
        ChangeFlightResponse response = postToAirline(url, request, ChangeFlightResponse.class,
                "Failed to change flight through airline API", "flight change");
        logger.info("Airline API change response body: {}", response);

        // DB —— 更新订单航班信息与状态(定向 UPDATE,理由同 payAndIssue:
        // service 层先算好每列的新值,一条对称的多列 UPDATE 落库)
        if ("SUCCESS".equals(response.getStatus())) {
            var nf = response.getNewFlight();
            String flightId = nf != null ? nf.getFlightId() : order.getFlightId();
            String flightNumber = nf != null ? nf.getFlightNumber() : order.getFlightNumber();
            LocalDateTime departureTime = nf != null ? nf.getDepartureTime() : order.getDepartureTime();
            String cabinClass = nf != null ? nf.getCabinClass() : order.getCabinClass();
            String confirmationNumber = response.getNewConfirmationNumber() != null
                    ? response.getNewConfirmationNumber() : order.getConfirmationNumber();
            orderRepository.updateFlightChange(order.getBookingId(),
                    flightId, flightNumber, departureTime, cabinClass, confirmationNumber);
            logger.info("Order marked CHANGED: bookingId={}", order.getBookingId());
            // 按原确认号失效旧缓存(新 PNR 下次查单会走 DB 回填)
            evictOrderCache(originalConfirmationNumber);
        }

        return response;
    }

    // ==================== BAGGAGE ====================

    /**
     * 购买行李额:JPA 查订单 → 调 sp-airline 购买 → 失效订单缓存(整单金额可能变化)。
     */
    public BaggageResponse purchaseBaggage(BaggageRequest request) {
        // DB —— 定位订单(校验订单存在)
        Order order = orderRepository.findByBookingId(request.getBookingId())
                .orElseThrow(() -> new RuntimeException("Order not found for bookingId: " + request.getBookingId()));

        // HTTP —— 调 sp-airline 购买行李额
        String url = airlineApiConfig.getBaseUrl() + BAGGAGE_PURCHASE_ENDPOINT;
        logger.info("Calling airline API for baggage purchase at: {}", url);
        logger.info("Baggage purchase request: {}", request);
        BaggageResponse response = postToAirline(url, request, BaggageResponse.class,
                "Failed to purchase baggage through airline API", "baggage purchase");
        logger.info("Airline API baggage response body: {}", response);

        // Redis —— 失效订单缓存(整单金额可能变化;订单标量列无变化,不发无谓 UPDATE)
        if ("SUCCESS".equals(response.getStatus())) {
            evictOrderCache(order);
        }

        return response;
    }

    // ==================== 手续费计算 ====================

    /**
     * 退票手续费(个人原因按距起飞时长分档):
     *   >72h 收 15%;24-72h 收 30%;≤24h 收 50%。
     *   航司主动变更(SCHEDULE_CHANGE)免收;紧急情况(EMERGENCY)按 10% 收取。
     */
    private BigDecimal calculateCancellationFee(long hoursUntilDeparture, String refundReason, BigDecimal totalAmount) {
        // 航司主动变更 —— 免手续费
        if ("SCHEDULE_CHANGE".equals(refundReason)) {
            return BigDecimal.ZERO.setScale(2, RoundingMode.HALF_UP);
        }
        // 紧急情况 —— 降档手续费
        if ("EMERGENCY".equals(refundReason)) {
            return scale(totalAmount.multiply(new BigDecimal("0.10"))); // 10%
        }

        // 个人原因 —— 按距起飞时长分档
        if (hoursUntilDeparture > 72) {
            return scale(totalAmount.multiply(new BigDecimal("0.15"))); // 15%
        } else if (hoursUntilDeparture > 24) {
            return scale(totalAmount.multiply(new BigDecimal("0.30"))); // 30%
        } else {
            return scale(totalAmount.multiply(new BigDecimal("0.50"))); // 50%
        }
    }

    private long hoursUntilDeparture(LocalDateTime departureTime) {
        if (departureTime == null) {
            return Long.MAX_VALUE; // 无起飞时间信息时按最宽档(15%)处理
        }
        return Duration.between(LocalDateTime.now(), departureTime).toHours();
    }

    private static BigDecimal scale(BigDecimal value) {
        return value.setScale(2, RoundingMode.HALF_UP);
    }

    // ==================== 下游 / 映射 辅助 ====================

    /** 统一封装:POST 到 sp-airline,校验 2xx + body,保留原有异常处理风格。 */
    private <REQ, RES> RES postToAirline(String url, REQ body, Class<RES> responseType,
                                         String failMessage, String operation) {
        try {
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            HttpEntity<REQ> entity = new HttpEntity<>(body, headers);

            ResponseEntity<RES> response = restTemplate.postForEntity(url, entity, responseType);
            logger.info("Airline API response status: {}", response.getStatusCode());

            if (response.getStatusCode().is2xxSuccessful() && response.getBody() != null) {
                return response.getBody();
            }
            logger.error("Airline API returned non-success status: {}", response.getStatusCode());
            throw new RuntimeException(failMessage + " - Status: " + response.getStatusCode());
        } catch (RestClientException e) {
            logger.error(failMessage, e);
            throw new RuntimeException(failMessage + ": " + e.getMessage());
        } catch (RuntimeException e) {
            throw e;
        } catch (Exception e) {
            logger.error("Unexpected error during {}", operation, e);
            throw new RuntimeException("Unexpected error during " + operation + ": " + e.getMessage());
        }
    }

    /** 出票前预热 sp-airline 航班库存(与旧逻辑一致),让 flightId 可命中。 */
    private void prePopulateFlights(BookingRequest request) {
        FlightSearchRequest searchRequest = new FlightSearchRequest();
        searchRequest.setFromCity("New York");
        searchRequest.setToCity("Los Angeles");
        searchRequest.setDepartureDate(LocalDate.now().plusDays(7));
        searchRequest.setTripType("ONE_WAY");
        searchRequest.setCabinClass("ECONOMY");

        FlightSearchRequest.PassengerInfo passengerInfo = new FlightSearchRequest.PassengerInfo();
        passengerInfo.setAdults(request.getPassengers() != null ? request.getPassengers().size() : 1);
        searchRequest.setPassengerInfo(passengerInfo);

        logger.info("Pre-populating flights in sp-airline service...");
        FlightSearchResponse searchResponse = searchFlights(searchRequest);
        logger.info("Flights pre-populated. Found {} flights",
                searchResponse != null && searchResponse.getFlights() != null
                        ? searchResponse.getFlights().size() : 0);
    }

    /** 从 sp-airline 的 BookingResponse 抽关键字段构建订单实体。 */
    private Order toOrderEntity(BookingResponse resp) {
        Order order = new Order();
        order.setBookingId(resp.getBookingId());
        order.setConfirmationNumber(resp.getConfirmationNumber());
        order.setStatus(resp.getStatus() != null ? resp.getStatus() : "CONFIRMED");
        order.setCreatedAt(LocalDateTime.now());

        BookingResponse.FlightInfo flightInfo = resp.getFlightInfo();
        if (flightInfo != null) {
            order.setFlightId(flightInfo.getFlightId());
            order.setFlightNumber(flightInfo.getFlightNumber());
            order.setDepartureTime(flightInfo.getDepartureTime());
            order.setCabinClass(flightInfo.getCabinClass());
        }

        BookingResponse.PaymentInfo paymentInfo = resp.getPaymentInfo();
        if (paymentInfo != null) {
            order.setAmount(paymentInfo.getAmount());
            order.setCurrency(paymentInfo.getCurrency());
            order.setPaymentStatus(paymentInfo.getPaymentStatus() != null
                    ? paymentInfo.getPaymentStatus() : "UNPAID");
        } else {
            order.setPaymentStatus("UNPAID");
        }

        List<BookingResponse.PassengerInfo> passengers = resp.getPassengers();
        if (passengers != null && !passengers.isEmpty()) {
            order.setPassengerLastName(passengers.get(0).getLastName());
            for (BookingResponse.PassengerInfo p : passengers) {
                Passenger passenger = new Passenger();
                passenger.setFirstName(p.getFirstName());
                passenger.setLastName(p.getLastName());
                passenger.setDocumentNumber(p.getDocumentNumber());
                passenger.setSeatNumber(p.getSeatNumber());
                passenger.setPassengerType(p.getPassengerType());
                order.addPassenger(passenger);
            }
        }

        return order;
    }

    /** 从订单实体重建 BookingResponse(查单缓存未命中时用)。 */
    private BookingResponse toBookingResponse(Order order) {
        BookingResponse resp = new BookingResponse();
        resp.setBookingId(order.getBookingId());
        resp.setConfirmationNumber(order.getConfirmationNumber());
        resp.setStatus(order.getStatus());
        resp.setBookingDate(order.getCreatedAt());

        BookingResponse.FlightInfo flightInfo = new BookingResponse.FlightInfo();
        flightInfo.setFlightId(order.getFlightId());
        flightInfo.setFlightNumber(order.getFlightNumber());
        flightInfo.setDepartureTime(order.getDepartureTime());
        flightInfo.setCabinClass(order.getCabinClass());
        resp.setFlightInfo(flightInfo);

        BookingResponse.PaymentInfo paymentInfo = new BookingResponse.PaymentInfo();
        paymentInfo.setAmount(order.getAmount());
        paymentInfo.setCurrency(order.getCurrency());
        paymentInfo.setPaymentStatus(order.getPaymentStatus());
        resp.setPaymentInfo(paymentInfo);

        List<BookingResponse.PassengerInfo> passengers = new ArrayList<>();
        for (Passenger p : order.getPassengers()) {
            BookingResponse.PassengerInfo info = new BookingResponse.PassengerInfo();
            info.setFirstName(p.getFirstName());
            info.setLastName(p.getLastName());
            info.setDocumentNumber(p.getDocumentNumber());
            info.setSeatNumber(p.getSeatNumber());
            info.setPassengerType(p.getPassengerType());
            passengers.add(info);
        }
        resp.setPassengers(passengers);

        return resp;
    }

    // ==================== Redis 订单缓存辅助 ====================

    private void cacheOrder(BookingResponse resp) {
        if (resp.getConfirmationNumber() == null) {
            return;
        }
        String key = ORDER_CACHE_PREFIX + resp.getConfirmationNumber();
        redisTemplate.opsForValue().set(key, toJson(resp));
        logger.info("Order cache SET: {}", key);
    }

    private void refreshOrderCache(Order order) {
        if (order.getConfirmationNumber() == null) {
            return;
        }
        String key = ORDER_CACHE_PREFIX + order.getConfirmationNumber();
        redisTemplate.opsForValue().set(key, toJson(toBookingResponse(order)));
        logger.info("Order cache refreshed: {}", key);
    }

    private void evictOrderCache(Order order) {
        evictOrderCache(order.getConfirmationNumber());
    }

    private void evictOrderCache(String confirmationNumber) {
        if (confirmationNumber == null) {
            return;
        }
        String key = ORDER_CACHE_PREFIX + confirmationNumber;
        redisTemplate.delete(key);
        logger.info("Order cache EVICTED: {}", key);
    }

    private String buildSearchCacheKey(FlightSearchRequest request) {
        return SEARCH_CACHE_PREFIX + request.getFromCity() + ":" + request.getToCity()
                + ":" + request.getDepartureDate();
    }

    // ==================== JSON 序列化辅助 ====================

    private String toJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (Exception e) {
            throw new RuntimeException("Failed to serialize value for cache: " + e.getMessage(), e);
        }
    }

    private <T> T fromJson(String json, Class<T> type) {
        try {
            return objectMapper.readValue(json, type);
        } catch (Exception e) {
            throw new RuntimeException("Failed to deserialize cached value: " + e.getMessage(), e);
        }
    }
}
