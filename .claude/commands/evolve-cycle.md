---
description: One turn of gloop's self-evolving loop — pull what listeners did, refit the preference model, propose and ship better defaults to gloop-dev
---

The offline half of gloop's self-evolving engine. The in-app half (`src/audio/predict.js`) already
steers evolve and breed by the learned preference model live; this turn changes what everyone starts
from. The stack evaluates and predicts; Nathan's ears (and everyone's learn entries) close the loop.

1. **Pull.** `npm run learn:pull 30` (gloop-learn DynamoDB → `learning/remote/<day>.jsonl`). If it fails
   because the table doesn't exist yet, stop: `bash infra/learn/setup.sh` hasn't been run.
2. **Predict.** `npm run evolve:cycle`. It refits the model on everything under `learning/` and
   random-searches `SOUND_BOUNDS` for defaults the model rates higher, where it has evidence
   (confidence ≥ 0.3). Read `learning/cycle/<today>.md`.
   - No suggestion (too little data, or nothing beats the current defaults by 0.05): report the
     counts and stop. Don't force a change.
3. **Read the data, not just the score.** Before applying anything, skim the pulled entries:
   - many `muted`/`rescue` at certain level dials → `SOUND_BOUNDS` or the `sound` fix may be wrong;
   - `settle`/`linger` clustering where the model has no suggestion → `bandwidth` or `LABELS` in
     predict.js may need tuning;
   - `host` lets you separate gloop-dev from prod.
   Say what you see in plain words.
4. **Change.** Apply the suggested defaults to the `state` object in `src/audio/engine.js`
   (surgical: Edit, not Argon). Keep the "size knob at noon" rule unless the data clearly says
   otherwise. Anything bigger the data points to (a new signal, a new model term): if it's 3+ files
   or 300+ lines, build it with `/argon`; otherwise Edit.
5. **Evaluate.** `npx vitest run --reporter=dot`, `npm run lint`, then `jev --spec "evolve cycle:
   defaults from learn data" HEAD`, then `npm run review:haiku -- HEAD`. Verify each finding before
   fixing it.
6. **Ship to gloop-dev only.** Commit on `dev/v0` (never main), with the before → after predicted
   score and confidence in the message. Add a DEVLOG entry: data counts, what changed, and the tool
   results (Jev scores, Haiku findings, which were real). Push; the deploy goes to gloop-dev.
7. **Hand back.** Tell Nathan what changed and what to listen for. His presses and everyone's
   implicit signals on the new defaults are the next cycle's evidence.
