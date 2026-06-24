package org.example.ndc.http;

/**
 * Identifies which outbound HTTP stack to use for each NDC upstream call (E2E agent coverage).
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
