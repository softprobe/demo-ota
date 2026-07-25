package org.example.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * 订单实体 —— travel-ota 自己持久化的订单主数据。
 *
 * 用 JPA(H2)落库,SP agent 拦 JDBC,录制入口请求时能录到订单相关的 SQL 下游
 * (INSERT / SELECT / UPDATE)。字段是从 sp-airline /flights/book 返回的
 * {@link com.airline.common.model.BookingResponse} 里抽出的关键业务字段。
 */
@Entity
@Table(name = "orders")
@Getter
@Setter
public class Order {

    /**
     * 主键用 UUID(客户端生成)而非 IDENTITY 自增。IDENTITY 下 Hibernate insert 后要
     * 调 JDBC getGeneratedKeys() 从库里回读自增 id —— 回放时 insert 被 SP mock,
     * 但 generated-keys 结果集没有对应录制,Hibernate 报
     * "The database returned no natively generated identity value"。UUID 在 JVM 内
     * 生成,insert 不需要任何 DB 回读,录制/回放天然对称。
     */
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private String id;

    /** sp-airline 出票返回的订单号,业务主键 */
    @Column(nullable = false, unique = true)
    private String bookingId;

    /** PNR 确认号,面向乘客,查单用它 */
    @Column(unique = true)
    private String confirmationNumber;

    /** 订单状态:CONFIRMED / CHANGED / REFUNDED / CANCELLED */
    private String status;

    private String flightId;

    private String flightNumber;

    private LocalDateTime departureTime;

    /** 主乘客姓氏,查单/退票/改签校验用 */
    private String passengerLastName;

    @Column(precision = 12, scale = 2)
    private BigDecimal amount;

    private String currency;

    /** 支付状态:UNPAID / PAID */
    private String paymentStatus;

    private String cabinClass;

    private LocalDateTime createdAt;

    @OneToMany(mappedBy = "order", cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.EAGER)
    private List<Passenger> passengers = new ArrayList<>();

    public void addPassenger(Passenger passenger) {
        passenger.setOrder(this);
        this.passengers.add(passenger);
    }
}
