# ROADMAP

## Active

- [ ] Tune default grain size / feedback / spread for a good out-of-the-box first impression — needs an actual listening pass (headless/automated testing can't judge this), unlike the other items below
- [ ] Verify 80000-grain field on real (esp. mobile) hardware — measured 31fps under headless software GL, dial back GRAIN_COUNT if it feels janky on an actual device (needs physical-device testing, can't be verified in this environment)

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
- [x] Fixed total-silence bug (ScriptProcessor capture node was never connected through to destination)
- [x] Sustain-on-silence: repeat ceiling stretches way out when live input goes quiet, plus new `sensitivity` dial for the quiet threshold
- [x] `dev/v0` branch cut, autodeploying to gloop-dev.obfusco.us
- [x] Confirmed GLOOP does not use (and shouldn't use) the audness shared engine — see CLAUDE.md
- [x] 3D liquid plate: grain field rebuilt in three.js, rippling surface driven by the same Chladni nodal math as the grains, grains hover above it
- [x] Plate mesh now spans the full screen regardless of aspect ratio (decoupled mesh size from grain-area size)
- [x] Ripple amplitude cut 10x (was reading as jerky)
- [x] Default rate/sensitivity tuned for more audible activity out of the box
- [x] Real fix for echo dying out in silence: grain pool freezes (stops recording) while input is quiet, instead of only extending the decay ceiling
- [x] Spacebar stops listening
- [x] Grains now roam the full plate (GRAIN_SPAN), not just the original central tile
- [x] Tapping the grain field while not listening plays a synthesized tap sound (`engine.playTapSound`)
- [x] Root-caused 3D flicker: smoothed n/m mode numbers and amplitude instead of snapping to the raw noisy per-frame FFT bin
- [x] Slowed ambient ripple/hue-drift/camera-sway animation speed
- [x] Grain count 4x'd (4000 → 16000), verified steady 60fps under headless software GL
- [x] Sound quality: safety limiter, 70Hz highpass on mic input, exponential grain envelope (was linear)
- [x] Fixed push-force scaling bug (was 5x too strong after grains spanned the full plate) and cut it 5x further per feedback
- [x] Ambient animation slowed again + mode-smoothing eased more; spacebar now toggles listening both ways
- [x] Grain count 5x'd again (16000 → 80000)
- [x] Migrated `ScriptProcessor` grain capture to an `AudioWorklet` (`src/audio/recorder-processor.js`) — capture now runs on the audio render thread instead of main, clearing the biggest remaining glitch-risk lever now that WebGL rendering also shares main-thread time
- [x] Mobile mic permission UX pass — `getUserMedia` failures (denied, no device, in-use, insecure-context) now surface a dismissible toast instead of failing silently; also fixed a latent bug where a failed `start()` left `AudioContext` non-null, silently no-op'ing every retry via the `if (ctx) return` guard
- [x] Code-split `GrainField` (and its three.js dependency) behind a dynamic `import()` — separate ~509KB chunk (was bundled into the ~715KB main bundle), so the initial shell loads and paints before that chunk is fetched
- [x] Forced `recorder-processor.js` to always emit as a real asset file (`vite.config.js` `assetsInlineLimit: 0`) instead of being base64-inlined as a `data:` URI, which has inconsistent cross-browser support specifically for `audioWorklet.addModule()`
- [x] Loop indicator now laps the full screen edges (`LoopIndicator.jsx`/`.css`) instead of circling just the listen button
- [x] Tried disabling echoCancellation/noiseSuppression/autoGainControl on the mic stream, then reverted it — measured that `echoCancellation: false` alone drops captured signal to literal digital silence (and the other two badly attenuate it), a worse regression than the suppression problem it targeted. Back to `audio: true`; see DEVLOG for the investigation. Any future attempt at this needs to be opt-in, not a default.
- [x] Volume knob moved to the right of the listen button (was stacked above it)
- [x] Added a lightning-bolt "shake" button (`ShakeButton.jsx`/`.css`) above the size knob — randomizes the granular/modulation dials (excludes master volume) and nudges the live grain stream, adapted from ribbon's shake/randomize pattern
