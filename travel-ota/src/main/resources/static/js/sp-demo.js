/**
 * Softprobe live demo的引导层。
 *
 * 这个文件只做「引导」,不碰 OTA 自身业务逻辑:
 *   1. 所有页面顶部插一条说明横幅(讲清这是 demo、操作会被录制);
 *   2. 首页额外插一张「一键体验」卡片 —— 自动串起 搜Flight → 下单 → 支付 → 退票
 *      四次真实调用,免去访客手工走完五个页面(没人有耐心)。
 *
 * 为什么搜「明天」的Flight:Refund fee按距起飞时长分档,24-48h 是中间档。
 * 演示要展示的代码回归正是把这一档的下界从 24h 改成 48h,所以订明天的票、
 * 立即退,才落在能看出差异的区间里。
 */
(function () {
  "use strict";

  var WORKBENCH_URL = "https://app.softprobe.ai/sp/";

  // ---------------------------------------------------------------- styles
  var CSS = [
    ".sp-bar{position:sticky;top:0;z-index:1080;background:#0f172a;color:#e2e8f0;",
    "font-size:13px;line-height:1.5;padding:8px 16px;display:flex;align-items:center;",
    "justify-content:center;gap:14px;flex-wrap:wrap}",
    ".sp-bar b{color:#fff;font-weight:600}",
    ".sp-bar a{color:#a5b4fc;text-decoration:none;font-weight:600;white-space:nowrap}",
    ".sp-bar a:hover{color:#c7d2fe;text-decoration:underline}",

    ".sp-card{background:#fff;border-radius:16px;padding:28px 32px;margin-top:28px;",
    "box-shadow:0 12px 32px rgba(15,23,42,.12);border:1px solid #e2e8f0}",
    ".sp-card h4{font-size:19px;font-weight:700;color:#0f172a;margin:0 0 10px}",
    ".sp-card p{font-size:14px;color:#475569;line-height:1.7;margin:0 0 18px}",
    ".sp-btn{background:linear-gradient(45deg,#667eea,#764ba2);color:#fff;border:none;",
    "border-radius:10px;padding:12px 26px;font-size:15px;font-weight:600;cursor:pointer;",
    "transition:transform .15s ease,box-shadow .15s ease}",
    ".sp-btn:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 8px 18px rgba(102,126,234,.35)}",
    ".sp-btn:disabled{opacity:.6;cursor:not-allowed}",

    ".sp-steps{list-style:none;margin:18px 0 0;padding:0;font-size:14px}",
    ".sp-steps li{display:flex;align-items:center;gap:10px;padding:7px 0;color:#94a3b8}",
    ".sp-steps li.run{color:#4f46e5;font-weight:600}",
    ".sp-steps li.ok{color:#0f172a}",
    ".sp-steps li.err{color:#dc2626}",
    ".sp-dot{width:18px;height:18px;border-radius:50%;border:2px solid currentColor;",
    "display:inline-flex;align-items:center;justify-content:center;font-size:11px;flex:0 0 auto}",
    ".sp-steps li.ok .sp-dot{background:#16a34a;border-color:#16a34a;color:#fff}",
    ".sp-steps li.err .sp-dot{background:#dc2626;border-color:#dc2626;color:#fff}",

    ".sp-result{margin-top:20px;padding:16px 18px;border-radius:12px;background:#f1f5f9;",
    "border:1px solid #e2e8f0;font-size:14px;color:#0f172a}",
    ".sp-result .sp-kv{display:flex;justify-content:space-between;padding:4px 0}",
    ".sp-result .sp-kv span:last-child{font-weight:600}",
  ].join("");

  // ------------------------------------------------------------- utilities
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function post(path, body) {
    var headers = { "Content-Type": "application/json" };
    // 复用页面已有的会话标识,让一键体验产生的流量和手工操作同源
    if (typeof getSessionId === "function") headers["x-sp-session-id"] = getSessionId();
    return fetch(path, { method: "POST", headers: headers, body: JSON.stringify(body) }).then(function (r) {
      if (!r.ok) throw new Error(path + " returned " + r.status);
      return r.json();
    });
  }

  function money(v, cur) {
    if (v == null) return "—";
    return (cur === "CNY" ? "¥" : cur ? cur + " " : "") + Number(v).toFixed(2);
  }

  // ------------------------------------------------------------------ 横幅
  function mountBar() {
    var bar = el("div", "sp-bar");
    bar.innerHTML =
      '<span><b>Softprobe live demo</b> · This booking system runs the SP Agent — every action you take is recorded as real traffic</span>' +
      '<a href="' + WORKBENCH_URL + '" target="_blank" rel="noopener">See the recordings in the workbench →</a>';
    document.body.insertBefore(bar, document.body.firstChild);
  }

  // ------------------------------------------------------- 一键体验(首页)
  var STEPS = [
    { key: "search", label: "Search tomorrow's flights" },
    { key: "book", label: "Create order" },
    { key: "pay", label: "Pay & issue ticket" },
    { key: "refund", label: "Request refund" },
  ];

  function mountOneClick() {
    var card = el("div", "sp-card");
    card.innerHTML =
      "<h4>One-click tour: watch Softprobe catch a code regression</h4>" +
      "<p>No need to click through every page. One tap runs the full flow — search → book → pay → refund — as four real calls," +
      " all recorded by the SP Agent. Then replay this real traffic against the new code in the workbench" +
      " and see how it catches the refund-fee calculation difference.</p>";

    var btn = el("button", "sp-btn", "Start the tour");
    btn.type = "button";
    card.appendChild(btn);

    var list = el("ul", "sp-steps");
    STEPS.forEach(function (s) {
      var li = el("li");
      li.id = "sp-step-" + s.key;
      li.appendChild(el("span", "sp-dot", ""));
      li.appendChild(el("span", null, s.label));
      list.appendChild(li);
    });
    list.style.display = "none";
    card.appendChild(list);

    var result = el("div", "sp-result");
    result.style.display = "none";
    card.appendChild(result);

    btn.addEventListener("click", function () {
      btn.disabled = true;
      btn.textContent = "Running…";
      list.style.display = "";
      result.style.display = "none";
      run(list, result)
        .then(function () {
          btn.textContent = "Run again";
          btn.disabled = false;
        })
        .catch(function () {
          btn.textContent = "Retry";
          btn.disabled = false;
        });
    });

    // 插在搜索表单所在的容器之前,让它成为首页第一眼看到的东西
    var anchor = document.querySelector(".search-container");
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(card, anchor);
    else document.querySelector(".container").appendChild(card);
  }

  function mark(key, state) {
    var li = document.getElementById("sp-step-" + key);
    if (!li) return;
    li.className = state;
    var dot = li.querySelector(".sp-dot");
    if (dot) dot.textContent = state === "ok" ? "✓" : state === "err" ? "!" : "";
  }

  function tomorrow() {
    var d = new Date(Date.now() + 24 * 3600 * 1000);
    return d.toISOString().slice(0, 10);
  }

  function run(list, result) {
    STEPS.forEach(function (s) { mark(s.key, ""); });
    var ctx = {};

    mark("search", "run");
    return post("/api/flights/search", {
      fromCity: "LHR",
      toCity: "CDG",
      departureDate: tomorrow(),
      tripType: "ONE_WAY",
      cabinClass: "ECONOMY",
      passengerInfo: { adults: 1, children: 0, infants: 0 },
    })
      .then(function (res) {
        var flight = (res.flights || [])[0];
        var fare = flight && (flight.fareOptions || [])[0];
        if (!flight || !fare) throw new Error("No bookable flight found");
        ctx.flight = flight;
        ctx.fare = fare;
        mark("search", "ok");

        mark("book", "run");
        return post("/api/orders", {
          flightId: flight.flightId,
          fareId: fare.fareId,
          passengers: [{
            passengerType: "ADULT",
            firstName: "Demo",
            lastName: "Visitor",
            documentType: "PASSPORT",
            documentNumber: "P" + Math.floor(Math.random() * 9e7 + 1e7),
          }],
          contactInfo: { phone: "13800000000", email: "demo@softprobe.ai" },
        });
      })
      .then(function (booking) {
        if (!booking || !booking.bookingId) throw new Error("Booking did not return an order number");
        ctx.booking = booking;
        mark("book", "ok");

        mark("pay", "run");
        // 支付接口校验较严:金额/币种/卡信息都是必填(见 airline-common PaymentRequest)。
        // 金额优先取下单返回的实付金额,取不到再退回搜索时选中的票价。
        var pay = booking.paymentInfo || {};
        return post("/api/orders/pay", {
          bookingId: booking.bookingId,
          paymentMethod: "CREDIT_CARD",
          amount: pay.amount != null ? pay.amount : ctx.fare.price,
          currency: pay.currency || ctx.fare.currency || "EUR",
          paymentDetails: {
            cardNumber: "4111111111111111",
            cardHolderName: "Demo Visitor",
            expiryDate: "12/28",
            cvv: "123",
          },
        });
      })
      .then(function () {
        mark("pay", "ok");

        mark("refund", "run");
        // refundReason 取 PERSONAL_REASON:SCHEDULE_CHANGE 免手续费、EMERGENCY 固定 10%,
        // 只有个人原因才按「距起飞时长」分档 —— 那才是这次演示要展示的回归点。
        return post("/api/orders/refund", {
          bookingId: ctx.booking.bookingId,
          confirmationNumber: ctx.booking.confirmationNumber,
          refundReason: "PERSONAL_REASON",
          passengerLastName: "Visitor",
        });
      })
      .then(function (refund) {
        mark("refund", "ok");
        ctx.refund = refund;
        renderResult(result, ctx);
      })
      .catch(function (err) {
        var running = STEPS.filter(function (s) {
          var li = document.getElementById("sp-step-" + s.key);
          return li && li.className === "run";
        })[0];
        if (running) mark(running.key, "err");
        result.style.display = "";
        result.innerHTML =
          '<div style="color:#dc2626;font-weight:600;margin-bottom:6px">This step failed</div>' +
          '<div style="color:#475569">' + (err && err.message ? err.message : "Unknown error") + "</div>";
        throw err;
      });
  }

  function renderResult(result, ctx) {
    var f = ctx.flight, r = ctx.refund || {}, b = ctx.booking || {};
    var cur = r.currency || (ctx.fare && ctx.fare.currency) || "";
    result.style.display = "";
    result.innerHTML =
      '<div style="font-weight:700;margin-bottom:10px">Done — these 4 calls were recorded to Softprobe</div>' +
      '<div class="sp-kv"><span>Flight</span><span>' + (f.airlineName || "") + " " + (f.flightNumber || "") + "</span></div>" +
      '<div class="sp-kv"><span>Confirmation no.</span><span>' + (b.confirmationNumber || b.bookingId || "—") + "</span></div>" +
      '<div class="sp-kv"><span>Refund fee</span><span>' + money(r.cancellationFee, cur) + "</span></div>" +
      '<div class="sp-kv"><span>Net refund</span><span>' + money(r.netRefundAmount, cur) + "</span></div>" +
      '<div style="margin-top:16px"><a class="sp-btn" style="display:inline-block;text-decoration:none" ' +
      'href="' + WORKBENCH_URL + '" target="_blank" rel="noopener">See these recordings in the workbench →</a></div>';
  }

  // ------------------------------------------------------------------ boot
  function boot() {
    var style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);
    mountBar();
    // 首页的判定:有搜索表单就是首页
    if (document.getElementById("searchForm")) mountOneClick();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
