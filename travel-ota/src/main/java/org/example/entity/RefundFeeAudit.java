package org.example.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

import java.math.BigDecimal;

/**
 * 退票手续费审计 —— 每笔退票按什么口径扣了多少,留一条底,便于手续费争议排查。
 *
 * <p>只用来让 Hibernate 建表;写入走 {@link org.example.repository.RefundFeeAuditRepository}
 * 的定向 INSERT,主键在 JVM 里生成(理由同 {@link Order#getId()} 的注释:不依赖数据库回读)。
 */
@Entity
@Table(name = "refund_fee_audit")
@Getter
@Setter
public class RefundFeeAudit {

    @Id
    private String id;

    @Column(nullable = false)
    private String bookingId;

    private Long hoursUntilDeparture;

    private BigDecimal cancellationFee;

    private BigDecimal netRefundAmount;
}
