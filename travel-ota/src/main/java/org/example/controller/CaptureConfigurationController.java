package org.example.controller;

import java.util.Arrays;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** Runtime-only browser SDK configuration for the local session-capture demo. */
@RestController
public class CaptureConfigurationController {
    @Value("${SOFTPROBE_AGENT_API_KEY:}")
    private String agentApiKey;

    @Value("${SOFTPROBE_CAPTURE_ID:}")
    private String captureId;

    @Value("${SOFTPROBE_BASE_URL:}")
    private String baseUrl;

    @Value("${SOFTPROBE_API_ORIGINS:}")
    private String apiOrigins;

    @Value("${SOFTPROBE_ENVIRONMENT:local-e2e}")
    private String environment;

    @Value("${SOFTPROBE_MASK_TEXT_SELECTORS:}")
    private String maskTextSelectors;

    @Value("${SOFTPROBE_BLOCK_SELECTORS:}")
    private String blockSelectors;

    @GetMapping(value = "/api/capture/config", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<Map<String, Object>> captureConfig() {
        if (isBlank(agentApiKey) || isBlank(captureId) || isBlank(baseUrl) || isBlank(apiOrigins)) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .cacheControl(CacheControl.noStore())
                    .build();
        }

        Map<String, Object> config = Map.of(
                "apiKey", agentApiKey,
                "captureId", captureId,
                "baseUrl", baseUrl,
                "apiOrigins", split(apiOrigins),
                "environment", environment,
                "maskAllInputs", true,
                "maskTextSelectors", split(maskTextSelectors),
                "blockSelectors", split(blockSelectors));
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(config);
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    private static List<String> split(String value) {
        if (isBlank(value)) return List.of();
        return Arrays.stream(value.split(","))
                .map(String::trim)
                .filter(part -> !part.isEmpty())
                .distinct()
                .toList();
    }
}
