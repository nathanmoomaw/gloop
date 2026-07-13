# MYTHOS — GLOOP

## Origin

GLOOP started life in DUMP.md as **grains** (April 2026) — a granular synthesizer from a recorded or chosen sample, visualized as actual grains of sand you could draw, push, and shake. It sat as a concept for months, a branch of ribbon that hadn't been cut yet.

It came back on July 12, 2026 renamed and re-aimed: no recorded sample, no file picker. The mic, live, always. And the sand isn't just decorative anymore — it's a Chladni plate. The visualization *is* the physics, not an illustration of it.

## Lineage

```
ribbon (web synth)
└── grains (concept, April 2026)
    └── GLOOP (echo loopback + Chladni grain field, July 2026)
```

What carried forward from the concept: the sand-grain visual language, the "draw/push/shake" spirit of direct manipulation, ribbon's Vite+React scaffold pattern.

What changed: recorded sample → live mic input. Static sand → nodal-pattern-seeking grains. Granular synthesis alone → granular synthesis *as echo/loopback*, feeding back into itself.

## The Physics

Ernst Chladni (1787) showed that a vibrating plate covered in sand or powder will organize itself into the nodal lines of the plate's resonant modes — the sand collects where the plate is still, and is thrown from where it moves most. Different frequencies produce different geometric patterns, from simple crosses to intricate mandalas.

GLOOP's grain field runs the same math (`sin(nπx)sin(mπy) − sin(mπx)sin(nπy)`) against the dominant frequency of whatever the mic hears, live. The mode numbers `n, m` shift with pitch. The grains — colored across the spectrum, cycling hue over time — drift toward the nodal lines the way sand would on a real plate. It is a live, notional cymatics instrument built from the room's own sound instead of a signal generator and a speaker cone.

## Relationship to the rest of the lineage

Where **vibe** synthesizes ambient tone from nothing (color, chime, wind — all generated), GLOOP synthesizes nothing — it only rearranges what it's given. vibe is a frequency environment; GLOOP is a frequency mirror. Both descend from ribbon's original instinct: make the invisible structure of sound visible and playable.
