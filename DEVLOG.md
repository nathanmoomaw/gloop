# DEVLOG

## 2026-10-30 (latest) - All input saved, no pairing

Nathan: "no devices need pairing for now, want all user input saved." The pairing UI, the stored key
(`loadPairKey`/`savePairKey`) and the GPC/DNT opt-out are gone. Every device sends every entry without
a key, at the normal 15s batch delay instead of 60s, and the Lambda files it all under
`LIFE/learn/gloop/anon/`. That needed no Lambda change or deploy. The panel just says "also saving to
LIFE". The sender keeps its `key` option and keyed outbox, and the Lambda its keyed path, for when
pairing comes back. The end-to-end check before this change still holds (gloop-dev bundle has the URL,
preflight 204, anonymous POST 204 and landed in LIFE, test line removed). 85 tests.

## 2026-10-30 - Evolve + breed in harmony, no outlines, learning from anyone

- **Evolve and breed share one population** (`evolve.js`). They used to compete: opening one stopped
  the other and threw its work away. Now evolve's slots outlive a stop. Breed opens with the current
  sound, then evolve's fittest distinct slots (`fittestParams`), then mutants, always keeping at least
  one fresh mutant. Every breed pick joins evolve's slots (`adoptPicks`) as a new lineage: the weakest
  slot is replaced, fitness is set to the population's best so a pick isn't invaded before it's been
  heard, and it gets a resistance head start. Evolve pauses while breed is open (one thing auditions
  at a time) and resumes on close. Turning evolve on while breed is open queues it for when breed
  closes. A resumed evolve slots what's playing now into the weakest slot, so it doesn't jump back to
  an old sound. Picks with no evolve history become the population.
- **No outlines:** every control and panel border is now transparent (same width, so nothing moves),
  border-color state rules are gone, and the unused `--bevel-border` token was removed. On/off still
  reads by fill and glow. Keyboard focus rings (`:focus-visible`) stay for accessibility.
- **Learning from anyone, by default** (`implicit.js`). No buttons needed. Once a second App ticks
  a detector with the live params, levels and state:
  - `settle` (weight 0.5): dials left alone for 20s of actual sound.
  - `linger` (weight 1): the same sound held for 90s.
  - `rescue` (weight 0): the `sound` button pressed, so the state before it wasn't working.
  - `pick` (weight 2): a breed pick, logged with the picked candidate's params.

  Only time with sound counts: playing, thru off, output RMS above 0.005. Any param change restarts
  the count, and a backgrounded tab's gap doesn't count. They log like presses (db, file, dev log,
  remote) and feed `learnedTarget` at their weights; the buttons stay as the explicit layer.
- **Anonymous sending:** unpaired browsers now send too, without a key. The Lambda files these under
  `LIFE/learn/gloop/anon/<date>.jsonl`, with batches capped at 50 entries (the client caps every batch
  at 50 to match) and a 60s quiet delay to cut commits. A wrong key is still a 401. Browsers with
  Global Privacy Control or Do Not Track send nothing anonymously. Paired and anonymous entries queue
  in separate outboxes.

**Tool data:**
- Written by hand: one 60-line module plus edits; well under Argon's bulk threshold.
- 88 unit tests (+13: shared population, seeding from evolve, implicit signals, anonymous body, 50-entry
  cap, outbox separation, opt-out); lint and build smoke pass.
- Mocked Lambda run:
  - anonymous → `anon/`, keyed → main;
  - wrong or empty key → 401;
  - 51 anonymous → 400, 51 keyed → 204;
  - unknown kind → 400, unknown param stripped;
  - Telegram unchanged.
- Haiku: 2 findings.
  - Fixed: a revoked key's queue would have gone out anonymously; the fix was the separate outboxes.
  - Skipped: breed opening mid-glide seeds a half-glided sound. Candidate A is "what's playing now"
    by design.
- Jev: flagged all 13 files (0.31–0.74), still without line-level signal. evolve.js, its top score,
  re-read by hand: nothing found.

## 2026-10-29 - Learn presses from any device → LIFE

Presses from a phone or Safari now reach Claude too, through a new `POST /learn` route on the capture
Lambda (the Telegram/email one), which appends them to `LIFE/learn/gloop/<date>.jsonl`. `/dump` already
pulls LIFE.
- **Client (`learnRemote.js`):** each press gets an `id` and goes into a localStorage outbox, which
  survives reloads and offline use. Batches (≤48KB) go out after 15s of quiet, or by `sendBeacon` when
  the page is hidden. The body is text/plain JSON, so there's no CORS preflight and beacons work.
  Several tabs share the outbox: it's re-read on every change, entries are removed by id after a
  success, and flushes take a Web Lock. If storage is blocked or full, the sender runs from memory
  for the session. Only production builds with the `LEARN_URL` secret, on a paired device, send;
  dev keeps `learning/`.
