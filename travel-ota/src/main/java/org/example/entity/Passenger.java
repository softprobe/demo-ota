package org.example.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

/**
 * 乘客实体 —— 与订单 {@link Order} 多对一。随订单一起 INSERT,
 * 让 SP 录制的 SQL 下游包含关联表写入。
 */
@Entity
@Table(name = "passengers")
@Getter
@Setter
public class Passenger {

    /** UUID 主键,理由同 Order.id —— IDENTITY 的 getGeneratedKeys 回读无法被回放 mock。 */
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private String id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "order_id")
    private Order order;

    private String firstName;

    private String lastName;

    private String documentNumber;

    private String seatNumber;

    /** ADULT / CHILD / INFANT */
    private String passengerType;
}
