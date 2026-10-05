// Kubelka-Munk pigment mixing — mixes colors the way paint does
// (subtractive: blue + yellow = green, not gray) instead of the plain RGB/HSL
// lerp the grain field used before. Single-constant KM per RGB channel: each
// pigment's reflectance R becomes an absorption/scattering ratio
// K/S = (1-R)^2 / 2R, mixes are a concentration-weighted average of K/S, and
// the result goes back to reflectance via R = 1 + K/S - sqrt((K/S)^2 + 2K/S).
// Three channels is a coarse stand-in for full spectral KM (what Mixbox
// does), but it keeps the signature pigment behavior — chromatic greens and
// purples, strong pigments dominating weak ones — at LUT-build cost only.

// Pigment ring (sRGB tint swatches of common artist pigments — lighter than
// masstone, since three-channel KM flattens near-black swatches to gray),
// walked in order
// and back around to the start. Greens aren't listed: phthalo blue mixing
// into hansa yellow on the wrap-around produces them, which is the point.
const PIGMENT_RING = [
  [252, 211, 0], // hansa yellow
  [235, 40, 30], // cadmium red
  [205, 20, 120], // quinacridone magenta
  [50, 40, 205], // ultramarine blue
  [0, 95, 200], // phthalo blue
]

const LUT_SIZE = 512
// Floor on reflectance: keeps K/S finite for channels a pigment absorbs
// near-completely (e.g. hansa yellow's blue), and matches real paint, which
// rarely reflects under a few percent. Much lower and a single near-black
// channel's K/S explodes, so any trace of that pigment swamps the mix.
const R_MIN = 0.01

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function linearToSrgb(c) {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055
}

function toKS(r) {
  const R = Math.max(R_MIN, r)
  return ((1 - R) * (1 - R)) / (2 * R)
}

function fromKS(ks) {
  return 1 + ks - Math.sqrt(ks * ks + 2 * ks)
}

const ringKS = PIGMENT_RING.map((rgb) => rgb.map((c) => toKS(srgbToLinear(c / 255))))

// Normalized sRGB of a mix t (0-1) of ring pigment a into the next one,
// brightest channel scaled to 1 — KM decides the hue/chroma path, the
// caller decides how bright. (Raw KM mixes are dark, like real paint;
// normalizing keeps them usable as glowing grains/plate highlights.)
function mixRing(a, t) {
  const b = (a + 1) % PIGMENT_RING.length
  const rgb = [0, 1, 2].map((ch) => linearToSrgb(fromKS(ringKS[a][ch] * (1 - t) + ringKS[b][ch] * t)))
  const max = Math.max(...rgb, 1e-6)
  return rgb.map((c) => c / max)
}

// KM mixing is lopsided by nature: a strong pigment like cadmium red swamps
// hansa yellow within the first few percent of their segment, so walking
// concentration evenly would flash past the yellows/oranges and dwell on
// near-identical reds. Sample the ring densely, then resample it by
// cumulative color distance so equal phase steps are equal color steps.
const DENSE = 8192
const dense = []
for (let i = 0; i < DENSE; i++) {
  const pos = (i / DENSE) * PIGMENT_RING.length
  const a = Math.floor(pos)
  dense.push(mixRing(a, pos - a))
}
const arc = new Float64Array(DENSE + 1)
for (let i = 1; i <= DENSE; i++) {
  const p = dense[i - 1]
  const q = dense[i % DENSE]
  arc[i] = arc[i - 1] + Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2])
}

const LUT = new Float32Array(LUT_SIZE * 3)
for (let i = 0, j = 0; i < LUT_SIZE; i++) {
  const target = (i / LUT_SIZE) * arc[DENSE]
  while (arc[j + 1] < target) j++
  const c = dense[j]
  LUT[i * 3] = c[0]
  LUT[i * 3 + 1] = c[1]
  LUT[i * 3 + 2] = c[2]
}

// phase in [0,1) around the pigment ring; writes normalized sRGB into out.
export function pigmentAt(phase, out) {
  const i = (((Math.floor(phase * LUT_SIZE) % LUT_SIZE) + LUT_SIZE) % LUT_SIZE) * 3
  out[0] = LUT[i]
  out[1] = LUT[i + 1]
  out[2] = LUT[i + 2]
  return out
}
