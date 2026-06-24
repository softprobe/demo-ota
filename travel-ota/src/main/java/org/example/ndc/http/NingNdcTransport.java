package org.example.ndc.http;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.ning.http.client.AsyncHttpClient;
import com.ning.http.client.ListenableFuture;
import com.ning.http.client.Response;
import org.springframework.stereotype.Component;

import java.io.InputStream;
import java.util.concurrent.CompletableFuture;

/**
 * Ning async-http-client transport for NDC refund ({@code /ordercancel}).
 * Waits on a {@link CompletableFuture} instead of {@link ListenableFuture#get()} so agent
 * recording uses the completion-listener path (non-blocking Ning usage).
 */
@Component
public class NingNdcTransport implements NdcHttpTransport {

    private final AsyncHttpClient asyncHttpClient;

    public NingNdcTransport(AsyncHttpClient ningAsyncHttpClient) {
        this.asyncHttpClient = ningAsyncHttpClient;
    }

    @Override
    public JsonNode post(String url, ObjectNode body) {
        try {
            CompletableFuture<JsonNode> parsed = new CompletableFuture<>();
            ListenableFuture<Response> future = asyncHttpClient.preparePost(url)
                    .setHeader("User-Agent", "travel-ota/1.0 (Softprobe demo)")
                    .setHeader("Content-Type", "application/json")
                    .setBody(NdcJsonSupport.MAPPER.writeValueAsString(body))
                    .execute();
            future.addListener(() -> completeFromResponse(url, future, parsed), Runnable::run);
            return parsed.get();
        } catch (RuntimeException e) {
            throw e;
        } catch (Exception e) {
            throw new RuntimeException("Ning async-http-client NDC call failed: " + url, e);
        }
    }

    private static void completeFromResponse(
            String url, ListenableFuture<Response> future, CompletableFuture<JsonNode> parsed) {
        try {
            if (future.isCancelled()) {
                parsed.completeExceptionally(new RuntimeException("Ning NDC call cancelled: " + url));
                return;
            }
            Response response = future.get();
            InputStream stream = response.getResponseBodyAsStream();
            if (stream == null) {
                parsed.completeExceptionally(new RuntimeException("Empty NDC response from " + url));
                return;
            }
            try (InputStream in = stream) {
                parsed.complete(NdcJsonSupport.parseBody(url, in));
            }
        } catch (Exception e) {
            parsed.completeExceptionally(
                    e instanceof RuntimeException
                            ? (RuntimeException) e
                            : new RuntimeException("Ning async-http-client NDC call failed: " + url, e));
        }
    }
}
