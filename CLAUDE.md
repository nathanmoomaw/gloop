# GLOOP

## Project Overview
GLOOP is a granular synthesis echo loopback device — part of the ribbon/puddle/audness lineage (see `~/Sites/LIFE/LINEAGE.md`). It listens to the mic, chops what it hears into short grains, and replays them through a feedback delay network so the room's own sound becomes a granular echo. Visualized as rainbow sand grains settling into Chladni-plate nodal patterns on a vibrating speaker.

## Tech Stack
- Vite + React 19, no backend
- Web Audio API: `ScriptProcessor` grain capture → grain pool → randomized playback through per-grain delay/feedback/pan (see `src/audio/engine.js`)
- Canvas 2D for the grain-field visualization (see `src/components/GrainField.jsx`)

## Status
Scaffold stage (2026-07-12). Core mic → grain → feedback loop and Chladni-driven visualization are implemented as a first pass. Not yet deployed.

## Conventions
- DUMP.md is a symlink to `~/Sites/LIFE/dumps/gloop.md` — gitignored here, lives privately in LIFE.
- `/dump` here follows the same 3-step pattern as other lineage projects (see `.claude/commands/dump.md`).
- ETHOS.md / MYTHOS.md hold direction and narrative; update DEVLOG.md and ROADMAP.md as work lands.

## Deploy (planned, not yet provisioned)
- `main` → `gloop.obfusco.us`
- `dev/*` → `gloop-dev.obfusco.us`
- Prior lineage/obfusco.us projects (now, moveloose) deploy via GitHub Actions → S3 + CloudFront. Provisioning the S3 bucket, CloudFront distribution, and Route53 record for gloop is pending explicit go-ahead (new AWS infra + DNS change to a shared domain).
