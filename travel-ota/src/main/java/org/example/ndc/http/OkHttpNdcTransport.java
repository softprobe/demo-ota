package org.example.ndc.http;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import org.springframework.stereotype.Component;

import java.io.InputStream;

@Component
public class OkHttpNdcTransport implements NdcHttpTransport {

    private static final MediaType JSON = MediaType.parse("application/json; charset=utf-8");

    private final OkHttpClient okHttpClient;

    public OkHttpNdcTransport(OkHttpClient okHttpClient) {
        this.okHttpClient = okHttpClient;
    }

    @Override
    public JsonNode post(String url, ObjectNode body) {
        Request request = new Request.Builder()
                .url(url)
                .post(RequestBody.create(NdcJsonSupport.toBytes(body), JSON))
                .build();
        try (Response response = okHttpClient.newCall(request).execute()) {
            if (response.body() == null) {
                throw new RuntimeException("Empty NDC response from " + url);
            }
            try (InputStream in = response.body().byteStream()) {
                return NdcJsonSupport.parseBody(url, in);
            }
        } catch (RuntimeException e) {
            throw e;
        } catch (Exception e) {
            throw new RuntimeException("OkHttp NDC call failed: " + url, e);
        }
    }
}
