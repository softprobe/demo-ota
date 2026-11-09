package org.example.ndc;

import org.example.model.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.example.ndc.http.NdcCallSite;
import org.example.ndc.http.NdcHttpRouter;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

@Service
public class NdcAirlineClient {

    @Autowired
    private NdcHttpRouter ndcHttpRouter;

    @Autowired
    private NdcMapper ndcMapper;

    public FlightSearchResponse searchFlights(FlightSearchRequest request) {
        ObjectNode body = ndcMapper.toAirShoppingRq(request);
        JsonNode rs = ndcHttpRouter.post(NdcCallSite.SEARCH_AIRSHOPPING, "/airshopping", body);
        return ndcMapper.fromAirShoppingRs(rs);
    }

    public BookingResponse bookFlight(BookingRequest request) {
        ndcHttpRouter.post(
                NdcCallSite.BOOK_OFFER_PRICE,
                "/offerprice",
                ndcMapper.toOfferPriceRq(request.getFlightId(), request.getFareId()));
        JsonNode rs = ndcHttpRouter.post(
                NdcCallSite.BOOK_ORDER_CREATE,
                "/ordercreate",
                ndcMapper.toOrderCreateRq(request));
        return ndcMapper.fromOrderViewRs(rs);
    }

    public PaymentResponse payAndIssue(PaymentRequest request) {
        JsonNode rs = ndcHttpRouter.post(
                NdcCallSite.PAY_ORDER_CHANGE,
                "/orderchange",
                ndcMapper.toPaymentOrderChangeRq(request));
        return ndcMapper.fromPaymentRs(rs);
    }

    public BookingResponse queryOrder(OrderQueryRequest request) {
        JsonNode rs = ndcHttpRouter.post(
                NdcCallSite.QUERY_ORDER_RETRIEVE,
                "/orderretrieve",
                ndcMapper.toOrderRetrieveRq(request));
        return ndcMapper.fromOrderViewRs(rs);
    }

    public RefundResponse processRefund(RefundRequest request) {
        JsonNode rs = ndcHttpRouter.post(
                NdcCallSite.REFUND_ORDER_CANCEL,
                "/ordercancel",
                ndcMapper.toOrderCancelRq(request));
        return ndcMapper.fromRefundRs(rs);
    }

    public ChangeFlightResponse changeFlight(ChangeFlightRequest request) {
        if (request.getNewDepartureCity() != null && request.getNewArrivalCity() != null) {
            ndcHttpRouter.post(
                    NdcCallSite.CHANGE_AIRSHOPPING,
                    "/airshopping",
                    ndcMapper.toAirShoppingRqFromChange(request));
        }
        JsonNode rs = ndcHttpRouter.post(
                NdcCallSite.CHANGE_ORDER_CHANGE,
                "/orderchange",
                ndcMapper.toFlightChangeRq(request));
        return ndcMapper.fromChangeRs(rs);
    }

    public BaggageResponse purchaseBaggage(BaggageRequest request) {
        ndcHttpRouter.post(
                NdcCallSite.BAGGAGE_SERVICE_LIST,
                "/servicelist",
                ndcMapper.toServiceListRq(request));
        JsonNode rs = ndcHttpRouter.post(
                NdcCallSite.BAGGAGE_ORDER_CHANGE,
                "/orderchange",
                ndcMapper.toBaggageOrderChangeRq(request));
        return ndcMapper.fromBaggageRs(rs);
    }
}