- **Pairing, not a bundled key:** the first version baked the key into the build. That was blocked at
  commit as a leak (anything in the bundle is readable), so the build now carries only the URL. Each
  device pastes the key once into the learn panel ("pair device"), and it's kept in localStorage
  (`gloop.learn.key`). Unpaired devices queue nothing, so other users' presses stay in their
  browsers, which fits learn becoming a user feature. A 401 unpairs the device and the panel says
  "key rejected, pair again"; the presses stay in the outbox for the next pairing (Haiku caught the
  first version dropping them; its other finding, 400 dropping a whole batch, skipped: entries are
  built with valid kinds only, so a resend can't help). Headless check against a stub server: unpaired sends nothing, a bad
  key unpairs after one 401, a good key sends, the outbox empties across a reload, and no key
  appears in the bundle.
- **Lambda (capture `index.mjs`):** checked before the Telegram path, which is unchanged. It checks
  the key, then re-serializes only known fields (kind from the 4, numeric params/levels, boolean
  state, `id`, `t`, plus the sending `host`), so arbitrary text never reaches the repo. Caps: 200
  entries and 64KB per batch, 900KB per day file (GitHub's contents API stops returning content at
  1MB, so a bigger cap could have overwritten the day), then 429. It skips ids already in the day's
  file, so resends are harmless; that's what lets beacons leave their batch in the outbox. A
  conflicting PUT (409/422) re-reads and retries. CORS is answered only for the gloop origins.
- **Not live yet:** writing the key and GitHub secrets was blocked as a secret-store write, so
  `capture/scripts/setup-learn.sh` does it: generates the key into `.env`, sets gloop's `LEARN_URL`
  secret, deploys the Lambda, re-runs the gloop-dev deploy, and copies the key to the clipboard for
  pairing. Nathan runs it once.

**Tool data:** written by hand (one new 160-line module plus edits to an existing Lambda; Argon is for
bulk new files). Mocked Lambda test: preflight, bad key, bad kind, too many, CORS, 409 retry, day full,
dedupe, and the Telegram path unaffected. Haiku on capture: 0 findings, twice. `/code-review` on the
client: 10 findings, 8 fixed (blocked localStorage white-screened the app; tabs clobbering each
other's outbox; beacon batches lost on server failure; no reschedule after a rejected batch; trims
dropping unsent entries; count-based batch size near 64KB; outbox stringify cost; no timer dispose), 2
accepted (public key, dev presses sharing the files). Haiku on gloop then caught that the
memory fallback was never read back, and that my test had baked that in. Fixed. Jev: 3 of 3 flagged.

## 2026-10-29 - Logo glitches; learn log in IndexedDB + auto-save file

**Logo glitches.** Every 4–16s (20% chance of a quick second one right after) the wordmark does one
of 12 glitches, never the same twice in a row: rgb split, slice, jitter, skew, invert, flicker, CRT
scan, melt, mirror, rainbow color, blur pop, color tear. They're CSS classes on a new
`.gloop-logo__glitch` layer, so they don't fight the logo's centering transform. rgb and tear use two
colored ghost copies of the text. The wordmark font size moved up onto that layer so `em` offsets mean
wordmark size (at first jitter moved by 1.3px). Off under reduced motion. Checked all 12 in
screenshots: four looked unchanged at first only because the screenshots landed after those short
animations ended. In a headless 40s run it fired 6 different glitches.

**Learn storage.**
- **Local db:** presses go to IndexedDB (`learnStore.js`) instead of localStorage, with no 2000 cap.
  The old localStorage log migrates once, in one transaction with a migrated flag. A press whose db
  write fails is parked under `gloop.learn.fallback` and imported on the next load. With no IndexedDB
  (private mode) localStorage stays the store. The in-memory log keeps the last 20k presses for the
  panel; the learned target reads the last 500.
- **Automatic export (Chrome/Edge desktop):** "auto-save to file" in the panel (`learnFile.js`, File
  System Access API). Pick a file once and every press appends a line. The handle is kept in the db,
  and permission is re-asked on a press after reload. An empty file first gets the whole history from
  the db; a file with data is left as is. Failed appends wait in a backlog and go out with the next
  press. Safari, iOS and Firefox don't have the API, so they keep export.
- Storage moved out of App into `useLearnLog` (161 lines).
- Headless (stubbed picker): 2 old localStorage entries migrated and the key was removed; the file
  got old1, old2, then each new press; all 4 survived a reload; the dev middleware still logs.

**Tool data:** Argon wrote `learnStore.js`, `learnFile.js` and both test files (fake-indexeddb, new
devDependency, plus fast-check): 6.9k in, 4.6k out, **$0.060**, tests passed. Its gate's Haiku found 5:
1 small real one (migration count included skipped junk), the rest minor or about tests. The logo work
and App wiring were by hand. Haiku diff reviews (~$0.05 over 6 passes) found 9 real issues, all fixed,
mostly in my wiring: presses before load counted twice; picking a non-empty file truncated it; the
private-mode fallback ignored saved presses; StrictMode ran the migration twice; picking before load;
export capped at memory; history `id` fields; a sync throw; a stale handle overwriting a new pick. The
last pass only found millisecond-window races, so I stopped there. `/code-review`: 10 findings, 6
fixed (fallback presses never re-imported, read failure after migration, failed appends never
retried, mixed `id` shapes, user activation lost before the picker, summary recomputed per render), 4
skipped (onblocked for a future schema bump, private-mode stringify cost, count past 20k, docs).
Jev: 7 of 8 flagged.

## 2026-10-28 - Learn mode (❤️ 🔊 🔇 ⭐); default size at noon

**Default size 400 → 1500ms**, the size knob at 12 o'clock (linear 30–3000). The `sound` zone for
size widened from 120–600 to 300–2000 so `sound` doesn't knock noon back out, and the shake range
moved from 30–400 to 300–2500 (it was stale against both).

**Learn mode.** New `learn` toggle (end of the toggle stack) opens 4 big buttons: ❤️ sounds good,
🔊 working, 🔇 no sound, ⭐ dialed in. Each press pops and floats its emoji, bumps a per-kind count, and
logs `{t, kind, params, levels: {input, output, grainsPerSec}, state: {listening, playing, thru,
rawMic}}`.
- **Where it lands:** localStorage (cap 2000) plus an `export` button (.jsonl download). Under
  `npm run dev` each press is also POSTed to a dev-only Vite middleware (`vite-learn-log.js`) that
  appends it to `learning/feedback.jsonl`, so Claude can read it directly. The deployed site is static
  and has no backend, so on gloop-dev use export.
- **What the app does with it:** ⭐ ×3, ❤️ ×2, 🔊 ×1 form a recency-weighted target (half-life 50 presses;
  rate and size averaged in log space). Likes pressed while not playing or with thru on are ignored,
  since they rated something else. `sound` now sends out-of-range dials to that target instead of a
  random spot (`soundFix` takes an optional target). 🔇 does the same, but glides the texture dials;
  if nothing is out of range it goes all the way to the target, or with no history turns volume,
  mixes and sensitivity halfway up. It also starts listen + on and drops thru, like `sound`.
- **Levels:** new `engine.getLevels()`. Output RMS is sampled every 60ms on the existing perturbation
  timer and averaged over ~2s, so a press rates the last few seconds, not one 21ms snapshot. Headless
  with the fake mic: input ~0.02–0.06, output 0–0.004 (the fake device beeps with gaps).

**Tool data (Argon + Jev rule):** Argon wrote `learn.js`, `learn.test.js` (fast-check), `LearnPanel.jsx/.css`
and `vite-learn-log.js` in one call: 5.8k in, 7.0k out, **$0.082**, tests passed. Its gate's Haiku found
4: 1 real (reduced-motion left the float emoji stuck on screen), 1 minor (413 doesn't drain the
request, dev only, skipped), 2 not relevant. I wrote the engine levels, toggle, and App wiring. Haiku
diff review ($0.03 over 3 passes): 2 real (🔇 did nothing when every dial was in range; export revoked
the blob URL before Safari's download started), then clean. `/code-review`: 10 findings, 6 fixed
(knobs froze during the 🔇 glide; a double tap could drop an entry; likes while off/thru taught the
target; 🔇 no-op when already on target; stale shake range; `learnedSoundFix` duplicated `soundFix`), 4
skipped (thru output labelling, glide contention with evolve, save cost at 2000 entries, LAN access
to the dev middleware). Jev: 7 of 9 flagged with a spec, 9 of 10 without on the final diff. Still no signal. Headless checks at
1280 and 390px: no overflow, no errors, presses land in localStorage and the file. On phones the
panel was moved up to clear the toggle stack.

## 2026-10-28 - CPPN grain field (`c`), worth-saving reference notes

**CPPN field.** New `src/visual/cppn.js` is a 6-node compositional pattern-producing network (Stanley
2007). Its inputs are periodic x/y/r, a Chladni term, time and level, and its output is in (−2, 2) like
Chladni. Genomes are plain JSON with mutate/crossover. `c` eases GrainField's nodal field (plate
height and grain drift) from Chladni to the CPPN over ~3s; Shift+C mutates the genome (rate 0.35) and
morphs old → new over ~1.7s. Default visuals are unchanged.
- **Cost.** A first version called the CPPN for every grain and vertex (~87k calls): 13 → 32 ms/frame
  of script, 55 while morphing. Now it's evaluated once a frame on a 96×96 LUT (one period-2 tile) and
  sampled bilinearly: +4 ms (+5 morphing), headless software GL. 128² cost +6.4/+12, so it stays at 96.
- **Seams and drift** (from `/code-review`): x/y inputs are `0.5·sin(π(u−0.5))`, so the field tiles
  like Chladni. The Chladni input blends the four neighbouring integer modes (`modeChladni`), so it
  stays periodic while n/m ease, which a plain wrap of the LUT wasn't. Time enters as `sin(t·0.05)`, so
  nodes can't saturate over a long session.
- **Looks:** the first preset reads as a cousin of Chladni lines. One Shift+C in the test run jumped to
  a smooth, saturated color field, a big step for one mutation. Needs an eyeball pass (ROADMAP).

**Tool data (Argon + Jev rule):** Argon wrote `cppn.js` + `cppn.test.js` with fast-check properties
(new devDependency) in one call: 3.6k in, 4.3k out, **$0.050**, tests passed first try. Its gate's
Haiku flagged 2 (both about my spec's loose budget/seed wording, not bugs). Wiring, LUT, and fixes were
done by hand. Jev with spec: all 3 files flagged (0.39–0.60), still no signal. Haiku diff review: 3
real (Shift+C mid-morph snapped, key repeat re-toggled, seam comment overstated), then clean
($0.015 total). `/code-review`: 10 findings, 5 fixed (seam, time saturation, wasted Chladni at full
blend, duplicated Chladni formula, docs), 5 skipped (per-frame easing matches the rest of GrainField;
the morph guard is enough for now; crossover kept for a later breed hookup; test limit constants;
LUT resolution, where 128 measured too costly).

**Worth-saving, reference only** (now in CLAUDE.md "Reference notes" / ETHOS): Sethares dissonance
constants, waveguide + EA-fitting bridge, OPFS for saved genomes/grain pools, ICMC94/EGDE grains-as-
genomes lineage.

## 2026-10-28 - Full-stack iteration + tool audit: loop dot, spacebar root cause

**Changes**
- **Loop dot no longer jumps when rate changes.** Lap period lived in a CSS `animation-duration`;
  changing it re-mapped elapsed time onto the new keyframes mid-lap. Now a rAF loop accumulates phase
  (`advancePhase`) and maps it to the edge path (`lapPoint`, `src/components/lapPoint.js`, 5 tests), so
  speed follows the rate and position never jumps. Headless check while hammering the rate knob: worst
  per-frame speed 4.7 px/ms, under the fastest legit lap (~5.5), so no jumps.
- **Likely root cause of the "first spacebar leaves `on` off" bug** (never reproduced; fixed
  defensively 10-27). The first press opens the mic permission prompt, which takes focus, so the keyup
  never reaches the page: `on` latches on keyup, so it never came on, and the stuck press swallowed the
  next one. Headless never showed it because the fake-media flag skips the prompt. Now a press lost to
  blur while the mic is pending counts as a tap from off; any other lost press (cmd-tab mid-hold) ends
  the hold so the mic doesn't stay open in the background. Needs a real-browser check.
- **Raw mic toggle now applies while listening** (reopens the mic; constraints only apply on open).
- **Knob post-drag click swallow is mouse-only.** Touch drags fire no click, so it was eating the next
  tap on any other control within 300ms.
- **Graph build failure:** `startListening` clears `wantListening` (was stuck "pending"), and a retry
  closes the half-built context instead of leaking it.

**Tool audit (this iteration)**

| Tool | Cost | Findings → real | Notes |
|---|---|---|---|
| Argon, read-mode audit of `src/` (13 files, 38k in) | $0.095 | 8 → 4 real (spacebar blur, raw toggle, knob click swallow, ctx leak), 1 harmless, 3 wrong | First Argon run in gloop. Found the spacebar root cause nothing else had. Confidences (0.78–0.95) didn't separate right from wrong. |
| Jev, with `--spec` | ~free | 0/3 flagged on the loop fix; 3/6 on the full diff | No bug data to judge against; scores track file size/complexity more than bugs. |
| Jev, no spec | ~free | 5/6 flagged on the final diff | Same noise as the first run. Spec helps a little. |
| big diff Haiku (×3 passes) | $0.014 | 4 → 3 real (knob swallow too wide, blur during hold, stuck `wantListening`) | Best value again: caught regressions in my own fixes each pass. |
| `/code-review` medium | (plan) | 10 → 4 fixed (pointerType, blur vs cmd-tab, stale nodes after nulling ctx, dot freezing in fade + negative first dt) | Caught two regressions from Haiku-driven fixes. Rest were edge or style. |
| `/simplify` | (plan) | 1 (phase ref → effect local), done inline | Its 4 parallel agents all hit the 5-hour rate limit; ran the pass by hand. |
| vitest + build smoke | free | 0 | Guards the pure parts only. |
| Playwright (headless) | free | verified the dot fix numerically | Can't show permission-prompt bugs: fake-media flag skips the prompt. |
| Argon write mode | — | — | Not used: loop fix was 2 files / ~60 lines, under the 3-file/300-line rule. |

Takeaways: each reviewer found something the others didn't, and each round of fixes created new
issues the next reviewer caught. Argon read-mode is worth ~$0.10 as a periodic whole-repo audit. Jev
still gives no usable signal on this React/JS code, with or without a spec.

## 2026-10-28 - Logo 3× bigger, drippier

The wordmark goes from 1.35rem to 4.05rem (3×) on desktop. Phones get 2.6rem instead: 3× there would
run into the big rate/feedback knobs in the top corners. All drip sizes are now `em` of the wordmark,
so they scale with it. Seven strands instead of four, each longer (0.5em), with bigger drops falling
further. The goo blur goes from 1.1 to 3px, sized to the bigger text. A fixed-px blur over-melts the
smaller phone wordmark into an unreadable blob, so phones get their own `#gloop-goo-sm` (1.8px),
switched in CSS. Checked in screenshots at desktop and 390px.

Tool data (Argon + Jev rule): too small for Argon (2 files), done by hand. Jev with a spec flagged
`DrippyLogo.jsx` at 0.39; Haiku review ($0.0012) found nothing, and neither did I. A spec didn't make
Jev quieter on this purely visual component.

## 2026-10-28 - Argon + Jev wired in for every project

Standing instruction (until Nathan says otherwise): use Argon and Jev in all projects so Nic gets real
data.
- **Jev** now runs outside the Argon flow: new `tools/jev.py` in the-switch (thin CLI over
  `gate.jev_scores`, same pinned `jev-1.14.0`, FLAG 0.3, metrics logging) plus a global
  `~/.local/bin/jev [--spec …] [ref]` that scores a repo's changed source files.
- **First run, gloop `HEAD~6`** (16 files, all already reviewed and tested, no spec, ~$0.0006): 13
  flagged ≥ 0.3 (0.30–0.78), 3 under (sound.js, DrippyLogo, SoundButton). There's no known open bug in
  any of them, so spec-less Jev on React/JS reads as noise here. It's the same finding as the-switch's
  Oct 21 bench (clean files up to 0.64). Next runs will pass `--spec` from the DUMP item to test whether
  that sharpens it.
- **Argon:** global `/argon` command (follows the-switch's flow; `test_cmd` = vitest here). Not usable
  in gloop sessions yet: the `argon` MCP server is registered only for the-switch, and adding it at user
  scope was blocked as a Claude-config change, so Nathan has to run that step.

## 2026-10-28 - `sound` button; dev-stack effectiveness review

**`sound`** is a one-shot "make it audible" action left of listen. It's a squircle with a press flash,
deliberately unlike the round listen/on lamps, since it's an action, not a state. `soundFix`
(`src/audio/sound.js`, pure, 3 tests) moves only the dials outside a "you'll hear it" zone
(`SOUND_BOUNDS`) to a random spot inside it; dials already in range stay put. Examples: volume ≥ 70%,
granular/delay mix ≥ 60/50%, rate 4–10 grains/s, repeat 35–80% (below the wash), sensitivity ≥ 30% so
quiet rooms aren't gated out. It then drops `thru` (which mutes the grains), starts listen + on, and
nudges the grain stream. Headless check at desktop and 390px: from volume 0 with thru on, one press →
listening + on, volume back in range, thru off.

**Stack review: what's been used on gloop since 2026-10-27, and how it did**

| Tool | Runs | Cost | Real findings | Verdict |
|---|---|---|---|---|
| big diff, Opus, whole repo | 1 | $0.54 | 4 of 4 (grain-loop perf, push hit the wrong grains, teardown cutting grains, start race) | Best value per real bug. Use for first passes over a whole repo. |
| big diff, Sonnet, whole repo | 1 | $0.23 | 2 of 8 (WebGL rebuild, unhandled rejection) | Mostly hedged noise; Opus found more, and sharper. |
| big diff, Haiku, diff passes | 5 | ~$0.03 | 2 of 6 (pick lost over the breed cap; a test that didn't check what its name said) | Cheap gate; most findings were wrong or minor. Verify each one. |
| vitest unit tests | 20 tests | free | 1 (KM color seam at the yellow wrap, visible on screen) | Paid for itself on the first run. |
| Playwright + CDP (headless, plus real Chrome) | ~15 runs | free | perf baseline (20.5 → 9.8 ms/frame), 3 visual bugs in screenshots (invisible breed cards, unreadable logo blob, detached drips) | The most useful tool for UI work here: nothing visual would have been caught without it. |
| jCodeMunch | 1 query (tested today) | free | missed the answer a single grep found | Not worth it at gloop's size (~3k lines). Skip unless the repo grows. |
| Wolfram, Context Mode, Argon, Jev | 0 | — | — | No exact-math or huge-output need here. Argon/Jev bill Nic's keys (the-switch), so they're off-limits for gloop. |

Gaps:
1. **Review costs aren't tracked.** `review-haiku` moved to big diff on 10-26, and big diff doesn't write
   to the-switch `metrics/calls.jsonl` (0 gloop rows), so these runs are invisible to `metrics.py`.
2. **`/code-review` and `/simplify` haven't run.** Correct for `dev/v0`-only work, but they're required
   before merging to `main`, which is now ~55 commits behind.
3. **One bug never reproduced in any tool**: the first-spacebar `on` miss (fixed defensively on 10-27).
   Headless and real Chrome both passed; only your browser shows it.

## 2026-10-28 - Drippy logo; lit/unlit listen + on; default rate 5/s

- **Logo drips.** New `DrippyLogo` component replaces the plain wordmark. An SVG goo filter (1.1px blur
  → alpha threshold ×18 −7) with the crisp text composited `atop`, so the letters stay readable and only
  the joins melt. Four drip strands start just inside the letters, slowly stretch, and shed a droplet
  each on staggered 4.6–7.4s cycles. Glow moved to a wrapper `drop-shadow`, since a text-shadow would
  get thresholded into the shape. Static under `prefers-reduced-motion`. The first try at 1.6px blur
  turned "gloop" into an unreadable blob; the drips also first hung detached, because `top` % counts the
  drop padding (baseline is ~38% of the box).
- **Listen / on state.** Both were see-through inverted discs whose on state differed only in
  border/glow. Now off = unlit window with a dimmed label; on = solid opaque lamp (backdrop filter off)
  with a dark bold label. ON is a green radial fill. LISTENING is a pale lit core inside a thicker (5px),
  fully opaque spinning rainbow ring.
- **Default rate 2000ms → 200ms (0.5/s → 5/s)**, so a first listen hears itself fed back right away.
  This reverses the 2026-10-04 "too busy, 10× sparser" change, at the user's request. Lower is still a
  knob turn away.

## 2026-10-28 - Worth-saving sweep: breed, repeat wash, accessible knobs

Four items from `LIFE/worth-saving/gloop.md`:

- **`breed`: interactive evolution, Karl Sims style.** New toggle beside `evolve`, opening a panel of 4
  cards. Tap a card to hear it (glides the engine there with evolve.js's `glideTo`), heart the keepers,
  `breed` for the next round. Round 0 is the current sound plus 3 wide mutants. Later rounds keep the
  picks (at most 3, so there's always a new child) and fill up with NEAT crossover + mutation children
  of them, the same `crossover`/`mutate` as `evolve`. Following the SCP caution, unpicked candidates go
  to an 8-slot archive and come back as a second parent 15% of the time, rather than being deleted.
  Logic is pure (`src/audio/breed.js`, 5 tests). Opening `breed` stops `evolve` and vice versa; `on`
  off closes it. Knobs poll back in sync while breeding, same as evolving. Haiku review caught a pick
  over the 3-keep cap vanishing (it was neither kept nor archived); now archived first.
- **Clouds-style threshold on `repeat`.** Above 85% the dial crosses into a smeared wash (`smearAmount`,
  smoothstep to 1 at the top): attack stretches from 15% to 50% of grain length, an extra ±7.5% pitch
  scatter, the dry grain ducks up to 50%, and each grain sends into a shared convolver with a generated
  2.5s stereo noise-decay IR (soft 40ms onset, no discrete reflections) that feeds `fxBus`, so `thru`
  mutes it too. The knob label reads `NN% wash` in that zone. Not verified by ear.
- **Knob accessibility.** `RotaryKnob` is now `role="slider"`, focusable, with aria-label, min/max/now
  and `aria-valuetext` (the shown label). Arrows move 1% of the range, PageUp/PageDown 10%, Home/End
  jump to the ends; focus ring on `:focus-visible` only. `touch-action: none` was already there.
  Checked headless (Playwright, desktop + 390px): keys move the value and the screen-reader text
  follows.
- **LINEAGE reference sweep.** Evolution references folded into LINEAGE.md's GLOOP entry: novelty
  search first, then MAP-Elites/NSLC, POET, Red Queen, Avida, Sims, NEAT, Baldwin, CMA-ES,
  quasispecies, SCP. Each is tied to what shipped (`evolve`, `breed`) or what's open. LiveGrain's
  dual-buffer idea is already the engine design (the worklet records into a rotating pool while grains
  read from it), so it's marked covered. 18 worth-saving items checked off, 5 left (CPPN, OPFS,
  waveguide, ICMC94, Sethares).

## 2026-10-27 - First spacebar tap re-asserts `on`; favicon

Reported: on gloop-dev in Chrome, the first spacebar tap turned on listen but not `on`. Didn't
reproduce in four setups: headless Chromium against the local build (mic auto-granted, and with the
prompt left pending), plus real Google Chrome against gloop-dev with a fake mic and with the real mic
on a granted permission. Every run latched `on`. The only code paths that turn `on` off
(`stopAllWithTrail`) would kill listen too, so the likely failure is `setRunning(true)` never
running. Defensive fix: a tap from fully off now calls `setPower(true)` again on keyup. That's
idempotent (startPlaying returns true if already playing and shares the in-flight graph build), and
it also resyncs the button if engine and UI disagree. The swallowed `setPower` rejections are now
`console.error`'d so a recurrence leaves a trace. Sequence check (tap, tap, tap, double-tap → on/off/on/off)
passes.

Also: `/favicon.svg` was referenced in index.html but never shipped (403 from CloudFront on every
load). Added `public/favicon.svg` (pigment-ring dots).

## 2026-10-27 - Grain field 2× cheaper; push follows the finger; grain teardown + start race fixed

Second stack pass, "improve dev as much as possible". `review-haiku <root> --model opus` ($0.54) over
the whole repo found 4 things Sonnet missed. All 4 verified real:

- **Grain field per-frame cost** (main-thread, also delays the setTimeout grain scheduler).
  Measured headless via CDP `ScriptDuration`: 20.5 ms JS/frame before → 9.8 ms after, ~28 → ~40fps
  (swiftshader GL caps the rest). Changes: all grains share a frame's lightness, so color is a
  per-frame 512-step hue LUT instead of 80k `setRGB` sRGB→linear conversions; drift reuses each
  grain's nodal value cached from last frame's height pass (one nodal eval per grain, not two);
  direct typed-array writes instead of `setXYZ`. Remaining JS is the trig itself; going further means
  moving grain physics into a shader.
- **Pointer push hit the wrong grains**: it compared normalized screen coords to plate coords
  while the camera orbits/rolls/tilts. Now raycasts the pointer onto the y=0 plate through last
  frame's camera; radius = 19% of the view height at the touch point, step proportional to radius
  (same on-screen feel as the old 0.19/0.006). Verified headless: a drag clears a swath right under
  the cursor path.
- **Long grains cut off at low repeat**: per-grain teardown fired `repeatMs + 80` ms after the call
  (min ~330 ms, ignoring the 30 ms lookahead), disconnecting `granularMixGain` mid-grain for sizes
  over ~300 ms. Now waits for the later of the repeat tail and the grain's own stop time.
- **Off during first-use graph build turned back on**: `stopPlaying` was a no-op while `playing`
  was still false, then the pending `startPlaying` started grains anyway. `wantPlaying` guard,
  mirroring `wantListening`; `startPlaying` resolves false when cancelled and `setPower` skips
  `setRunning(true)`.

Haiku pass on the diff: 1 finding (push "5× weaker") dismissed, since step scales with radius.

## 2026-10-27 - Dev-stack pass: vitest + big-diff review, three fixes

Ran the the-switch dev stack over the whole repo. Baseline lint/build/smoke clean. `review-haiku
<root> --model sonnet` (big diff, $0.23) over all of src: 8 findings, verified each against source.
Kept 2:
- **GrainField rebuilt the whole WebGL renderer on every `on` toggle** (effect deps
  `[analyser, running]`): fresh GL context + 80k-point buffers each time, `dispose()` without
  `forceContextLoss()` so old contexts linger until GC, and the smoothed Chladni n/m/amplitude reset
  → pattern snapped on toggle. Now `running`/`analyser` are read via refs, scene builds once, freqData
  allocated lazily. Checked headless (Playwright, fake mic): 18 toggles, no errors, one GL canvas.
- **Unhandled rejection** from the un-awaited `setPower(true)` in first-listen and hold-to-record.
  Same memoized `ensureGraph()` rejects `startListening`, which already shows the error → `.catch`.

Dismissed: inputLevel reset (0.85 smoothing per 128-sample block reaches threshold in ~40ms), perturb
interval never cleared (graph lives for the page by design), trail/teardown hedges, thru-without-mic,
GRAIN_COUNT perf (already on Active list).

New unit tests turned up a third: **Kubelka-Munk LUT seam at the yellow wrap**. Hansa yellow is weak,
so the phthalo→yellow mix changes almost entirely in the last sliver of the segment; 8192 evenly
spaced dense samples were coarser there than one LUT step (max step 9× the mean, a visible jump at
phase ~1→0). Cosine-warping concentration so samples bunch at segment ends fixes it at the same cost
(max step 0.083 → 0.012).

Tooling: `npm run test:unit` (vitest: pigmentAt ring properties, NEAT crossover/mutate — now exported
from evolve.js — and engine param surface), `npm test` = unit + smoke, `npm run review:haiku [-- <ref>]`
→ global `review-haiku` (big diff).

## 2026-10-06 - Grain scheduling lookahead; tilt dance slowed to a nod

Sound bugs reported after the inverted-controls/tilt commit, which touched no audio code. Likely cause:
grains fire from a main-thread `setTimeout` and set their envelopes/start at exactly
`ctx.currentTime`, so any main-thread jank (the new per-frame backdrop-filter recomposite on ~15
controls over the WebGL canvas) lands the call late → envelope begins already past its start →
clicks / truncated attacks. `playGrain` now schedules everything at `t0 = currentTime + 30ms`
(`SCHEDULE_LOOKAHEAD_SEC`), including `bufSource.start(t0)`. Backdrop filter trimmed to
`invert(1) brightness(0.55)` (dropped saturate/contrast) to cut compositing cost. Not verified by ear.

Tilt dance read as fast panting: the 1.4Hz underdamped spring + per-onset kicks + raw-amplitude
tempo made it twitchy. Replaced with a slow nod: two incommensurate sines (~14s period at silence,
~8s at full level), depth/tempo following a ~4s-smoothed level, no kicks, no spring. Depth eases to
0 when off so the view settles level.

## 2026-10-06 - Inverted see-through controls; plate tilt dance

Controls: `.bevel` (index.css) flipped from opaque domed discs to inverted windows — each knob/button
backdrop-filters the grain field behind it (`invert(1) brightness(0.5) saturate(1.8) contrast(1.2)`,
so near-black bg reads mid-grey and bright grains go dark) under a translucent tint of its own accent,
and the bevel lighting is reversed (light pools bottom-right, rim shadow top-left → dished in, not
domed). Grains, ripples, camera motion all bleed through, so controls shift with the bg. Hue still
identifies each control; labels keep their dark text-shadow for legibility.

Bg: new tilt dance on the plate camera (GrainField `TILT_*`) — a damped spring (1.4Hz, ζ 0.3) chases a
rocking drive whose tempo rises with level (0.35Hz→1.25Hz) and amplitude with level, and onsets kick it
forward. Applied as camera pitch (`rotateX`) + forward dolly (`translateZ`), so the view leans into
the plate and rebounds away. Gated by `on` like the rest of the camera; settles level when off.
Untested by ear/eye on device — tune `TILT_RANGE` / `TILT_KICK` if it's too seasick or too timid.

## 2026-10-06 - Rate knob turns the right way; loop ring responds across full range

Q: "is the rate indicator going around the edge operating opposite?" — effectively yes. The engine's
`rate` is an interval (ms between grains), and the knob drove it directly, so clockwise = longer
gaps = fewer grains = slower ring: backwards for a control named rate. Worse, the ring's lap was
`rate * 6` clamped to 4s, so from ~667ms up (including the new 2000ms default) it didn't respond at
all. Now the knob is a 0-1 position mapped exponentially across 20–4000ms with clockwise = faster,
reading grains/sec (default 0.50/s); engine/evolve/shake still work in ms. Ring lap =
`400 * (ms/20)^0.65` — 0.4s at 20ms, ~8s at 2000ms, ~12.5s at 4000ms, monotonic everywhere. Ring
still travels clockwise. Known: changing `--loop-duration` mid-lap makes the dot jump position
(CSS animation progress is recomputed) — pre-existing.

## 2026-10-04 - Camera tied to `on` and output params

The wandering plate camera kept drifting with everything off. Now an eased on/off gate stops its
clock and freezes its shape, so the view settles and holds when `on` goes off (and resumes from
the same pose). While on, motion comes from the actual output rather than a free-running base:
clock speed = level + onsets + grain rate (faster firing → faster) + wobble, on top of a small
base; elevation center = feedback (hotter → lower, more dramatic); distance = size (bigger grains
→ further back); orbit width = density; roll = wow + flutter; look-at drift = dynamics. Each
param target is eased, so knob turns and evolve glides morph the motion. GrainField now takes the
full `params` object. The ambient plate-pattern pan/spin (separate from the camera) still runs
while off.

## 2026-10-04 - Tap velocity ramp

Inactive-mode grain touches were still too loud. Each tap now gets a velocity that starts at 10%
and eases (smoothstep) up to full over 5s of continuous touching; a gap over 0.6s starts over from
10%. Velocity scales the output level and the gesture intensity (which also drives decay length and
in-loop brightness), so a soft touch sounds soft, not just quieter — roughly −20dB on a fresh touch.

## 2026-10-04 - Default rate 10x sparser

Default `rate` (grain trigger interval) 200ms → 2000ms — 10% as many grains. Dial range widened
20–600 → 20–4000ms (linear, so the new default sits mid-dial); evolve range follows; shake uses a
narrower 100–3000 so it never lands on either extreme. With 400ms grains this leaves gaps between
direct hits that the delay/feedback tails fill.

## 2026-10-04 - Slower, smoother evolve; wandering plate camera

- **Evolve reworked** (`src/audio/evolve.js`). Was a 2.4s generation with ±35% jumps on half the
  keys, snapped on and (if the parasite lost) snapped back 1.1s later — constant lurching. Now:
  14s generations, 7s parasite eval, ±18% on ~30% of keys, and every param change glides over
  1.8s (smoothstep) instead of snapping. Fitness history is cleared once each glide lands, so a
  score covers only the params being judged, not the transition or the previous set's tail.
  Hosts' stored fitness is now re-measured during the rest period (EMA 0.5) — before, a host kept
  the score it won with forever (stale once the room/input changed), and the seed started at 0 so
  the first parasites won by default.
- **Plate camera wanders** in orbit (±0.75 rad), elevation (41°–64°), distance, roll and look-at
  target, each a two-sine sum at incommensurate rates so it never visibly loops. Its clock is
  time-warped by the input: rest ~0.15 phase/s (~2 min sways), faster with level, faster still on
  onsets (amplitude above its slow average), eased so speed changes stay smooth; louder also
  widens the reach slightly. State lives in a ref so `on`/`off` (which rebuilds the scene) doesn't
  jump the view. Elevation floor keeps the plate's far edge out of frame. Note: pointer push still
  maps screen → plate without perspective, so the push spot drifts a bit from the cursor as the
  camera moves (it was already approximate).

## 2026-10-04 - Spacebar stop-all with trail

- A quick spacebar tap while anything is going (listening, or `on` alone) now stops **both**
  listen and `on` — previously a tap while listening only stopped listen. Tap from fully off still
  latches listen + on; hold still records only while held (release leaves `on` looping). Double-tap
  stop-all kept, now also trailing.
- Spacebar stops leave a trail: `engine.stopPlaying({ trail: true })` stops firing grains but
  keeps the output up, fading it over however long the in-flight feedback tails still have
  (`lastTailEnd`, tracked per fired grain), capped at 10s (`TRAIL_MAX_SEC`); hard zero at the cap.
  `maybeSuspend` waits out the trail before suspending the context. The `on` button keeps its quick
  50ms fade. Starting again mid-trail cancels the fade.

## 2026-10-04 - Thru bypass, listen-off fix, gentler taps, Kubelka-Munk palette

- **Listen off felt like still listening.** The quiet-room behavior (echo up to 80% louder, tails
  stretched toward 30s) keyed off `inputLevel`, which drops to 0 the instant the mic closes — so
  turning listen *off* made the loop louder and longer, reading as still picking up the room.
  `quietFactor` now only applies while listening. Also: a tap on listen while the mic is still
  opening (permission prompt up) now cancels it (`engine.isListenPending()`) instead of firing a
  second start.
- **`thru` toggle** (utility column, between raw and evolve, pale-cream accent). Full bypass: live
  mic → `thruGain` → limiter (skips masterGain, so works whether or not `on`), and the whole
  grain/delay path — in-flight feedback tails too — goes through a new `fxBus` that ramps to 0.
  Engaging thru opens the mic if closed; disengaging leaves listen alone. Thru also taps the
  analyser so the plate reacts to the dry signal.
- **Ambient tap sound tamed.** Every pointermove during a drag spawned its own Karplus-Strong
  voice at up to 0.85 gain straight to the destination — a fast drag stacked dozens. Now: taps
  throttled to ≥90ms apart, all voices sum into a shared bus (gain 0.6 → lowpass 2.4kHz →
  compressor), lower burst/out gains, darker in-loop damping, shorter decay. Roughly −18dB per
  voice before the compressor.
- **Kubelka-Munk pigment palette** (`src/color/kubelkaMunk.js`) for plate + grains, replacing the
  HSL rainbow by default; `k` toggles live for A/B. Single-constant KM per RGB channel over a
  pigment ring (hansa yellow → cadmium red → quinacridone magenta → ultramarine → phthalo blue →
  wraps to yellow, so greens come from blue+yellow mixing). Learned in tuning: masstone swatches
  and a 0.1% reflectance floor make one near-black channel swamp every mix (grays, or red
  dominating within 2% of the segment), so tint swatches + 1% floor, and the ring is resampled by
  cumulative color distance so equal phase steps are equal color steps. Normalized to max channel
  = 1 (KM decides hue/chroma, caller decides brightness).

## 2026-10-01 - Double-space stop-all, cursive logo, tap timing fix

- Double spacebar (2nd press within 400ms of the 1st's release) = stop everything: listen off,
  then `on` off — regardless of what the first tap did (from listening, from on-only, etc.).
- Tap/hold + double-tap timing now uses `KeyboardEvent.timeStamp` rather than `performance.now()`
  in the handler. The first press of a session builds the audio graph and flips `running`, which
  blocks the main thread long enough (~300ms+) that a quick tap's keyup *handler* could run >350ms
  after keydown and be misread as a hold. Verified via raw CDP key events with OS-style timestamps
  (Playwright's `keyboard.down/up` waits for each handler, so it can't reproduce a real quick tap).
- Small cursive "gloop" wordmark (Pacifico, Google Fonts) fixed top-center, pointer-events none.
  Fits between the top corner clusters at 375px.

## 2026-10-01 - Rate + size knobs at 2x

`rate` and `size` (the two most consequential dials) now render at `BIG_KNOB` = 96px vs the
48px default. Shake bolt's centering width follows (96 + 16). The wider bottom-left cluster ran
into the center row below ~800px, so: 481–800px stacks size over density; ≤480px lifts the whole
bottom-left cluster ~210px clear of the center row + floating mix pair, with size/density side by
side again. Headless overlap check (every knob body/button bbox pairwise) clean at 1200/800/600/
430/375px; bolt center = size knob center at all five.

## 2026-10-01 - Re-spaced control palette

Several controls shared near-identical hues once each body was tinted by its accent: wow/flutter/
wobble all pink-purple, density = wow = listen purple, granular ≈ feedback yellow, delay ≈ size
blue, sensitivity ≈ repeat. Per-control colors in `index.css` now spread ~25–30° around the wheel
(crimson, orange, yellow, lime, green, aqua, sky, royal blue, periwinkle, violet, magenta), with
granular split from dynamics by lightness (pale peach). Listen body gets its own desaturated
`--color-listen` (its rainbow ring carries the color); `on` uses dedicated `--color-on`/`--color-off`
instead of borrowing rainbow vars shared with dials. `--rainbow-*` untouched (ring, loop indicator).

## 2026-10-01 - Spacebar tap vs hold

Spacebar was pure hold-to-record, so a quick tap on a fresh session turned `on` but dropped listen
again on release. Now tap/hold is decided on keyup (`SPACE_HOLD_MS` = 350, same as listen's long
press): tap while not listening latches listen on (plus `on`); tap while listening turns listen off;
hold records only while held. Recording still starts on keydown so a hold doesn't lose its first
beat — which means every space press turns `on` (can't know tap vs hold yet at keydown). Uses
`engine.isListening()` for the pre-press state (React Compiler lint rejects render-time ref sync).
Verified headless: fresh tap → both on; tap again → listen off; hold → listen only while held.

## 2026-10-01 - Syne Mono, auto-on, clearer toggle states

- Font: Syne Mono (Google Fonts) for the whole UI via `--font-mono` + root `font-family`; buttons
  now `font-family: inherit`. Single 400 weight, so the pills' old `font-weight: 600` was dropped.
- First listen of a session also turns `on` (so first-timers hear something); after that the two
  stay independent. `on` is red when off, green when on (bevel color swaps).
- Raw/evolve: off = neutral gray bevel, dim text, unlit LED dot; on = full accent bevel, white
  glowing text, lit LED, outer glow. Evolve's disabled tooltip now says to turn `on` (not listen).
- Shake bolt centered over the size knob (hit area = knob wrapper width), measured equal centers.

## 2026-10-01 - Bare shake bolt; stray screenshot

- Shake button lost its body entirely (no bg/border/bevel) — just the white bolt with a dark
  drop-shadow for legibility, glow on hover. SVG viewBox cropped to the bolt's own bounds and
  left-aligned in its 34px hit area, so the visible bolt edge (not an invisible circle's) is what
  lines up with the size knob body — measured equal at 1200/600/375px.
- Moved the root-level `Screenshot 2026-10-01 at 15.28.54.png` into `screenshots/` (already
  gitignored). The global screenshot Stop hook missed it because it only scans `process.cwd()`,
  and this session's cwd had drifted into LIFE during dump commits.

## 2026-10-01 - Beveled color controls, `on` beside listen, bolt alignment

- Every knob/button body is now a beveled, hue-polarized gradient of its own accent color (lit
  top-left face → deep same-hue rim, tinted inner bevel edge) instead of shared dark gray. Shared
  `.bevel` class in `index.css` exposes `--bevel-bg` / `--bevel-inset` / `--bevel-border`, keyed off
  each element's `--bevel-color`, so hover/active glows can layer on without losing the bevel.
  Knobs use `--knob-color`; listen uses `--rainbow-6`; `on` `--rainbow-4`; raw/evolve their active
  colors; shake bolt neutral gray (stays monochrome). Knob notches lifted toward white so they still
  read against their own tinted body.
- `on` is now a 76px round button directly right of listen (128px) — between listen and the knobs
  in size. Raw/evolve stay right of volume. ≤480px: raw/evolve float above the on/volume end and
  the mix pair shifts to float over listen, otherwise the wider center row collides with both bottom
  corner clusters at 375px.
- Shake bolt left edge now matches the size knob *body* edge (8px in from the knob wrapper; ~11.6px
  on mobile where the body shrinks to 0.85x). Measured equal at 1200/600/375px in headless Chromium.

## 2026-10-01 - `listen` and `on` split; monochrome bolt

`listen` (mic -> grain pool) and new `on` (grain pool -> speakers) are now independent. Engine
split `start()`/`stop()` into `startListening`/`stopListening` + `startPlaying`/`stopPlaying` over
one lazily built, memoized graph. Idle (both off) suspends the AudioContext instead of closing it,
so the pool survives — record silently, play later. Output fades via masterGain ramp instead of
hard-stopping tails. `wantListening` flag cancels an in-flight getUserMedia if the hold is released
before the mic opens.

Hold-to-record: holding spacebar or long-pressing listen (350ms) turns `on` on and listens while
held; release stops listening only, playback keeps looping the capture. Spacebar is no longer a
listen toggle — tap the button for that. Long press warms the graph on pointerdown
(`engine.prepare`) since the hold fires from a timer, which mobile Safari doesn't count as a user
gesture. `on` lives as a pill atop the raw/evolve column; evolve now keys off `on`.

Shake bolt: ⚡ emoji replaced with inline SVG (`currentColor`, white) — fixes both the color and
the off-center baseline. Verified in headless Chromium (fake mic): all hold/tap/toggle state
transitions correct, no console errors.

## 2026-09-22 - Google Tag Manager wired in

Added the GTM-M5GKBML2 snippet (head script + body noscript iframe) to `index.html`, matching the
exact pattern already used on obfusco.us. Applied on `dev/v0` and separately on `main`, since the
two branches have diverged too far to merge for a one-line change.

## 2026-09-15 - GLOOP-specific /learn session, no code change

One `/dump` item: run a `/learn` session scoped to GLOOP itself — granular synthesis, control UX
arrangement, loop/sound synthesis design, satisfying experience. Research-only, no implementation
(per the `/learn` skill's own scope boundary). Ran `tone` + `webdev` against that topic; digest
saved to LIFE memory (`learn_digest_2026-09-15_tone_webdev_gloop.md`), emailed, and published to
cat.obfusco.us.

Notable findings: Perry Cook's NIME 2001 "instant music, subtlety later" principle and Mutable
Instruments Clouds' six-knobs-plus-one-multi-function-blend-knob approach, both as reference points
for how far GLOOP's control surface (11 knobs + 2 toggles as of today) can keep growing before it
stops reading as "instant." Checked GLOOP's actual `RotaryKnob.jsx` against current rotary-knob
accessibility practice and confirmed a real, previously-unflagged gap: no `role="slider"`, no
`aria-value*`, no keyboard/arrow-key support, no `touch-action: none` on the drag surface. Logged
to `worth-saving/gloop.md` as a candidate DUMP item rather than fixed here, since this was a
research pass, not a feature session.

Also worth noting for future `/dump` runs: the Inbox-flush helper script reported flushing an item
that, on inspection, was still sitting unmoved in `## Inbox` — moved it manually via a targeted
`Edit` instead of trusting the script's report blindly. Not investigated further; flagged here in
case it recurs.

## 2026-09-10 (evening) - Moved raw/evolve toggles to bottom-right of volume

One `/dump` item: "move raw and evolve buttons to bottom, to the right of volume." Both toggles
were living in the top-right corner cluster (raw pinned below feedback/repeat/sensitivity via an
absolute-position rule, evolve added alongside it in today's earlier session). Moved both into the
bottom `control-cluster--center` row, in a new `.control-cluster__utility-pair` column immediately
right of the volume knob, and dropped the now-unused top-right absolute-position CSS for the raw
toggle. Verified via Playwright screenshots at 375/430/600/700/900/1280px — no overlap with the
wow/flutter/wobble column at any width, including the narrow breakpoint where the granular/delay
mix pair already pops out above the listen button.

## 2026-09-10 (later) - NEAT crossover breeding for the host-parasite evolver

One `/dump` item, sourced from the same `worth-saving/gloop.md` NEAT finding (Aug 30) that flagged
innovation-number crossover as "the missing recombination-layer answer" for a future "breed two
presets together" feature. `src/audio/evolve.js`'s host-parasite population (added earlier today)
already has hosts occupying fixed slots, but every parasite until now was a mutation of a single
slot — no actual recombination between two diverged lineages.

Added: each slot now carries a per-param **innovation number** — the generation it was last
mutated — alongside its param values. About half of generations now breed two slots via real NEAT
crossover instead of mutating one: for each param key, if both parents agree on its innovation
number (neither has touched it since a shared ancestor), the value is inherited from either parent
at random ("matching" gene, NEAT's actual rule); if they disagree, it's inherited from whichever
parent has the higher fitness ("disjoint" gene). The bred result still gets the same point-mutation
pass as before on top, so it's crossover *and* mutation, not crossover replacing it. All slots seed
identical (innovation 0 everywhere) so early breeding is a no-op until mutations actually diverge
lineages — the same cold-start behavior real NEAT has with a homogeneous initial population.
Verified live via Playwright (mic + evolve toggle running through several generations), no console
errors.

## 2026-09-10 - Karplus-Strong tap sound, Avida host-parasite param evolution

Two `/dump` items, both from `/learn` findings logged in `worth-saving/gloop.md`.

**Karplus-Strong tap sound**: `playTapSound()` (the synthesized stand-in played when dragging/
tapping grains while not listening — see the 2026-08-13 entry below on why it existed as plain
band-passed noise, and why that read as a flat hiss) is now a real Karplus-Strong string/plate
model: a delay line + lowpass filter wired into a feedback loop, excited once by a short noise
burst. Pitch comes from vertical tap position (70Hz-1400Hz, exponential), decay length and filter
brightness from tap intensity. Same cheap technique covers plucked-string/struck-object/water-drip
character just by varying those few parameters — no separate models needed. Fitting, since the tap
gesture already represents striking the Chladni plate itself.

**Avida host-parasite parameter evolution**: new `src/audio/evolve.js`, an opt-in background
process (toggle button next to the raw-mic switch, disabled until listening) built only on
`engine.js`'s existing public API (`getParams`/`setParam`/`getAnalyser`) rather than reaching into
its internals. A fixed population of parameter-set "hosts" occupies 5 slots; each generation
(~2.4s) a "parasite" — a larger mutation of a random slot — is actually applied to the live engine
and, after a short settle window, scored against the incumbent host on a stability fitness read off
the same dominant-FFT-bin signal GrainField's own Chladni visualization already derives its
resonance mode from (silence can't win — fitness is stability × level, not stability alone). A host
that survives a challenge gets a small, decaying resistance bonus, so it's a real arms race rather
than a plain generational GA collapsing to whichever mutation scores highest once. Evolution is
audible/visible as it runs (params are genuinely live during evaluation, not simulated offline) —
the point is a generative instrument that keeps auditioning drifted versions of itself, not a hidden
optimizer. Verified both features via Playwright with a fake mic device — no console errors, evolve
toggle runs live generations, tap sound plays through the new KS graph.

## 2026-08-18 - Rerouted 4 misfiled VIBE items, no GLOOP change

`/dump`'s Inbox held 4 items referencing "vibe console," "vibe pill," and a "meditating hand" —
none of that terminology exists anywhere in GLOOP (checked `src/`); it's VIBE's. The two attached
screenshots were also sitting in GLOOP's repo root rather than VIBE's `screenshots/` dir, confirming
the whole entry (images + typed notes) landed in the wrong project's dump by mistake rather than
being a legitimate GLOOP request. Moved both screenshots into `vibe/screenshots/` and relocated the
4 items into `vibe.md`'s own Inbox (LIFE hub) so VIBE's next `/dump` picks them up instead of GLOOP
implementing console/pill UI that doesn't belong here. No GLOOP code or roadmap change this round.

## 2026-08-17 - Auto-sensitivity ramp for quiet rooms

One inbox item: "can the microphone increase sensitivity when not much sound is detected or not
much sound is being generated?" Previously `sensitivity` mapped to a *fixed* amplitude threshold
(`currentThreshold()` in `engine.js`) — input below it never got captured into the grain pool no
matter how long the room stayed quiet, so a soft-spoken room could sit gated out indefinitely
regardless of the dial position.

Changed `currentThreshold()` so the dial now sets a floor, not a fixed value: the longer input
stays below the effective threshold, the further it auto-ramps down, reaching
`AUTO_SENSITIVITY_MIN_RATIO` (25%) of the dial's threshold after `AUTO_SENSITIVITY_RAMP_SEC` (8s)
of continuous quiet. Tracked via a new `lastActiveTime` (an audio-context timestamp, reset to `now`
whenever a block crosses the then-current effective threshold) so the ramp ratchets back up to the
dial's baseline the instant real input returns, rather than needing a separate decay. Since the
existing `quietFactor` (repeat/sustain ceiling, quiet-time delay boost) already calls
`currentThreshold()`, it inherits the same ramped value for free — no separate wiring needed there.

## 2026-08-13 - Explained the tap-drag hiss

Third `/dump` of the day, one priority question, no code change: "what is the hissing sound that
occurs when it's not listening and i move the grains around?" That's `playTapSound()` in
`engine.js` — the synthesized stand-in used when dragging grains while not listening, since there's
no live mic capture to pull a real grain from at that point. It's built from literal band-passed
white noise (a 0.3s buffer of pure random samples, bandpass-filtered by vertical drag position, short
exponential-decay envelope), which is inherently going to read as a hiss/whistle burst — working as
designed, not a bug. Left open whether the user wants it to sound less noisy/more tonal instead.

## 2026-08-13 (later) - Real fix for loudness, quiet-time echo boost, background spin/pan, size range to 3s

Second `/dump` of the day, eight items across two rounds (three items landed, then five more
appeared in the Inbox mid-run — handled in the same pass per the usual re-flush-before-commit step).

**The earlier same-day 2x volume boost wasn't actually landing** ("still needs to be louder by
default"). Root cause: the safety limiter — `ctx.createDynamicsCompressor()` at -6dB threshold,
12:1 ratio, no makeup gain — was squashing almost all of that extra gain back down before it ever
reached the speakers; a hard compression ratio like that barely lets anything above threshold
through regardless of how much gain feeds it. Loosened the limiter (threshold -6→-3dB, ratio 12→8,
knee 12→6) and added a fixed `LIMITER_MAKEUP_GAIN=1.4` gain stage after it to recover the loudness
compression takes back out, plus bumped `OUTPUT_BOOST` 2→3. This is the kind of thing that's easy to
get wrong by eye — the gain-staging math (`engine.js` code comments) is there so the next tuning pass
doesn't repeat the same mistake.

**Quiet-time echo boost** — "when it's not picking up sound it should be reflecting back the other
sounds louder... let me know better controls if that would help." The existing sustain-on-silence
behavior only stretched the echo's *decay time*, not its *level*, so a quiet room's echo lingered
longer without actually sounding more present. Reused the existing `quietFactor` (already driving the
repeat/sustain ceiling) to also scale `delayMixGain` up to 80% louder (`QUIET_DELAY_BOOST_MAX=0.8`) at
full quiet, fading back to normal the moment live input resumes. Deliberately didn't add a new dial —
this rides the existing `sensitivity` control's quiet-detection threshold, which already governs
when this kicks in.

**Background spin/pan tied to touch physics** — GrainField's nodal/color pattern now has a slow
ambient spin + horizontal/vertical pan, plus decaying momentum nudged by drag direction/distance so a
swipe leaves it turning/drifting for about a second before settling. Applied as a rotation of the
(u,v) sampling coordinates rather than an actual Three.js object rotation, specifically so grains'
real world positions stay untouched — the pointer-push interaction math compares screen coordinates
directly against grain positions, and rotating the *mesh* instead of the *pattern* would have thrown
that off more and more as the rotation accumulated. First implementation had a real tuning bug: a 0.99
per-frame velocity decay meant a single drag's many `pointermove` events integrated (geometric-series
sum ≈ gain/(1-decay)) into a wildly oversized jump instead of a gentle nudge — caught by comparing
before/after Playwright screenshots of a simulated drag, not just by reading the code. Retuned decay
and gain together (0.95 decay, 0.01 gain) so a firm swipe now produces a moderate, temporary shift.

**Size dial range widened to 3s** ("increase the values available via size so 400ms is the default
and so size goes up to 3s") — this had a real hidden dependency: the grain pool's buffers were
hardcoded to hold only 400ms of captured audio (`Math.ceil((ctx.sampleRate * 400) / 1000)`), so any
grain size above that would have silently failed to play (`playGrain`'s own `grainSamples >
src.length` guard just returns early, no error, no sound). Added `SIZE_MAX_MS=3000` and resized the
pool buffers off it, and grew `MAX_DELAY_SEC` (was hardcoded to 2, matching the old grain-size
ceiling) so the per-grain delay time can actually track grain size up to the new max instead of
silently clamping. Verified by dragging the size knob to max in a live Playwright session and
confirming grains still render/animate (no silent failure).

**Sand particle size now follows the size dial** — `GrainField` takes a new `grainSizeMs` prop,
read via a ref inside the render loop (not an effect dependency, so dragging the knob doesn't tear
down and rebuild the whole three.js scene) and mapped through a sqrt curve to the rendered
`THREE.PointsMaterial.size` — sqrt so 3s grains don't render literally 100x bigger than 30ms ones.

**Density default raised to 60%** (was 35%).

**Raw-mic toggle's "float below the row, right-aligned" placement is now permanent**, not just a
sub-700px override — it was fighting for space in the feedback/repeat/sensitivity row at desktop
widths too.

**Waveform visualizer got a playful wobble** — a slow traveling sine (0.5Hz, ~2.5 humps across the
width, 2% of canvas height amplitude) added on top of the real time-domain trace, distinct from the
audio engine's own wow/flutter (purely cosmetic, doesn't touch playback).

## 2026-08-13 - Output volume 2x

`/dump` with one inbox item: "increase output volume by 2x." The `volume` dial already ranges 0-1
and was applied directly to `masterGain.gain.value`, so it was already at its ceiling — doubling
loudness meant adding a multiplier on top of the dial rather than changing the dial's own range.
Added `OUTPUT_BOOST = 2` in `engine.js`, applied to `masterGain.gain.value` in both `start()`'s
initial value and the `volume` branch of `setParam()`. The existing safety limiter (dynamics
compressor on the final output, added for the same "high feedback/volume" clipping risk) already
covers the louder signal, so no other changes needed.

## 2026-08-12 - Waveform overlay, louder loopback defaults, mobile overlap fix

`/dump` with five inbox items.

**Fixed a real mobile control-overlap bug**, verified with Playwright screenshots at several
viewport widths rather than guessing from the CSS alone. Two distinct overlaps existed:
`.control-cluster--top-left`/`--top-right` had no width cap, so on narrow-but-not-tiny widths
(~600-650px — common landscape-phone/small-tablet range, outside the existing ≤480px mobile query)
their intrinsic content width could exceed half the viewport and collide; fixed with `max-width: 46vw`
+ `flex-wrap: wrap` on both, so knobs that don't fit wrap onto a second line instead. Separately, the
granular/delay mix-pair's "float above listen" mobile treatment only kicked in at ≤480px, but at
~600-650px it was still sitting in-row next to the listen button, where its left edge landed under
`.control-cluster--bottom-left`'s size/density row — widened that breakpoint to 700px. Screenshotting
at 375×667 (iPhone SE class) surfaced a third, unrelated overlap even after those two fixes: the
bottom-left size+density row's right edge extends under the centered listen button at that width, and
since the button paints later in DOM order it visibly covers the density knob. Fixed by stacking
size/density into a single column instead of a row below 430px width.

**Bigger default grain size and rate** — `GRAIN_MS_DEFAULT` 120ms→400ms, `RATE_MS_DEFAULT` 26ms→200ms
in `engine.js`, per request ("size much larger like 400ms", "rate more like 200ms").

**Louder default loopback** — `feedback` default 0.45→0.65 and `repeat` default 0.4→0.65, so a fresh
session echoes more readily out of the box without needing to reach for those dials first.

**New waveform overlay layer** (`WaveformOverlay.jsx`/`.css`) — a second visual layer over the plate,
per request: a live time-domain trace of the actual output (reads the same `analyser` node already
tapped from `masterGain`, so it's showing the looped-back grain/delay mix, not raw mic input), drawn
on a `<canvas>` fixed at 50vh tall and vertically centered in the viewport, `pointer-events: none` and
faded out via opacity transition when not listening. Positioned `z-index: 1` — above the GrainField
three.js canvas, below the `controls-overlay` (`z-index: 2`) — with a rainbow-gradient stroke matching
the existing `--rainbow-*` palette. Verified rendering (not just wiring) via Playwright with
Chromium's fake-mic-device flags, confirming a visible trace appears mid-screen once "listen" is
active.

## 2026-07-26 (later) - Moved mix knobs left of listen, opt-in raw-mic toggle

Second `/dump` of the day, two items.

**Moved granular/delay off the top-center row to the left of the listen button**, per request.
Wrapped them in a new `.control-cluster__mix-pair` div inside `.control-cluster--center`, rendered
before `.listen-wrap` (so they sit to its left) with `volume` staying to the right. At narrow
(≤480px) widths this collided with the bottom-left corner cluster (shake bolt/size/density) —
measured via Playwright `getBoundingClientRect()` rather than eyeballing it, since the previous
top-center placement had already shown eyeballing alone isn't reliable at this screen size — so the
mobile media query now pulls `.control-cluster__mix-pair` out of flow (`position: absolute; bottom:
100%`) and floats it in its own centered row directly above listen/volume instead of beside them.
Removed the now-unused `control-cluster--top-center` rule.

**Added an opt-in raw-mic toggle** (`MicModeToggle.jsx`/`.css`, new files) — a small pill button next
to `sensitivity` labeled "raw". User suspected the "choppy, cuts off" recordings are the browser's
default echoCancellation/noiseSuppression/autoGainControl processing again (noise suppression's
gating is the classic cause of exactly this symptom). This is the same theory as the 2026-07-25
entry below, which tried disabling all three as the *default* and had to be reverted — measured via
Chromium's fake-device harness that doing so drops the signal to near-silence. That revert's own
comment said any future attempt "needs to be an opt-in, not a default," so that's what this is:
`engine.js` now exposes `setRawCapture`/`getRawCapture`, and `start()`'s `getUserMedia` call branches
on it (plain `audio: true` by default, all three constraints forced `false` when opted in). Verified
the toggle wires up and mic capture still starts cleanly under both settings via Playwright with the
fake mic device — but that harness is exactly what previously masked a real regression, so it can
only confirm the toggle *works*, not that raw capture actually sounds better on real hardware. That
part needs an actual listening pass on a real mic, which matches the existing ROADMAP note that some
audio-quality items can't be judged from this environment.

## 2026-07-26 - Split granular/delay mix knobs

`/dump` item: user felt some of the audio balance trouble traced back to not having independent
control over the direct granular voice vs. the dynamic-delay/feedback echo — both were only
reachable through the combined `mix`/`feedback` dials, with no way to push one down relative to the
other.

**Split the output path in `engine.js`'s `playGrain()`** into two separately-gained stages:
`granularMixGain` (wraps the direct `panner -> masterGain` path — the dry grain hits) and
`delayMixGain` (wraps `feedbackGain -> masterGain` — the delay-network echo return), each reading a
new `state.granularMix`/`state.delayMix` (0-1, default 1 so existing sessions sound unchanged until
the user pulls a knob down). Both are read fresh per grain like `feedback`/`dynamics`/`density`
already are — no persistent `AudioParam` plumbing needed since these nodes are recreated every grain
fire. Added disconnect calls for both alongside the existing `delay`/`feedbackGain` teardown.

**New `granular`/`delay` knobs** (`App.jsx`) in their own `control-cluster--top-center`, sized 60px
— bigger than the standard 48px dial per the "big mix knobs" ask — sitting in its own row below the
top-left/top-right corner clusters (not sharing their row) so it doesn't collide with them at
mobile widths; verified at both a 1280px desktop viewport and a 375px mobile viewport via Playwright
with Chromium's fake mic device. New `--color-granular-mix`/`--color-delay-mix` CSS vars
(`index.css`). Excluded from the shake-randomize set, same rationale as `volume` — a shake should
reshuffle texture, not suddenly mute one half of the signal path.

## 2026-07-25 - Reverted echo-cancellation fix (broke capture), volume placement, shake/randomize bolt

Third `/dump` of the day. Priority item: **"now I don't hear any sound no matter what on dev — main
still has the choppy sound I was hearing before, so something is up with the dev branch."** A real
regression report, investigated and fixed first before touching the other two queued items.

**Root-caused to the previous entry's echoCancellation/noiseSuppression/autoGainControl fix.**
Built a `vite preview` of the actual production bundle (dev-server testing earlier today never
exercised this — `gloop-dev.obfusco.us` serves the built bundle, not the dev server) and measured
the post-`masterGain` signal via Playwright with Chromium's fake mic device: exactly `0` RMS in one
run, and no meaningful signal in repeated runs. Isolated further by requesting each of the three
constraints individually via `getUserMedia` directly (bypassing the app): `echoCancellation: false`
alone drops Chromium's fake-device signal to literal digital silence, and `noiseSuppression`/
`autoGainControl: false` each drop it to near-zero too. This is a known rough edge — disabling AEC
routes capture through an unprocessed path that some platforms/audio backends handle poorly — and
it's a much worse failure mode than the suppression problem that fix was meant to solve. **Reverted
back to plain `audio: true`.** The theory that AEC fights GLOOP's speaker-into-mic feedback loop
may still be right, but it can't be a silent default again — if revisited, it needs to be an
explicit opt-in the user can compare against, not something landed sight-unseen. Left a comment in
`engine.js` at the revert site explaining what was tried and why it came back out, so this doesn't
get re-attempted blind.

(Note for the record: the earlier hardening of the AudioWorklet loading path — forcing
`recorder-processor.js` to always emit as a real file instead of a `data:` URI — was *not* the
cause. Confirmed the file serves correctly via direct `curl`, and the missing network-request log
for it in every Playwright run turned out to be a consistent CDP/Playwright visibility gap for
AudioWorklet module fetches specifically, present on both the dev server and the production
preview, unrelated to whether the file is data-URI-inlined or a real asset.)

**Volume moved to the right of the listen button** (`App.jsx`/`App.css`) — was stacked above it in
the center cluster; `.control-cluster--center` switched from column to row and the DOM order
swapped so volume renders after (to the right of) `.listen-wrap`.

**Added a shake/randomize bolt** (`ShakeButton.jsx`/`.css`, new files), placed above the size knob
in the bottom-left cluster per the ask — `.control-cluster--bottom-left` is now a column with the
bolt on top and a new `.control-cluster__row` wrapping the existing size/density pair beneath it.
Adapted from ribbon's `MiniShakeBolt`/`⚡` pattern (see `~/Sites/ribbon/src/components/Controls.jsx`)
rather than reinvented: clicking it randomizes rate/dynamics/feedback/repeat/sensitivity/
grainSizeMs/density/wow/flutter/wobble within each dial's own range, and nudges the live grain
stream via the existing `engine.perturb(1)` if listening — mirrors ribbon's convention of
deliberately excluding master volume from the randomization set. Unlike ribbon (which shakes the
whole containing panel), only the bolt icon itself plays the shake wiggle animation — GLOOP's
established direction has been consistently toward *calmer* motion (multiple past sessions'
feedback: "still too fast," "calmer ripple"), so a full-panel or full-screen shake would cut against
that.

Verified with Playwright: screenshot confirms bolt sits above size/density, volume sits right of
listen; measured bounding boxes to confirm both positioning asks numerically, not just visually;
clicking shake produces no console/page errors. Re-verified the signal-restoration fix on both
`npm run dev` and `npm run preview` (production bundle) — nonzero RMS on both after the revert,
where the broken version measured zero specifically on the production-bundle path.

## 2026-07-25 - Echo-cancellation fix, worklet data:URI hardening, edge-lap loop indicator

Follow-up `/dump` after switching active work to `dev/v0` (see below): two new reports —
"loop indicator should cycle the whole screen, not just the listen button" (with a screenshot),
and "gloop isn't providing much feedback no matter how I adjust the controls, think we lost
something in the last changes."

**Investigated the "lost feedback" report first**, since it read as a possible regression from
today's earlier AudioWorklet migration. Built worktrees at the pre-AudioWorklet commit (`f39353c`)
and one further back before the limiter/highpass pass (`a8a721c`), and measured the actual
post-`masterGain` analyser signal (RMS/peak) via Playwright with Chromium's fake mic device across
all three. Levels were low and comparable across all of them — no clear amplitude regression
traceable to any specific recent commit via this synthetic signal (the fake device's synthesized
tone is a limited proxy for real mic input either way, so this doesn't fully exonerate anything,
but it ruled out an obvious "recent code change broke it" bug).

**Found something more likely to be the actual cause, and unrelated to any of today's or
yesterday's changes**: `engine.js`'s `getUserMedia` call has always used the bare `{ audio: true }`
constraint (since the original scaffold), which leaves the browser's default call-quality audio
processing on — echo cancellation, noise suppression, auto-gain. Echo cancellation in particular
exists specifically to detect and cancel out a speaker's output re-entering the mic, which is
*exactly* the room/speaker feedback loop GLOOP is built to capture and re-loop as a granular echo.
This would suppress the effect regardless of any dial setting, matching "no matter how I adjust
the controls" precisely — and would have been true since 2026-07-12, just not necessarily this
noticeable until now (depends heavily on room/hardware/browser AEC aggressiveness). Fixed by
requesting `{ echoCancellation: false, noiseSuppression: false, autoGainControl: false }`
explicitly. Genuinely uncertain this is the *whole* story — flagged the still-open
"tune defaults" roadmap item to be revisited after this, since defaults tuned against an
AEC-fighting signal may read completely differently now.

**Also hardened the AudioWorklet loading path** while investigating: the production build was
base64-inlining `recorder-processor.js` as a `data:` URI (it's tiny, under Vite's default 4KB
inline threshold), which `audioWorklet.addModule()` has had inconsistent cross-browser support
for historically (unlike a normal `<script src>` or `<img src>`). Set `assetsInlineLimit: 0` in
`vite.config.js` so it — and any future small asset — always emits as a real fetchable file
instead. Confirmed via `npm run build`: `recorder-processor.js` now ships as its own
`dist/assets/recorder-processor-*.js`.

**Loop indicator redesigned** (`LoopIndicator.jsx`/`.css`) to lap the full screen edges instead of
circling the listen button — a small dot travels around the four edges of the same safe-area inset
the floating control clusters use, in even time-quarters per edge (plain `left`/`top` keyframes
rather than `offset-path: border-box`, to avoid depending on newer/less consistent browser
support). The persistent dashed "track" outline and the per-grain flash pulse both carried over
from the old design, but the flash now lives on a separate nested element from the one running the
continuous travel animation — toggling the flash class (which happens up to ~40x/sec at fast rates)
would otherwise restart the travel animation too and make the dot stutter back to the corner on
every grain fire instead of lapping smoothly. Verified with Playwright: sampled the dot's bounding
box 8 times across a lap and confirmed it visits the full x/y range of the viewport, not a small
region near center.

Verified overall with `npm run lint`, `npm run build`, and Playwright (fake mic device): no
console/page errors across mic-start, grain playback, and the new loop-indicator path.

**Branch note**: this and all further work lands on `dev/v0`, not `main` — see prior session's
`main` push, which the user asked to stop.

## 2026-07-25 - AudioWorklet migration, mobile mic-permission UX, code-split GrainField

Worked through the roadmap's remaining items (`/dump` — "complete all active tasks in the roadmap"):

- **`ScriptProcessor` → `AudioWorklet`** (`src/audio/recorder-processor.js`, new file). Grain-pool
  capture now runs on the dedicated audio render thread instead of main, which was the biggest
  remaining glitch-risk lever now that WebGL rendering also does meaningfully more main-thread work
  than the original scaffold (see 2026-07-24 sound-quality entry). The processor accumulates
  128-sample render quantums into 2048-sample blocks (matching the old `ScriptProcessor`
  `bufferSize`) before posting to the main thread via a transferred buffer, keeping message-passing
  overhead comparable (~21 msg/sec) rather than firing every quantum. Loaded via
  `new URL('./recorder-processor.js', import.meta.url)` + `ctx.audioWorklet.addModule()` — Vite
  base64-inlines the small file as a `data:` URI in the production bundle, which `addModule()`
  accepts natively. Verified with Playwright (fake mic device): grain capture, playback, and the
  listen-button start/stop cycle all work with zero console/page errors.
- **Mobile mic-permission UX pass.** `engine.start()` previously let `getUserMedia` rejections
  propagate uncaught — on mobile this is the case that actually gets hit (permission denied,
  no mic hardware, testing over insecure `http://` on a LAN IP, mic already claimed by another
  app), and it failed completely silently. `App.jsx`'s `toggle()` now catches the error and shows
  a small dismissible toast (`.mic-error-toast`, styled as a floating pill above the listen button
  to match the console-less UI, not a modal) with a message mapped from the DOMException's `name`.
  Also added an explicit `navigator.mediaDevices?.getUserMedia` check up front for the insecure-
  context case, which otherwise throws a confusing "Cannot read properties of undefined."
  **Found and fixed a real latent bug in the process**: on a failed `getUserMedia` call, `ctx` had
  already been assigned before the throw and was never reset — every subsequent listen-button tap
  would silently no-op via the `if (ctx) return` guard at the top of `start()`, with no error and
  no way to recover short of a page reload. Fixed by wrapping the `getUserMedia` call in try/catch,
  closing and nulling `ctx` on failure. Verified with Playwright: patched `getUserMedia` to count
  real invocations while denying every call — confirmed 2 listen-button clicks now produce 2 real
  attempts and 2 toasts (the pre-fix behavior would have shown the toast only once).
- **Code-split `GrainField`** behind `React.lazy()` + `Suspense` (`App.jsx`). three.js is the
  reason the bundle grew from ~205KB to ~715KB (2026-07-24 entry); it now ships as its own
  ~509KB chunk fetched after the initial shell renders, rather than blocking on it. Verified via
  `npm run build`.
- **Left open, need a human**: tuning default grain size/feedback/spread for "a good first
  impression" needs an actual listening pass, and verifying the 80000-grain field's framerate
  needs real (ideally mobile) hardware — both are judgment calls a headless environment can't make.
  Left on `ROADMAP.md` rather than guessed at.

## 2026-07-24 - Sound quality pass + more polish on the 3D plate

**Sound quality** (answering "how can I improve the quality of the sound
produced?" — see chat for the full answer, this is the part actioned now):

- Safety limiter (`DynamicsCompressorNode`, threshold -6dB, ratio 12:1) now
  sits between `masterGain` and `ctx.destination`. Feedback goes up to 0.95
  and silence-sustain tails can run 30s, so overlapping grain feedback
  loops could genuinely sum into harsh digital clipping at higher
  feedback/volume settings — this catches it instead of letting it distort.
- Highpass filter (70Hz) on the mic input, before it ever reaches the grain
  pool — removes rumble/handling noise and DC bias from the source
  material itself, so every grain pulled from it is already clean, rather
  than filtering the mix after the fact.
- Grain envelope switched from linear to exponential attack/release. Linear
  ramps have an audible "zipper" edge at each grain boundary, especially
  with several grains overlapping at once (default rate/grainSize overlap
  ~4-5x) — exponential is the standard smoother envelope shape for
  granular synthesis.
- Biggest remaining lever, not done here: migrating capture off
  `ScriptProcessorNode` (main-thread, deprecated) to an `AudioWorklet`
  (already tracked in ROADMAP) — main-thread contention between audio
  capture and the WebGL grain-field render is a real glitch risk now that
  both are doing meaningfully more work than the original scaffold.

**3D plate polish**, third round of feedback on the same day's work:

- Pointer-push force cut 5x (0.03 → 0.006) — a real scaling bug from
  extending grains across the full plate: the displacement was scaled by
  `GRAIN_SPAN` to preserve the *radius* correctly, but that also scaled how
  *far* pushed grains flew, which is why a tap was flinging sand across
  half the screen.
- Ambient animation speed cut again (ripple/hue-drift/camera-sway
  multipliers roughly halved once more) and the n/m/amplitude smoothing
  eased more slowly too, per repeated "still too fast" feedback.
- Grain count 5x'd again (16000 → 80000) per "want to see many many more."
  Measured 31fps under headless *software* GL at this count (down from
  60fps at 16000) — SwiftShader is a pessimistic proxy without a real GPU,
  but this is a real cost worth watching on lower-end/mobile hardware; flag
  if it feels janky on an actual device and it can be dialed back.
- Spacebar now toggles listening both ways (previously stop-only).

## 2026-07-24 - Root-caused the flicker, slowed motion, 4x grain count

Found the actual cause of "the 3D stuff is super flickery": `n`, `m` (the
Chladni mode numbers) and `amplitude` were read directly off the raw
per-frame dominant FFT bin with zero smoothing. Real (and even synthetic
test) mic input is noisy frame to frame, so the whole height field could
snap between very different standing-wave shapes on consecutive frames —
invisible-ish on the old flat 2D canvas, but very obvious as discontinuous
jumps once the same data drives real 3D shading. Fixed by easing `n`/`m` as
continuous floats (not integers — `sin(nπu)` is perfectly well-defined for
non-integer `n`, so this morphs smoothly between resonance patterns instead
of jumping) and `amplitude` toward their per-frame targets each frame,
rather than snapping straight to them.

Also slowed the ambient animation itself per feedback ("needs to move much
slower"): the ripple's temporal terms, the plate's hue-drift rate, and the
camera's idle sway were all roughly halved to a third of their previous
speed.

**Grain count 4x'd** (4000 → 16000) per "want to see many many more sand
grains." Verified via Playwright that this still holds a steady 60fps even
under headless *software* GL rendering (SwiftShader, no real GPU) — real
hardware should have plenty of margin.

## 2026-07-24 - Grains span the full screen + tap-to-play while idle

Two more follow-ups on the same day's plate work:

- **Grains now roam the full plate, not just the original central tile.**
  They were still confined to the `GRAIN_AREA_SIZE` (2-unit) square even
  after the plate mesh itself was enlarged to fill the screen. Introduced
  `GRAIN_SPAN` (`PLATE_MESH_SIZE / GRAIN_AREA_SIZE` = 5) as how many
  Chladni-pattern tile-widths grains can now wander across; the nodal drift
  math reads the fractional part of each grain's position (`x - floor(x)`)
  to sample the periodic pattern, same trick the plate mesh already used.
  Grain count scaled from 800 to `800 * GRAIN_SPAN` (4000) — scaled with the
  *linear* span rather than the full 25x area increase, to keep the
  per-frame grain loop's cost reasonable while still giving decent coverage
  edge to edge. Pointer-push physics were re-derived in normalized [0,1]
  terms so the push still feels identical regardless of the larger roaming
  domain.
- **Tapping the grains while not listening now makes a sound.** Previously
  `onInteract` always called `engine.perturb()`, which only nudges
  parameters of an already-running grain stream — with no live mic capture
  active, a tap did nothing audible at all. Added `engine.playTapSound(nx,
  ny, intensity)`: a short bandpass-filtered noise burst (pitch from
  vertical tap position, pan from horizontal, level/duration from
  intensity) through a lazily-created, independent `AudioContext` — a
  synthesized stand-in for "what this grain rearrangement would sound
  like," since there's no real captured audio to draw an actual grain from
  in that state. `App.jsx`'s `handleInteract` now branches on `running`:
  perturb the live stream if listening, play the tap synth otherwise.

Verified with Playwright: grains render across the full frame (screenshot),
and tapping while stopped exercises the new code path with no console/page
errors.

## 2026-07-24 - Plate tuning pass + real fix for echo dying out in silence

Follow-up feedback on the same day's 3D plate + sustain work:

- **Plate now spans the full screen.** Previously the plate mesh was sized
  to exactly match the grains' own 2×2 physical area, so at most camera
  angles/aspect ratios its edges fell inside the viewport, leaving visible
  black margins. Decoupled the two: grains still live in a `GRAIN_AREA_SIZE`
  (2-unit) square as before, but the visible mesh is now a much larger
  `PLATE_MESH_SIZE` (10 units) whose u/v (for the nodal height function) is
  still computed on the original 2-unit basis — `sin()` is periodic, so the
  Chladni pattern tiles seamlessly outward across the bigger mesh with no
  seam, and its edges now sit off-screen at any reasonable aspect ratio.
- **Ripple amplitude cut 10x** (`NODAL_HEIGHT_SCALE` 0.18→0.018,
  `RIPPLE_HEIGHT_SCALE` 0.05→0.005, `HOVER_HEIGHT` scaled down to match)
  per feedback that the motion read as jerky/chaotic.
- **Defaults tuned for "not enough sound happening"**: `RATE_MS_DEFAULT`
  130→26ms (grains fire ~5x more often out of the box) and default
  `sensitivity` 0.5→0.1 (pushes the effective quiet-threshold up, so the
  sustain/freeze behavior below engages far more readily at the stock
  setting instead of sitting in a middle ground).
- **The actual bug behind "echo doesn't really continue in silence"**:
  last session's sustain fix only stretched how long the feedback *decay*
  took, but the grain pool kept recording live audio the entire time — so
  after ~`POOL_SIZE × 400ms` (~9.6s) of true quiet, every buffer slot had
  already been overwritten with near-silence, and grains had nothing real
  left to echo no matter how long the decay ceiling was. Real fix: while
  `inputLevel` is below the sensitivity threshold, `onaudioprocess` now
  skips writing into the pool entirely (see `currentThreshold()` in
  `engine.js`) — the last real captured audio just keeps getting re-drawn
  from indefinitely until fresh sound pushes the level back above
  threshold. Combined with the existing decay-ceiling stretch, this is what
  actually makes the loop feel like it "just continues."
- **Spacebar stops listening** — a fast kill-switch that doesn't require
  aiming for the listen button (`App.jsx`, gated on `running` so it doesn't
  eat the page-scroll spacebar when idle).

Verified with Playwright: new `rate`/`sensitivity` defaults round-trip
correctly, spacebar toggles `running` off, screenshots confirm the plate
fills the frame edge-to-edge with visibly calmer motion.

## 2026-07-24 - 3D liquid plate (three.js) + audness confirmation

**Grain field is now a real 3D scene (three.js/WebGL), not a flat 2D canvas.**
The plate is a rippling mesh whose height comes from the *same* Chladni
nodal function that already drove grain drift (`nodalValue(n, m, u, v)`,
now shared between plate and grains), plus a small ambient traveling ripple
so the plate stays alive even at rest. Grains are rendered as additive-blend
`THREE.Points`, hovering `HOVER_HEIGHT` above the plate's live surface
height at their own (x, y) — the "gliding above the plate due to acoustic
resonance" effect the dump asked for. Grain drift/pointer-push physics are
otherwise unchanged from the 2D version (same math, just also driving a 3D
Y position now).

- Plate vertex colors: hue swept by position (`(u+v)/2`) plus a slow time
  drift, brightness driven by ripple height — first pass used hue-by-time-only
  and rendered as a flat muddy brown; fixed by making hue vary spatially so
  the surface reads as an actual moving rainbow gradient (verified via
  Playwright screenshot before/after).
- Fixed camera with a small continuous positional sway (not user-orbitable)
  — keeps the "console-less," no-extra-chrome feel while still making the
  3D depth/parallax legible at a glance.
- Kept "lightly" in scope per the ask: `antialias: false`, pixel ratio
  capped at 2, same grain count (800) as the 2D version, moderate plate
  subdivision (56×56 segments), no lights/shadows (unlit `MeshBasicMaterial`
  with vertex colors) — computeVertexNormals() was dropped since nothing
  reads normals without lighting.
- New dependency: `three` (~0.185). Bundle grew from ~205KB to ~715KB
  (~65KB→~194KB gzip) — a real, known tradeoff of moving off Canvas 2D,
  worth watching on slow mobile connections but not addressed further here.
- Verified with Playwright: no console/page errors, screenshots confirm
  correct rendering both idle and while listening (nodal lines visible as
  grains trace bright paths across the rippling surface).

**Audness question answered**: confirmed GLOOP does not use `@audness/core`
and shouldn't — audness is a synth-voice engine (oscillators/VCF/bitcrush),
has zero mic-capture or granular-synthesis capability, and was never a fit
for what GLOOP needs. See CLAUDE.md's new Audness section.

**Dev branch**: cut `dev/v0` from `main`, pushed — confirmed it auto-deploys
to gloop-dev.obfusco.us (previously 403/empty) via the existing
`dev/**`-triggered workflow job. It's identical to `main`'s tip as of this
push, so there was nothing to "merge forward" yet.

## 2026-07-24 - Sustain-on-silence + sensitivity dial

Feedback previously always decayed over a fixed `repeat`-controlled window
(250ms-6s) regardless of whether the mic was still hearing anything, so the
echo died out quickly even with nothing new competing for attention.

- `engine.js` now tracks a rolling input-level estimate (per-block RMS,
  smoothed 85/15 across blocks) in the `ScriptProcessor` capture callback.
- New `sensitivity` param (0-1, default 0.5) maps to an amplitude threshold
  (0.05 down to 0.002 as sensitivity rises) — the level below which live
  input counts as "not presently hearing new sound."
- The repeat-time ceiling (`REPEAT_MAX_MS`, 6s) now stretches toward a new
  `SUSTAIN_MAX_MS` (30s) in proportion to how far below that threshold the
  current input level sits (`quietFactor`), so the loop becomes a much
  longer, more persistent wash of echoes while quiet, and behaves exactly
  as before while actively fed. Bounded and self-decaying either way — no
  true infinite freeze/looper, which would need buffer-pool freezing and
  was out of scope for this ask.
- New `sensitivity` RotaryKnob added next to feedback/repeat in the
  top-right cluster (`App.jsx`, `--color-sensitivity` teal in `index.css`).

Verified with Playwright (fake mic device): param round-trips correctly via
setParam/getParams, and audio output stays nonzero (sampled over ~1s to
avoid catching an inter-grain gap) after the change.

## 2026-07-23 - Fix: total silence bug (ScriptProcessor never fired)

User reported no sound at all. Root cause was in `src/audio/engine.js`,
present since the original scaffold (2026-07-12): the mic-capture
`ScriptProcessorNode` was connected to a freshly created `GainNode` that
was never itself connected onward to `ctx.destination` —

```js
recorderNode.connect(ctx.createGain()) // silent sink
```

Chrome/Firefox only reliably fire `onaudioprocess` once the node graph
reaches the destination; this dangling node meant `onaudioprocess` never
ran, so the grain buffer pool stayed all-zero forever. Grain scheduling,
the loop indicator, and the Chladni visualization all worked fine (none
of them depend on real mic data), which is why this went unnoticed —
every grain was faithfully playing back silence.

Fix: route the sink through an explicit zero-gain node connected to
`ctx.destination`, satisfying the browser's graph requirement without
audibly passing raw mic input through:

```js
const silentSink = ctx.createGain()
silentSink.gain.value = 0
recorderNode.connect(silentSink)
silentSink.connect(ctx.destination)
```

Verified with Playwright + Chrome's fake-mic-device flags: analyser
time-domain data was exactly `0` (true digital silence) before the fix
and nonzero after, on the same build.

## 2026-07-23 - AWS infra provisioned: gloop.obfusco.us + gloop-dev.obfusco.us live

Provisioned by inspecting `now.obfusco.us`'s *live* AWS config directly (more
reliable than sibling DEVLOG prose, which turned out stale — several claimed
"S3 static website hosting + public bucket policy" but the actual running
setup is private buckets behind CloudFront Origin Access Control):

- S3 buckets `gloop.obfusco.us` / `gloop-dev.obfusco.us` — private, all
  public-access-block flags on, bucket policy scopes `s3:GetObject` to
  `cloudfront.amazonaws.com` conditioned on each distribution's own ARN.
- CloudFront distributions: prod `E1OR0VU2T3D7I5`
  (d1eixcc7pe2gns.cloudfront.net), dev `E1EW5T5VWLL28W`
  (d3qtibdrec7700.cloudfront.net). Each has its own OAC (prod
  `E3GA4G20VS4SMF`, dev `E230UICKWZMB8Q`), the shared `*.obfusco.us`
  wildcard ACM cert (us-east-1), AWS's managed CachingOptimized cache
  policy, and a 404→`/index.html` (200) custom error response for SPA
  routing.
- Route53 A-alias records added in the `obfusco.us` hosted zone
  (`Z2YGI1EJ2R4PG0`) for both subdomains, pointing at their distributions
  via the fixed CloudFront alias hosted-zone-id `Z2FDTNDATAQYW2`.
- **Credentials — deviated from convention on purpose**: every other
  lineage project shares one IAM user (`github-actions-moomaw`) via an
  inline `moomaw-deploy` policy, but that user already had AWS's max of 2
  active access keys and I couldn't retrieve either existing secret value
  (write-only once set) or safely tell which live site depends on which
  key. Rather than rotate a key some other repo might still need, created
  a new dedicated IAM user `github-actions-gloop` with its own minimal
  inline policy (scoped only to gloop's 2 buckets + 2 distributions) and
  set its key as this repo's `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`
  secrets. Zero risk to now/tuner/ribbon/vibe/moveloose/puddle's deploys.
- `.github/workflows/deploy.yml` added, mirroring `now`'s workflow
  structure (lint → build → verify `dist/index.html` → configure AWS creds
  → `aws s3 sync --delete` → CloudFront invalidation → smoke-test curl),
  `main` → prod job, `dev/**` → dev job.

## 2026-07-23 - Workspace theme, DIGEST confirmation, DNS check

- Added `.vscode/settings.json` — GLOOP now has its own editor color theme
  (deep teal/obsidian bg, coral accent) distinct from every other lineage
  project's workspace colors (puddle/ribbon purple, moveloose forest green,
  tuner royal blue, LIFE palenight, butterfly-world night-blue, flyerz
  monokai).
- Confirmed DIGEST.md needs no per-project setup — the `~/.claude/digest-logger.js`
  Stop hook and `~/.gitignore` (which excludes `DIGEST.md` /
  `.claude/.digest-state.json` globally) already apply to every project
  including this one; gloop will get its first `DIGEST.md` starting from
  this session's Stop hook.
- Checked the `gloop-dev.obfusco.us` DNS_PROBE_FINISHED_NXDOMAIN report —
  expected, not a bug: no S3/CloudFront/Route53 has been provisioned yet
  (same deferred item tracked below/in ROADMAP, still pending go-ahead).

## 2026-07-23 - Real UI: console-less floating dials + extended engine params

Replaced the placeholder 3-slider bar with the intended console-less UI —
individual controls float directly over the full-bleed Chladni canvas,
pinned to the screen edges, mobile-first. No panel/toolbar background
anywhere in the control layer.

- `src/components/RotaryKnob.jsx` + `.css` — ported from puddle's rotary
  knob (same drag model: vertical drag, ghost-slider feedback overlay,
  `--knob-color` per-control, responsive shrink under 767px), recolored for
  GLOOP's rainbow palette (`--rainbow-1..6` + per-control `--color-*` vars
  added to `index.css`).
- `src/components/ListenButton.jsx` + `.css` — the old start/stop button
  reimagined as a large circular toggle, the primary/centerpiece control.
  Idle state breathes gently; listening state gets a spinning rainbow
  conic-gradient ring baked into the button itself.
- `src/components/LoopIndicator.jsx` + `.css` — new visual-only readout, a
  dashed ring circling the listen button. Rotation period is derived live
  from the current `rate` param (scaled up so it stays legible at fast
  rates rather than a 1:1 blur — see `loopPeriodFromRate` in App.jsx). A
  sparkle pulses on the ring every time a grain actually fires, driven
  imperatively via `engine.onGrainFire()` + a `pulse()` ref method so it
  never forces a React re-render at grain-rate frequency (can be tens/sec).
- `src/App.jsx` / `App.css` — five floating clusters (`top-left`,
  `top-right`, `bottom-left`, `bottom-right`, `center`) positioned via
  `position: fixed` with `pointer-events: none` on the wrapper and `auto`
  per-cluster, so empty screen space always falls through to the canvas.

**engine.js param surface extended** (all still live-adjustable via the
existing `setParam`/`getParams`):

- `rate` — grain trigger interval, newly decoupled from `grainSizeMs`
  (previously one value drove both timing and duration). Judgment call: the
  dump floated a possible separate "frequency" axis — didn't add one, since
  a single well-explained `rate` dial already reads as pitch/texture when
  pushed low and as rhythm when pushed high; a second axis felt redundant.
- `density` — how much of the rotating grain-buffer pool a grain can be
  pulled from (0 = only the most recently captured audio, 1 = anywhere in
  the pool). New second granular dial alongside `grainSizeMs`, decided to
  keep `spread` as-is (pitch/pan drift) rather than overload it further.
- `dynamics` — per-grain random delay-time jitter depth ("dynamic delay").
- `repeat` — tail decay length: feedback-loop gain now ramps from the
  `feedback` value down to near-silence over a `repeat`-controlled duration
  (250ms-6s), so "how hot each echo is" and "how long the tail lasts" are
  finally separate controls instead of both being implied by `feedback`.
- `wow` / `flutter` / `wobble` — three real, distinct LFOs: wow is a slow
  (~0.15Hz) deep pitch drift on grain playback rate, flutter a fast
  (~7.5Hz) shallow pitch jitter, wobble a slow (~0.3Hz) delay-time sweep —
  deliberately different rates/depths/targets so they don't just alias to
  the same modulation.
- `volume` — master output gain, now exposed (was hardcoded to 0.9).

Persistent LFO nodes are created once in `start()` and fanned out to each
new grain's `playbackRate`/`delayTime` as it's created; each grain
disconnects itself from those LFOs (`onended`, and a matched timeout for
the per-grain delay/feedback subgraph) so the fan-out list doesn't grow
unbounded over a long-running session.

**Grain canvas interaction**: `GrainField` now takes pointer events
(down/move) and calls an `onInteract(nx, ny, intensity)` prop; `App.jsx`
routes that straight into `engine.perturb(intensity)`, which temporarily
nudges `spread`/`feedback`/`dynamics` and decays back over ~1s on a
real-time interval — independent of the dial positions the user actually
set, so the knobs never visibly jump. Added a small matching visual-only
push on nearby sand grains in the canvas itself (reads a mutable pointer
ref inside the existing rAF loop, no extra re-renders) since MYTHOS/ETHOS
call out "draw, push, shake" as part of GLOOP's identity.

Build/lint verified clean (`npm run build`, `npm run lint`, `npm run dev`
boots and serves 200).

AWS infra (gloop.obfusco.us / gloop-dev.obfusco.us) intentionally untouched
— still pending explicit go-ahead per ROADMAP.

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
