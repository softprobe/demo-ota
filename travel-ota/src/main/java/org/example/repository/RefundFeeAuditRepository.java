package org.example.repository;

import org.example.entity.RefundFeeAudit;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;

/**
 * 退票手续费审计仓库。写入用定向 INSERT 而不是 save():save 对已赋值主键的实体走 merge,
 * 会先 SELECT 一次,多出一条和业务无关的 SQL(理由同 {@link OrderRepository} 的说明)。
 */
public interface RefundFeeAuditRepository extends JpaRepository<RefundFeeAudit, String> {

    @Modifying
    @Transactional
    @Query(value = """
        insert into refund_fee_audit (id, booking_id, hours_until_departure, cancellation_fee, net_refund_amount)
        values (:id, :bookingId, :hoursUntilDeparture, :cancellationFee, :netRefundAmount)""",
        nativeQuery = true)
    int insertAudit(@Param("id") String id,
                    @Param("bookingId") String bookingId,
                    @Param("hoursUntilDeparture") Long hoursUntilDeparture,
                    @Param("cancellationFee") BigDecimal cancellationFee,
                    @Param("netRefundAmount") BigDecimal netRefundAmount);
}
