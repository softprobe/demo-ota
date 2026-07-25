package org.example.repository;

import org.example.entity.Order;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

import java.util.Optional;

/**
 * 订单仓库 —— Spring Data JPA。方法调用背后是 JDBC SQL,SP agent 拦得到,
 * 录制/回放时作为 DB 下游 span 出现。
 *
 * <p>状态流转一律用下面的定向 UPDATE,而不是 save(order):save 走 JPA merge,
 * 会级联比对 EAGER 的 passengers 集合,回放时可能产生录制里不存在的
 * select/insert(mock 无从匹配,直接炸)。定向 UPDATE 的 SQL 序列在录制与回放
 * 中逐条对称,是回放友好的写法。
 */
public interface OrderRepository extends JpaRepository<Order, String> {

    Optional<Order> findByBookingId(String bookingId);

    Optional<Order> findByConfirmationNumber(String confirmationNumber);

    @Modifying
    @Transactional
    @Query("update Order o set o.paymentStatus = :status where o.bookingId = :bookingId")
    int updatePaymentStatus(@Param("bookingId") String bookingId, @Param("status") String status);

    @Modifying
    @Transactional
    @Query("update Order o set o.status = :status where o.bookingId = :bookingId")
    int updateStatus(@Param("bookingId") String bookingId, @Param("status") String status);

    @Modifying
    @Transactional
    @Query("""
        update Order o set o.flightId = :flightId, o.flightNumber = :flightNumber,
               o.departureTime = :departureTime, o.cabinClass = :cabinClass,
               o.confirmationNumber = :confirmationNumber, o.status = 'CHANGED'
        where o.bookingId = :bookingId""")
    int updateFlightChange(@Param("bookingId") String bookingId,
                           @Param("flightId") String flightId,
                           @Param("flightNumber") String flightNumber,
                           @Param("departureTime") java.time.LocalDateTime departureTime,
                           @Param("cabinClass") String cabinClass,
                           @Param("confirmationNumber") String confirmationNumber);
}
