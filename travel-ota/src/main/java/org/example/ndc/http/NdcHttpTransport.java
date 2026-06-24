package org.example.ndc.http;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

public interface NdcHttpTransport {

    JsonNode post(String url, ObjectNode body);
}
