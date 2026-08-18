# ROADMAP

## Active

- [ ] Tune default grain size / feedback / spread for a good out-of-the-box first impression — grain size, rate, feedback, repeat, density, and overall output volume/gain-staging were all bumped up per explicit request (2026-08-12/13, the latter after diagnosing that the safety limiter was silently eating the first volume-boost attempt), but still needs an actual listening pass to confirm the new values land well (headless/automated testing can't judge this), unlike the other items below
- [ ] Verify 80000-grain field on real (esp. mobile) hardware — measured 31fps under headless software GL, dial back GRAIN_COUNT if it feels janky on an actual device (needs physical-device testing, can't be verified in this environment)
- [ ] Confirm the new opt-in "raw" mic toggle (no echoCancellation/noiseSuppression/autoGainControl) actually fixes the "choppy, cuts off" recordings on real hardware — Playwright's fake mic device can only confirm the toggle is wired up, not judge real capture quality (this is the same class of item as the two above)

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
- [x] Split the granular voice and the delay/feedback echo onto independent mix gains (`granularMix`/`delayMix`), with their own big knobs, so the two can be balanced separately instead of only sharing the combined `mix`/`feedback` dials
- [x] Moved the granular/delay mix knobs to sit left of the listen button (was a standalone top-center row); on mobile widths they float in their own row above listen/volume instead, to stay clear of the bottom-left corner cluster
- [x] Added an opt-in "raw" mic-capture toggle (`MicModeToggle.jsx`/`.css`) next to sensitivity — lets echoCancellation/noiseSuppression/autoGainControl be disabled by user choice instead of by default, per the guardrail from the earlier reverted attempt at this
- [x] Default grain size (120ms→400ms) and rate (26ms→200ms) bumped up per request
- [x] Default feedback (0.45→0.65) and repeat (0.4→0.65) raised so a fresh session loops back more sound out of the box
- [x] Added `WaveformOverlay.jsx`/`.css` — a live time-domain waveform trace of the actual output, layered over the plate at 50vh tall, vertically centered
- [x] Fixed mobile control-overlap bugs: top-left/top-right clusters now cap at `max-width: 46vw` and wrap instead of colliding at mid-narrow widths (~600-650px); mix-pair's "float above listen" breakpoint widened 480px→700px; bottom-left size/density stacks into a column below 430px to clear the centered listen button
- [x] Output volume doubled (`OUTPUT_BOOST = 2` multiplier on `masterGain`, on top of the volume dial's existing 0-1 range) — dial itself was already at its ceiling, so loudness had to increase as a multiplier layered on top
- [x] Real fix for "still needs to be louder": the safety limiter (12:1-ratio compressor, no makeup gain) was eating almost all of the above boost before it reached the speakers — loosened the limiter (threshold -6→-3dB, ratio 12→8, knee 12→6), added a `LIMITER_MAKEUP_GAIN=1.4` stage after it, and raised `OUTPUT_BOOST` 2→3
- [x] Quiet-time echo boost: the delay/feedback path's own level now scales up to 80% louder (`QUIET_DELAY_BOOST_MAX`) as live input goes quiet, reusing the existing `quietFactor`/`sensitivity` machinery — not just a longer decay tail, actual added presence
- [x] GrainField background now has ambient spin + horizontal/vertical pan, with decaying momentum nudged by drag direction ("physics from the last touches") — applied as a rotation of the nodal-pattern sampling coordinates rather than an Object3D transform, so it doesn't desync from the pointer-push interaction math
- [x] Size dial range widened 400ms→3000ms max; fixed a real hidden dependency this exposed — grain pool buffers were hardcoded to 400ms, so larger grains would have silently failed to play. `SIZE_MAX_MS` now sizes both the pool buffers and `MAX_DELAY_SEC`
- [x] Rendered sand-particle size now follows the size dial (sqrt-scaled `THREE.PointsMaterial.size`)
- [x] Density default raised 35%→60%
- [x] Raw-mic toggle's "float below the row, right-aligned" placement made permanent instead of only applying under the 700px mobile breakpoint
- [x] Waveform visualizer given a playful traveling-sine wobble, independent of the actual audio-reactive trace underneath it
- [x] Auto-sensitivity ramp: `sensitivity` dial now sets a floor rather than a fixed capture threshold — the longer input stays quiet, the further the effective threshold auto-lowers (down to 25% of the dial's value after 8s), so a persistently quiet room stops staying gated out indefinitely; resets to the dial's baseline the instant real input returns
