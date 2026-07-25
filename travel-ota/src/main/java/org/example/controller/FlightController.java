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
 * 航班查询入口。只负责「搜航班」,订单全生命周期在 {@link OrderController}。
 */
@RestController
@RequestMapping("/api/flights")
@CrossOrigin(origins = "*")
public class FlightController {
    private static final Logger logger = LoggerFactory.getLogger(FlightController.class);

    @Autowired
    private FlightService flightService;

    /** 搜航班:Redis 缓存 →(未命中)sp-airline → 回填缓存 */
    @PostMapping("/search")
    public ResponseEntity<Object> searchFlights(@Valid @RequestBody FlightSearchRequest request,
                                                HttpServletRequest httpRequest) {
        try {
            printHeaders(httpRequest, "/api/flights/search");
            FlightSearchResponse response = flightService.searchFlights(request);
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            return badRequest("Flight search failed", e);
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
