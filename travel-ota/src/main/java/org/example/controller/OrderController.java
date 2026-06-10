package org.example.controller;

import com.airline.common.model.*;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.example.service.FlightService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.Map;

/**
 * 订单全生命周期入口。路径见名知意:
 * <ul>
 *   <li>POST /api/orders          —— 下单出票</li>
 *   <li>POST /api/orders/pay      —— 支付出票</li>
 *   <li>POST /api/orders/query    —— 查订单</li>
 *   <li>POST /api/orders/refund   —— 退票</li>
 *   <li>POST /api/orders/change   —— 改签</li>
 *   <li>POST /api/orders/baggage  —— 购买行李额</li>
 * </ul>
 * 每个接口内部编排 DB(JPA/JDBC)+ Redis(Lettuce)+ HTTP(sp-airline)多下游。
 */
@RestController
@RequestMapping("/api/orders")
@CrossOrigin(origins = "*")
public class OrderController {
    private static final Logger logger = LoggerFactory.getLogger(OrderController.class);

    @Autowired
    private FlightService flightService;

    /** 下单:sp-airline 出票 → JPA 落库 → Redis 缓存 */
    @PostMapping
    public ResponseEntity<Object> createOrder(@Valid @RequestBody BookingRequest request,
                                              HttpServletRequest httpRequest) {
        try {
            printHeaders(httpRequest, "/api/orders");
            BookingResponse response = flightService.bookFlight(request);
            logger.info("Booking response: {}", response);
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            return badRequest("Flight booking failed", e);
        }
    }

    /** 支付出票:JPA 查单 → sp-airline 支付 → JPA 置 PAID → Redis 刷新 */
    @PostMapping("/pay")
    public ResponseEntity<PaymentResponse> pay(@Valid @RequestBody PaymentRequest request,
                                               HttpServletRequest httpRequest) {
        try {
            printHeaders(httpRequest, "/api/orders/pay");
            PaymentResponse response = flightService.payAndIssue(request);
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            logger.error("Payment failed", e);
            return ResponseEntity.badRequest().build();
        }
    }

    /** 查单:Redis 命中直返;未命中 JPA 查库 → 回填 Redis */
    @PostMapping("/query")
    public ResponseEntity<Object> query(@Valid @RequestBody OrderQueryRequest request,
                                        HttpServletRequest httpRequest) {
        try {
            printHeaders(httpRequest, "/api/orders/query");
            BookingResponse response = flightService.queryOrder(request);
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            return badRequest("Order query failed", e);
        }
    }

    /** 退票:JPA 查单 → 计算手续费 → sp-airline 退票 → JPA 置 REFUNDED */
    @PostMapping("/refund")
    public ResponseEntity<Object> refund(@Valid @RequestBody RefundRequest request,
                                         HttpServletRequest httpRequest) {
        try {
            printHeaders(httpRequest, "/api/orders/refund");
            RefundResponse response = flightService.processRefund(request);
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            return badRequest("Refund processing failed", e);
        }
    }

    /** 改签:JPA 查单 → sp-airline 改签 → JPA 更新航班/状态 */
    @PostMapping("/change")
    public ResponseEntity<Object> change(@Valid @RequestBody ChangeFlightRequest request,
                                         HttpServletRequest httpRequest) {
        try {
            printHeaders(httpRequest, "/api/orders/change");
            ChangeFlightResponse response = flightService.changeFlight(request);
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            return badRequest("Flight change failed", e);
        }
    }

    /** 购买行李额:JPA 查单 → sp-airline 购买 → Redis 失效 */
    @PostMapping("/baggage")
    public ResponseEntity<Object> baggage(@Valid @RequestBody BaggageRequest request,
                                          HttpServletRequest httpRequest) {
        try {
            printHeaders(httpRequest, "/api/orders/baggage");
            BaggageResponse response = flightService.purchaseBaggage(request);
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            return badRequest("Baggage purchase failed", e);
        }
    }

    private void printHeaders(HttpServletRequest httpRequest, String path) {
        System.out.println("=== Request Headers for " + path + " ===");
        httpRequest.getHeaderNames().asIterator().forEachRemaining(headerName ->
                logger.info("{}: {}", headerName, httpRequest.getHeader(headerName)));
    }

    private ResponseEntity<Object> badRequest(String error, Exception e) {
        Map<String, Object> errorResponse = new HashMap<>();
        errorResponse.put("error", error);
        errorResponse.put("message", e.getMessage());
        errorResponse.put("timestamp", LocalDateTime.now());
        return ResponseEntity.badRequest().body(errorResponse);
    }
}
