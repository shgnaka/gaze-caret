# gaze-caret

Experimental webcam-based gaze estimation and caret control that coexist with Vimium-C.

The goal is to start text selection near the place you are looking at, then use the keyboard to adjust it precisely.

The planned extension will own caret placement, movement, and basic selection while Vimium-C handles normal browsing. Vimium-C will not be forked. A settings tool will import the user's Vimium-C JSON, preview keybinding conflicts and adjustments, and export a compatible JSON for re-import into Vimium-C.

## Project status

Experimental browser application. It guides camera placement confirmation, personal calibration, independent validation, practice, measured trials, breaks, and result sharing. A mouse-driven demo runs without a camera. Personal gaze accuracy has not been measured yet.

The first milestone is a standalone browser experiment using a pretrained MediaPipe face/iris detector and a custom, CPU-trainable regression model. It will measure whether webcam gaze can identify text lines under normal reading conditions.

## Requirements

- [Requirements and scope](docs/requirements.md) — product goal, milestone boundaries, functional requirements, data contracts, and implementation decisions.
- [Validation plan](docs/validation-plan.md) — acceptance scenarios, human experiments, metrics, and advancement criteria.
- [Camera placement and complex layouts](docs/environment-and-layout-validation.md) — setup confirmation, calibration validity, robustness evaluation, and staged page fixtures.
- [Experiment runner](docs/experiment-runner.md) — the working flow, GitHub Pages deployment, explicit result sharing, and measurement boundaries.
- [Diagnostic logging TDD](docs/tdd-diagnostics.md) — the automatic basic aggregate boundary, retry behavior, and manual detailed-log path.
- [Vimium-C coexistence](docs/vimium-c-coexistence.md) — independent caret control, key ownership, and settings JSON conversion.

These documents form the initial requirements baseline. Numerical experiment settings are starting values, not demonstrated accuracy or performance claims.

## Milestones

1. **M0 — Gaze experiment:** camera lifecycle, calibration, local learning, independent validation, and text-line targeting.
2. **M1 — Text selection experiment:** DOM caret placement and measurement of selection time and correction effort.
3. **M2 — Vimium-C coexistence:** an independent caret/selection extension, mode-specific key ownership, and a Vimium-C settings JSON importer/exporter. No Vimium-C fork.

Implementation starts with acceptance tests derived from the requirements. Automated correctness checks and real webcam accuracy measurements are reported separately.

M0 will prototype camera placement confirmation before calibration. The first measurement keeps a single-column, multi-paragraph baseline; later evaluations add different camera placements and fixtures resembling complex real-world pages. The setup phase will also be part of the M2 extension.

## Local processing

Camera frames are processed on the user's device. The app uses no audio, remote inference API, or image recording. Basic detection aggregates can be sent only when the participant explicitly enables the configured diagnostic endpoint; the upload contains no images, audio, raw landmarks, raw features, or continuous gaze history. Detailed diagnostics remain a manual download. Starting the camera requires an explicit action; stopping releases the media tracks.

Individual calibration runs on an ordinary PC. Training a general image-based gaze model is outside the first milestone.

## Development and distribution

Development uses short-lived branches and pull requests into `develop`. `main` is reserved for reviewed releases. See [Development strategy](docs/development-strategy.md) for the alternatives considered, branch rules, implementation approach, and experiment workflow, and [Contributing](CONTRIBUTING.md) for the Red → Green → Refactor process.

The core uses TypeScript with Node.js 24.19.0 and npm 11.9.0. With these versions installed:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm run build
npm run preview
```

`npm test` runs the behavior tests; `npm run typecheck` checks types separately. Node's native TypeScript execution does not type-check. The CI workflow runs both on pull requests and on updates to `develop` / `main`. See the [first TDD record](docs/tdd-first-slice.md) for the scope, contract, and observed Red → Green → Refactor results.

Open the localhost URL printed by the preview command in a top-level Chrome window. For source development, run `node scripts/prepare-assets.mjs` once and then `npm run dev`. Build assets are pinned and bundled, including the face model and WASM runtime. See [model assets](docs/model-assets.md).

For browser acceptance tests, install Chromium with `npx playwright install --with-deps chromium`, then run `npm run test:browser`. These tests use synthetic inputs and a fake camera; they do not measure human gaze accuracy. CI also creates a downloadable `gaze-caret-experiment` bundle.

The deployment workflow publishes the selected `experiment` branch to GitHub Pages after tests pass. Enable Pages with the GitHub Actions source once in repository settings; see [publishing and result sharing](docs/experiment-runner.md). This does not merge into `main` or `develop`.

At the end of a run, download JSON/CSV, copy the summary into ChatGPT, or explicitly open a prefilled public GitHub Issue. Submit the issue on GitHub and ask ChatGPT to review it. No GitHub token or Cloudflare secret is stored in the browser. Automatic diagnostics are opt-in and remain disabled until a deployment has a configured private receiver.
