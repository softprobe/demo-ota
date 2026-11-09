package org.example.ndc.http;

/**
 * Identifies the outbound HTTP operation handled by each transport.
 */
public enum NdcCallSite {
    SEARCH_AIRSHOPPING,
    BOOK_OFFER_PRICE,
    BOOK_ORDER_CREATE,
    PAY_ORDER_CHANGE,
    QUERY_ORDER_RETRIEVE,
    REFUND_ORDER_CANCEL,
    CHANGE_AIRSHOPPING,
    CHANGE_ORDER_CHANGE,
    BAGGAGE_SERVICE_LIST,
    BAGGAGE_ORDER_CHANGE
}
