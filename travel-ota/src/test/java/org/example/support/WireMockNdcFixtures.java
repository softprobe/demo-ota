package org.example.support;

import com.github.tomakehurst.wiremock.junit5.WireMockExtension;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;

import static com.github.tomakehurst.wiremock.client.WireMock.aResponse;
import static com.github.tomakehurst.wiremock.client.WireMock.containing;
import static com.github.tomakehurst.wiremock.client.WireMock.equalToJson;
import static com.github.tomakehurst.wiremock.client.WireMock.post;
import static com.github.tomakehurst.wiremock.client.WireMock.urlPathEqualTo;

/**
 * Helpers for Softprobe-style rigid NDC stubs on a per-test-class {@link WireMockExtension}.
 */
public final class WireMockNdcFixtures {

    private WireMockNdcFixtures() {}

    public static void stubNdcPost(WireMockExtension ndc, String path, String fixtureClasspath) {
        ndc.stubFor(post(urlPathEqualTo("/ndc/v21.3" + path))
                .willReturn(aResponse()
                        .withStatus(200)
                        .withHeader("Content-Type", "application/json")
                        .withBody(readFixture(fixtureClasspath))));
    }

    public static void stubNdcPostMatchingBody(
            WireMockExtension ndc, String path, String bodySnippet, String fixtureClasspath) {
        ndc.stubFor(post(urlPathEqualTo("/ndc/v21.3" + path))
                .withRequestBody(containing(bodySnippet))
                .willReturn(aResponse()
                        .withStatus(200)
                        .withHeader("Content-Type", "application/json")
                        .withBody(readFixture(fixtureClasspath))));
    }

    public static void stubNdcPostExactJson(
            WireMockExtension ndc, String path, String requestJson, String fixtureClasspath) {
        ndc.stubFor(post(urlPathEqualTo("/ndc/v21.3" + path))
                .withRequestBody(equalToJson(requestJson, true, true))
                .willReturn(aResponse()
                        .withStatus(200)
                        .withHeader("Content-Type", "application/json")
                        .withBody(readFixture(fixtureClasspath))));
    }

    public static void stubNdcPostServerError(WireMockExtension ndc, String path) {
        ndc.stubFor(post(urlPathEqualTo("/ndc/v21.3" + path))
                .willReturn(aResponse()
                        .withStatus(500)
                        .withHeader("Content-Type", "application/json")
                        .withBody("{\"error\":\"upstream failure\"}")));
    }

    public static String readFixture(String classpath) {
        String resource = classpath.startsWith("/") ? classpath.substring(1) : classpath;
        try (InputStream in = WireMockNdcFixtures.class.getClassLoader().getResourceAsStream(resource)) {
            if (in == null) {
                throw new IllegalArgumentException("Missing fixture: " + resource);
            }
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }
}
