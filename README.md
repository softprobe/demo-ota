# travel-ota

机票 OTA 订票服务:航班搜索、下单、支付、退改签,下游对接航司开放接口
(sp-airline)。

## 技术栈

- Spring Boot 3 / Java 21
- H2 内存库 + 内嵌 Redis —— 单机自包含,无外部依赖
- 前端为 `resources/static` 下的多页应用

## 本地运行

```bash
cd travel-ota
mvn spring-boot:run    # http://localhost:8080
```

## 目录

- `src/main/java/org/example/controller` —— REST 入口(航班 / 订单 / 支付)
- `src/main/java/org/example/service` —— 业务逻辑(FlightService 等)
- `src/main/resources/static` —— 页面
