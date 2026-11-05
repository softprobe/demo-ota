# Travel agent demo repository migration

## Canonical application repository

All new travel-agent demo application changes belong in **[softprobe/demo-ota](https://github.com/softprobe/demo-ota)**, under `travel-agent-demo/`.

This import supersedes the misplaced application PR [deployment-k8s#55](https://github.com/softprobe/deployment-k8s/pull/55). It contains the complete latest application, not just the final policy change:

- isolated OpenCode runtime and allowlisted travel tools;
- browser chat and real synthetic booking API adapter;
- browser, agent/tool and OBI HTTP correlation plus the Session forwarder;
- manager approval above $600 USD, explanation dialog and request-local silent-failure simulation;
- evidence-gated Finding builder and optional local read-only Explorer adapter;
- all Node/forwarder tests, pinned dependency files, upstream provenance snapshots and the vendored browser SDK;
- public-demo implementation stories and acceptance criteria.

Source revision: `softprobe/deployment-k8s@83153068add5d7ed1b984aed4fc26179afc1062b`, subtree `home-server/travel-agent-demo/`.

The functional source, tests, dependency lockfile, upstream snapshots and SDK archive are preserved byte-for-byte. Documentation paths were adapted, the README's stale four-call description was corrected to match the existing 35-call code limit, and CI was relocated to the new directory. No runtime limits or application behavior changed as part of this move.

## What is deliberately not moved or changed

- **No private runtime state:** `.runtime/`, credentials, conversations, reservations, local builds, `node_modules/` and local verification artifacts are excluded. The existing local demo continues running from its current directory, with its state intact.
- **No Java/NDC replacement:** the existing `travel-ota/` module, its Maven files and Bill's [demo-ota#6](https://github.com/softprobe/demo-ota/pull/6) work are untouched. The imported agent demo retains its verified Docker image/API contract; it does not silently switch to a different backend.
- **No merged-history rewrite:** [deployment-k8s#52](https://github.com/softprobe/deployment-k8s/pull/52) and [#53](https://github.com/softprobe/deployment-k8s/pull/53) are already merged infrastructure/staging changes. They remain intact. Their pinned demo recipes/assets are included here as documented source snapshots, not deleted from the deployment repository.
- **Shared Explorer dependency:** [sp-llm#77](https://github.com/softprobe/sp-llm/pull/77) edits the actual shared Explorer application (`apps/explorer/src/`), not this demo's code. It remains an explicitly linked cross-repository dependency. Moving those edits into this Java/demo repository would not update Explorer. Do not silently close or duplicate it; confirm ownership with Bill before rerouting that separate application change.

The old application PR should be closed with a link to the replacement only after this repository's PR and exact-head checks are verified. Keep its branch and discussion as provenance; do not force-push or delete merged history.

## Verification

From `travel-agent-demo/`:

```sh
npm ci --ignore-scripts
npm test
npm run check
```

The relocated Node suite passes **230 tests**. The unchanged forwarder passes **26 tests** with Python 3.12 and its pinned requirements:

```sh
cd tracing-forwarder
python -m pip install -r requirements.txt
PYTHONPATH=. python -m unittest discover -s tests -v
```

CI runs both suites. Tests use offline fixtures and local test servers; no model calls, live booking tests or deployments are required for this relocation.
