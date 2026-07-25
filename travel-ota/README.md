# 机票预订系统 (Travel OTA)

基于JDK21和Spring Boot 3.x构建的机票预订系统，包含完整的前后端功能。

## 功能特性

### 前端页面
1. **搜索页面** (`/`) - 机票搜索界面
   - 行程类型选择（单程/往返）
   - 出发地和目的地输入
   - 出发日期选择
   - 乘客人数和舱等选择

2. **列表页面** (`/list.html`) - 航班搜索结果
   - 日期价格导航
   - 航班列表展示
   - 不同运价选项
   - 排序和筛选功能

3. **详情页面** (`/detail.html`) - 航班详情
   - 航班详细信息
   - 不同品牌运价对比
   - 行李和设施信息

4. **预订页面** (`/booking.html`) - 乘客信息填写
   - 乘客信息表单
   - 联系人信息
   - 价格摘要

5. **支付页面** (`/payment.html`) - 支付处理
   - 多种支付方式
   - 支付状态显示
   - 机票出票结果

### 后端接口
1. **搜索接口** (`POST /api/flights/search`)
   - 根据搜索条件查询航班
   - 返回航班列表和价格信息

2. **预订接口** (`POST /api/flights/book`)
   - 根据选择的运价发起预订
   - 生成PNR号码

3. **支付出票接口** (`POST /api/flights/payandissue`)
   - 根据PNR发起支付
   - 出票成功后返回机票号码

## 技术栈

### 后端
- **JDK 21** - Java开发环境
- **Spring Boot 3.2.0** - 应用框架
- **Spring Web** - REST API支持
- **Spring Validation** - 数据验证
- **Lombok** - 代码简化
- **Jackson** - JSON处理

### 前端
- **HTML5/CSS3** - 页面结构和样式
- **JavaScript (ES6+)** - 交互逻辑
- **Bootstrap 5** - UI框架
- **Font Awesome** - 图标库

## 项目结构

```
travel-ota/
├── src/
│   ├── main/
│   │   ├── java/org/example/
│   │   │   ├── TravelOtaApplication.java    # 主应用类
│   │   │   ├── controller/
│   │   │   │   └── FlightController.java    # REST控制器
│   │   │   ├── model/                       # 数据模型
│   │   │   │   ├── FlightSearchRequest.java
│   │   │   │   ├── FlightSearchResponse.java
│   │   │   │   ├── BookingRequest.java
│   │   │   │   ├── BookingResponse.java
│   │   │   │   ├── PaymentRequest.java
│   │   │   │   └── PaymentResponse.java
│   │   │   └── service/
│   │   │       └── FlightService.java       # 业务逻辑
│   │   └── resources/
│   │       ├── static/                      # 静态资源
│   │       │   ├── index.html              # 搜索页面
│   │       │   ├── list.html               # 列表页面
│   │       │   ├── detail.html             # 详情页面
│   │       │   ├── booking.html            # 预订页面
│   │       │   ├── payment.html            # 支付页面
│   │       │   └── js/                     # JavaScript文件
│   │       │       ├── search.js
│   │       │       ├── list.js
│   │       │       ├── detail.js
│   │       │       ├── booking.js
│   │       │       └── payment.js
│   │       └── application.yml             # 配置文件
│   └── test/                               # 测试代码
├── pom.xml                                # Maven配置
└── README.md                              # 项目说明
```

## 快速开始

### 环境要求
- JDK 21+
- Maven 3.6+

### 运行步骤

1. **克隆项目**
   ```bash
   git clone <repository-url>
   cd travel-ota
   ```

2. **编译项目**
   ```bash
   mvn clean compile
   ```

3. **运行应用**
   ```bash
   mvn spring-boot:run
   ```

4. **访问应用**
   - 打开浏览器访问: http://localhost:8080
   - 开始使用机票预订系统

### 开发模式
```bash
# 使用Maven运行（支持热重载）
mvn spring-boot:run

# 或者打包后运行
mvn clean package
java -jar target/travel-ota-1.0-SNAPSHOT.jar
```

## API文档

### 1. 航班搜索
```http
POST /api/flights/search
Content-Type: application/json

{
  "fromCity": "Frankfurt",
  "toCity": "London",
  "departureDate": "2025-08-22",
  "tripType": "ONE_WAY",
  "cabinClass": "ECONOMY",
  "passengerInfo": {
    "adults": 1,
    "children": 0,
    "infants": 0
  }
}
```

### 2. 航班预订
```http
POST /api/flights/book
Content-Type: application/json

{
  "fareId": "FARE123456",
  "flightId": "FL123456",
  "passengers": [
    {
      "passengerType": "ADULT",
      "lastName": "张",
      "firstName": "三",
      "documentType": "PASSPORT",
      "documentNumber": "E12345678"
    }
  ],
  "contactInfo": {
    "phone": "13800138000",
    "email": "zhangsan@example.com"
  }
}
```

### 3. 支付出票
```http
POST /api/flights/payandissue
Content-Type: application/json

{
  "pnr": "ABC123",
  "paymentMethod": "CREDIT_CARD",
  "paymentInfo": {
    "cardNumber": "1234567890123456",
    "cardHolderName": "张三",
    "expiryMonth": "12",
    "expiryYear": "2025",
    "cvv": "123"
  }
}
```

## 模拟数据

系统使用模拟数据，无需数据库配置：
- 航班信息：British Airways等航空公司
- 运价选项：多个供应商的价格对比
- 预订流程：生成PNR和机票号码
- 支付处理：模拟支付成功

## 特性说明

### 响应式设计
- 支持桌面和移动设备
- Bootstrap 5响应式布局
- 现代化的UI设计

### 用户体验
- 直观的搜索界面
- 详细的航班信息展示
- 流畅的预订流程
- 安全的支付体验

### 技术特点
- RESTful API设计
- 数据验证和错误处理
- 跨域支持
- 模块化代码结构

## 开发说明

### 添加新功能
1. 在`model`包中添加数据模型
2. 在`service`包中实现业务逻辑
3. 在`controller`包中添加API接口
4. 在前端添加对应的页面和交互

### 自定义配置
修改`application.yml`文件来调整：
- 服务器端口
- 日志级别
- 模拟数据延迟
- 其他应用配置

## 许可证

本项目仅供学习和演示使用。

## 联系方式

如有问题或建议，请联系开发团队。 