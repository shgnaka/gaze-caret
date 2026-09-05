# gaze-caret

Experimental webcam-based gaze estimation for browser text selection and Vimium-C integration.

The goal is to start text selection near the place you are looking at, then use the keyboard to adjust it precisely.

## Project status

Requirements stage. There is no runnable application or measured gaze accuracy yet.

The first milestone is a standalone browser experiment using a pretrained MediaPipe face/iris detector and a custom, CPU-trainable regression model. It will measure whether webcam gaze can identify text lines under normal reading conditions.

## Requirements

- [Requirements and scope](docs/requirements.md) — product goal, milestone boundaries, functional requirements, data contracts, and implementation decisions.
- [Validation plan](docs/validation-plan.md) — acceptance scenarios, human experiments, metrics, and advancement criteria.

These documents form the initial requirements baseline. Numerical experiment settings are starting values, not demonstrated accuracy or performance claims.

## Milestones

1. **M0 — Gaze experiment:** camera lifecycle, calibration, local learning, independent validation, and text-line targeting.
2. **M1 — Text selection experiment:** DOM caret placement and measurement of selection time and correction effort.
3. **M2 — Vimium-C integration:** gaze-assisted entry into Visual Mode with the existing keyboard behavior and fallback.

Implementation starts with acceptance tests derived from the requirements. Automated correctness checks and real webcam accuracy measurements are reported separately.

## Local processing

Camera frames are processed on the user's device. The initial design uses no audio, remote inference API, image recording, or automatic upload of gaze data. Starting the camera requires an explicit action; stopping releases the media tracks.

Individual calibration runs on an ordinary PC. Training a general image-based gaze model is outside the first milestone.

## Development and distribution

The implementation milestone will add a reproducible build and a downloadable standalone web bundle with its model/runtime assets. GitHub Actions will run automated checks and produce that bundle. Setup commands and deployment instructions will be added when they exist.
