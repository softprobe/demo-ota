# demo-ota · `demo-live` branch

Source of the **travel-ota** application actually running at
[demoair.softprobe.ai](https://demoair.softprobe.ai) (image `demo-travel-ota`).

This branch exists so the public Softprobe demo can bind a real, token-free git
remote whose contents match the deployed image byte-for-byte. It is an **orphan
branch** — unrelated to `main`, which holds a different (NDC-focused) variant of
the app. Do not merge between them.

The refund regression shown in the demo is injected at runtime, not by a commit:
`FlightService.java` → `isRefundRegressionEnabled() ? 48 : 24`, toggled by the
`SP_DEMO_REFUND_REGRESSION` env var on the canary deployment.
