package org.example.ndc.http;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.example.config.AirlineApiConfig;
import org.springframework.stereotype.Component;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;

@Component
public class JdkUrlConnectionNdcTransport implements NdcHttpTransport {

    private final AirlineApiConfig airlineApiConfig;

    public JdkUrlConnectionNdcTransport(AirlineApiConfig airlineApiConfig) {
        this.airlineApiConfig = airlineApiConfig;
    }

    @Override
    public JsonNode post(String url, ObjectNode body) {
        try {
            HttpURLConnection connection = (HttpURLConnection) URI.create(url).toURL().openConnection();
            connection.setRequestMethod("POST");
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setConnectTimeout(airlineApiConfig.getConnectionTimeout());
            connection.setReadTimeout(airlineApiConfig.getReadTimeout());
            byte[] payload = NdcJsonSupport.toBytes(body);
            try (OutputStream out = connection.getOutputStream()) {
                out.write(payload);
            }
            int status = connection.getResponseCode();
            InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            if (stream == null) {
                throw new RuntimeException("Empty NDC response from " + url + " (HTTP " + status + ")");
            }
            try (InputStream in = stream) {
                return NdcJsonSupport.parseBody(url, in);
            } finally {
                connection.disconnect();
            }
        } catch (RuntimeException e) {
            throw e;
        } catch (Exception e) {
            throw new RuntimeException("JDK HttpURLConnection NDC call failed: " + url, e);
        }
    }
}
