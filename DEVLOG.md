# DEVLOG

## 2026-07-12 - Project scaffold

- Created GitHub repo `nathanmoomaw/gloop` (public, lineage project)
- Vite + React 19 scaffold, mirroring vibe's build setup
- `src/audio/engine.js` — mic capture into rotating grain buffer pool, randomized grain playback through per-grain delay/feedback/pan network
- `src/components/GrainField.jsx` — Chladni-plate nodal-pattern grain-field visualization, mode numbers driven by dominant frequency from the analyser
- `src/App.jsx` — start/stop mic, grain size / feedback / spread controls
- Standard mds added: CLAUDE.md, ETHOS.md, MYTHOS.md, ROADMAP.md, this DEVLOG
- DUMP.md symlinked to `LIFE/dumps/gloop.md`, gitignored
- Updated `LIFE/LINEAGE.md`: grains (concept) → GLOOP (active, scaffold stage)
- Deploy (S3 + CloudFront + Route53 for gloop.obfusco.us / gloop-dev.obfusco.us) intentionally not provisioned yet — new billed AWS infra + DNS change, pending go-ahead
