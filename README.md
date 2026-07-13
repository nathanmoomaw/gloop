# GLOOP

Granular synthesis echo loopback device. Part of the ribbon/puddle/audness lineage.

Listens through the mic, chops the input into grains, and replays them through a feedback delay network — a live granular echo of the room. Visualized as rainbow grains settling into Chladni-plate nodal patterns driven by the dominant frequency of the sound.

See [ETHOS.md](ETHOS.md) for intent, [MYTHOS.md](MYTHOS.md) for lineage/origin, [CLAUDE.md](CLAUDE.md) for technical/dev notes.

## Dev

```bash
npm install
npm run dev
```

Requires mic permission in the browser.
