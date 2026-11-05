# Softprobe Web SDK

`softprobe-web-0.1.0.tgz` is the official `@softprobe/web` package built from
`softprobe/softprobe-js` commit `d400f1bcb5fb3629e33701b800e55c41928bedfc`.
The package was not published on npm when integrated.

Build from that checkout with:

```sh
npm ci --ignore-scripts
npm run build -w @softprobe/tracing -w @softprobe/web-record -w @softprobe/web
npm pack -w @softprobe/web --pack-destination /path/to/TravelAgentDemo/vendor
```

The bundled browser asset is served directly from the installed package.
