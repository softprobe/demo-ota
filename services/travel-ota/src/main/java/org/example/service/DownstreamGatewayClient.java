package org.example.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.Map;

@Service
public class DownstreamGatewayClient {

    public record PaymentAuthorization(
            String authorizationId, String status, String bookingId, BigDecimal amount, String currency) {}

    public record NotificationReceipt(String messageId, Boolean delivered) {}

    private final RestTemplate restTemplate;
    private final String paymentBaseUrl;
    private final String notificationBaseUrl;
    private final boolean skipEmail;
    private final boolean downstreamEnabled;

    public DownstreamGatewayClient(
            @Value("${app.payment.base-url:http://127.0.0.1:8082}") String paymentBaseUrl,
            @Value("${app.notification.base-url:http://127.0.0.1:8083}") String notificationBaseUrl,
            @Value("${app.fault.skip-email:false}") boolean skipEmail,
            @Value("${app.downstream.enabled:true}") boolean downstreamEnabled) {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(5000);
        factory.setReadTimeout(10000);
        this.restTemplate = new RestTemplate(factory);
        this.paymentBaseUrl = trimTrailingSlash(paymentBaseUrl);
        this.notificationBaseUrl = trimTrailingSlash(notificationBaseUrl);
        this.skipEmail = skipEmail;
        this.downstreamEnabled = downstreamEnabled;
    }

    public boolean isDownstreamEnabled() {
        return downstreamEnabled;
    }

    public boolean isSkipEmail() {
        return skipEmail;
    }

    public PaymentAuthorization authorizePayment(
            String bookingId, BigDecimal amount, String currency, String paymentMethod, String cardLast4) {
        if (!downstreamEnabled) {
            return null;
        }
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("bookingId", bookingId);
        payload.put("amount", amount);
        payload.put("currency", currency);
        payload.put("paymentMethod", paymentMethod);
        if (cardLast4 != null && !cardLast4.isBlank()) {
            payload.put("cardLast4", cardLast4);
        }
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        ResponseEntity<PaymentAuthorization> response = restTemplate.exchange(
                paymentBaseUrl + "/v1/payments/authorize",
                HttpMethod.POST,
                new HttpEntity<>(payload, headers),
                PaymentAuthorization.class);
        PaymentAuthorization body = response.getBody();
        if (!response.getStatusCode().is2xxSuccessful()
                || body == null
                || !"AUTHORIZED".equals(body.status())
                || body.authorizationId() == null
                || body.authorizationId().isBlank()) {
            throw new IllegalStateException("Payment authorization was rejected by payment gateway");
        }
        return body;
    }

    public void sendConfirmationIfEnabled(
            String bookingId, String confirmationNumber, String recipientEmail, String eventType) {
        if (!downstreamEnabled || skipEmail) {
            return;
        }
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("bookingId", bookingId);
        payload.put("confirmationNumber", confirmationNumber);
        if (recipientEmail != null && !recipientEmail.isBlank()) {
            payload.put("recipientEmail", recipientEmail);
        }
        payload.put("eventType", eventType);
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        ResponseEntity<NotificationReceipt> response = restTemplate.exchange(
                notificationBaseUrl + "/v1/notifications/confirmation",
                HttpMethod.POST,
                new HttpEntity<>(payload, headers),
                NotificationReceipt.class);
        NotificationReceipt body = response.getBody();
        if (!response.getStatusCode().is2xxSuccessful()
                || body == null
                || !Boolean.TRUE.equals(body.delivered())) {
            throw new IllegalStateException("Confirmation notification delivery failed");
        }
    }

    private static String trimTrailingSlash(String url) {
        if (url == null || url.isBlank()) {
            return "";
        }
        String trimmed = url.trim();
        return trimmed.endsWith("/") ? trimmed.substring(0, trimmed.length() - 1) : trimmed;
    }
}
