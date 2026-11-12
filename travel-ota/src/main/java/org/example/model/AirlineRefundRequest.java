package org.example.model;

import com.airline.common.model.RefundRequest;
import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.ToString;

import java.math.BigDecimal;

/**
 * 发给航司 /refund/process 的退票请求:在乘客的退票请求基础上,带上平台按收费政策
 * 算出的手续费和净退款,供航司对账。
 *
 * <p>只在 travel-ota 里扩展,不改共享模型 —— 航司侧按默认配置忽略不认识的字段,
 * 不需要跟着发版。
 */
@Data
@EqualsAndHashCode(callSuper = true)
@ToString(callSuper = true)
public class AirlineRefundRequest extends RefundRequest {

    private BigDecimal cancellationFee;

    private BigDecimal netRefundAmount;

    public static AirlineRefundRequest of(RefundRequest source, BigDecimal cancellationFee, BigDecimal netRefundAmount) {
        AirlineRefundRequest r = new AirlineRefundRequest();
        r.setBookingId(source.getBookingId());
        r.setConfirmationNumber(source.getConfirmationNumber());
        r.setRefundReason(source.getRefundReason());
        r.setReasonDetails(source.getReasonDetails());
        r.setPassengerLastName(source.getPassengerLastName());
        r.setPassengerIds(source.getPassengerIds());
        r.setCancellationFee(cancellationFee);
        r.setNetRefundAmount(netRefundAmount);
        return r;
    }
}
