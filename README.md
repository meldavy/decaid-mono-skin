# Mono

A Decaid skin: white ground, a brown dot-matrix display for live data, serif for people, dots for the machine.
Visual rules: [`docs/STYLE.md`](docs/STYLE.md). Scenarios: [`docs/CONTROLS.md`](docs/CONTROLS.md).

```sh
npm install
npm run dev            # http://localhost:5173 — talks to Decaid on <host>:8080 (override: ?gateway=host[:port])
npm test               # unit tests
npm run package        # → mono.zip, installable in Decaid
```

End-to-end tests run against a real Decaid in simulate mode (needs an LF-line-ending Decaid checkout):

```sh
DECAID_DIR=/path/to/decaid scripts/decaid-sim.sh start
npm run test:e2e       # against the dev server
npm run test:install   # installs mono.zip into Decaid and tests the installed copy
```

## Releasing

Decaid installs a skin from a GitHub release by downloading the release's first `.zip` asset, so each release needs
the packaged skin attached:

```sh
npm run package                        # builds and writes mono.zip (skin-manifest.json at the zip root)
gh release create v0.1.0 mono.zip --title "Mono 0.1.0" --notes "…"
```

Bump `version` in `package.json` and `public/skin-manifest.json` together. Then install from Decaid's skin settings
with the repository (`owner/repo`).
