package org.example.ndc.http;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import feign.Headers;
import feign.Param;
import feign.RequestLine;

interface NdcFeignApi {

    @RequestLine("POST {path}")
    @Headers("Content-Type: application/json")
    JsonNode post(@Param("path") String path, ObjectNode body);
}
