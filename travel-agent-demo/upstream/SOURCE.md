# Upstream deployment snapshot

Repository: https://github.com/softprobe/deployment-k8s
Branch supplied by Onur: `019-explorer-e2e-graph`
Pinned commit retrieved: `c1885d713430f193a867e4772b85420d06f82b5e`
Source subtree: `home-server/`

Files downloaded verbatim via authenticated GitHub contents API:
- docker-staging.md
- docker-compose.staging.yaml
- obi-docker.yml
- travel-ui-web/index.html
- travel-ui-web/booking.html
- travel-ui-web/orders.html
- travel-ui-web/payment.html
- travel-ui-web/softprobe-session.js

The pinned branch differs from earlier `main` inspection: both `softprobe/sp-ota` and `softprobe/sp-airline` image tags are `v2.0.3`, and the web assets are in `travel-ui-web`, not `travel-ui`.

Do not edit these source snapshots. Local staging overrides and derived `.staging-web` assets belong elsewhere. Upstream pages contain the documented demo ingest configuration; they are not production credentials.
