# Mono

It's an incredibly form-over-function skin, fully opinionated to my own tastes.

* The inspiration comes from the Zuriga T2 and Nothing OS.
* Quality-of-life features such as hold-to-wake and chime on complete comes directly from the Bestpresso skin.

Some screenshots, captured on simulator/browser, roughly matching the same layout of my tablet's screen (Samsung A11). 

<img width="997" height="596" alt="image" src="https://github.com/user-attachments/assets/2810a688-526b-4638-bf1d-16082cab120a" />

<img width="1036" height="635" alt="image" src="https://github.com/user-attachments/assets/18ef0465-b50e-4bfa-a835-72da945ca514" />

<img width="1037" height="636" alt="image" src="https://github.com/user-attachments/assets/a8c6a462-40fa-46be-83dd-0e261a126ae6" />

<img width="997" height="595" alt="image" src="https://github.com/user-attachments/assets/fe031591-7a8e-47fe-aedd-15df770c30fa" />


## Development

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
