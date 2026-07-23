# ROADMAP

## Active

- [ ] Migrate `ScriptProcessor` grain capture to an `AudioWorklet` (ScriptProcessor is deprecated)
- [ ] Tune default grain size / feedback / spread for a good out-of-the-box first impression
- [ ] Mobile mic permission UX pass

## Completed

- [x] GitHub repo + local project scaffold
- [x] Vite + React build setup
- [x] Mic → grain pool → feedback delay network (engine.js)
- [x] Chladni nodal-pattern grain-field visualization (GrainField.jsx)
- [x] Standard project mds (CLAUDE, ETHOS, MYTHOS, DEVLOG)
- [x] DUMP.md wired to LIFE hub
- [x] Console-less UI: floating RotaryKnob dials (ported from puddle) pinned to screen edges, no panel/toolbar chrome
- [x] Large circular listen toggle as centerpiece control (ListenButton.jsx)
- [x] Loop indicator — circulating glow ring tracking live grain rate, with per-grain sparkle pulse (LoopIndicator.jsx)
- [x] engine.js param surface extended: rate (decoupled from grainSizeMs), density (pool spread), dynamics (per-grain delay jitter), repeat (feedback tail decay time, decoupled from feedback gain), wow/flutter/wobble (tape-style LFO modulation), volume (master gain)
- [x] Grain canvas pointer interaction wired to engine.perturb() — dragging the canvas temporarily nudges spread/feedback/dynamics, decays back on its own
- [x] `.vscode/settings.json` — distinct editor workspace theme (teal/coral) from all other lineage projects
- [x] Provision AWS infra: S3 (private + OAC) + CloudFront + Route53 for gloop.obfusco.us and gloop-dev.obfusco.us
- [x] GitHub Actions deploy workflow (`main`→prod, `dev/**`→dev), mirroring now.obfusco.us's live config
