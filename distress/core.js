"use strict";
// Grime – core engine.
// Procedural textures + mask computation. Plain JavaScript without Photoshop dependencies,
// so the same code runs in the plugin (UXP) and in the test renderer (Node).

// ---------------------------------------------------------------- Noise

function hashi(x, y, s) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(s | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
function rnd(x, y, s) { return hashi(x, y, s) / 4294967296; }
function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function smooth(a, b, v) {
  if (b <= a) return v < a ? 0 : 1;
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
}

const GX = new Float32Array([1, -1, 0, 0, 0.7071, -0.7071, 0.7071, -0.7071]);
const GY = new Float32Array([0, 0, 1, -1, 0.7071, 0.7071, -0.7071, -0.7071]);

// gradient noise, result roughly in [-1, 1]
function perlin(x, y, s) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  let h = hashi(ix, iy, s) & 7;
  const a = GX[h] * fx + GY[h] * fy;
  h = hashi(ix + 1, iy, s) & 7;
  const b = GX[h] * (fx - 1) + GY[h] * fy;
  h = hashi(ix, iy + 1, s) & 7;
  const c = GX[h] * fx + GY[h] * (fy - 1);
  h = hashi(ix + 1, iy + 1, s) & 7;
  const d = GX[h] * (fx - 1) + GY[h] * (fy - 1);
  const ab = a + (b - a) * u, cd = c + (d - c) * u;
  return (ab + (cd - ab) * v) * 1.4;
}

function fbm(x, y, oct, s) {
  let sum = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += amp * perlin(x * f + i * 17.3, y * f - i * 9.1, s + i * 1013);
    norm += amp; amp *= 0.5; f *= 2.03;
  }
  return sum / norm;
}

function ridged(x, y, oct, s) {
  let sum = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    const n = 1 - Math.abs(perlin(x * f, y * f, s + i * 1013));
    sum += amp * n * n; norm += amp; amp *= 0.5; f *= 2.03;
  }
  return sum / norm;
}

// cell noise (Worley). Results in F1/F2/CID to avoid allocations per pixel.
let F1 = 0, F2 = 0, CID = 0;
function cellular(x, y, s) {
  const ix = Math.floor(x), iy = Math.floor(y);
  F1 = 9; F2 = 9; CID = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = ix + i, cy = iy + j;
      const h = hashi(cx, cy, s);
      const dx = cx + (h & 0xffff) / 65536 - x;
      const dy = cy + (h >>> 16) / 65536 - y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < F1) { F2 = F1; F1 = d; CID = h; } else if (d < F2) F2 = d;
    }
  }
}
function cidRand(salt) { return hashi(CID, salt, 7) / 4294967296; }

function angles(s, n) {
  const out = [];
  for (let k = 0; k < n; k++) {
    const a = rnd(k, 3, s) * Math.PI;
    out.push([Math.cos(a), Math.sin(a)]);
  }
  return out;
}

// ---------------------------------------------------------------- Textures
// Every texture returns a raw value: HIGH value = is "distressed" away first.
// The values are later equalised by histogram so the sliders react the same
// for every texture (e.g. 40 % distress ≈ 40 % worn-away area).

const TEXTURES = [
  { id: "grunge", name: "Grunge", make: (s) => (x, y) => fbm(x, y, 6, s) + 0.35 * ridged(x * 2.3, y * 2.3, 3, s + 7) },
  { id: "worn", name: "Worn Print", make: (s) => (x, y) => 0.55 * fbm(x * 1.5, y * 1.5, 5, s) + 0.45 * perlin(x * 16, y * 16, s + 5) },
  { id: "stamp", name: "Rubber Stamp", make: (s) => (x, y) => 0.7 * fbm(x * 0.6, y * 0.6, 3, s) + 0.35 * fbm(x * 6, y * 6, 3, s + 2) },
  { id: "rust", name: "Rust", make: (s) => (x, y) => {
    const wx = fbm(x * 0.6, y * 0.6, 3, s + 1), wy = fbm(x * 0.6 + 5.2, y * 0.6 + 1.3, 3, s + 2);
    return fbm(x + wx * 1.8, y + wy * 1.8, 6, s + 3) + 0.25 * perlin(x * 7, y * 7, s + 4);
  } },
  { id: "speckle", name: "Speckle", make: (s) => (x, y) => {
    cellular(x * 3, y * 3, s);
    return (0.12 + 0.3 * cidRand(1) - F1) + 0.06 * perlin(x * 12, y * 12, s + 2);
  } },
  { id: "spray", name: "Spray", make: (s) => (x, y) => {
    cellular(x * 9, y * 9, s);
    return 0.5 * (0.2 * cidRand(2) - F1) + 0.5 * fbm(x * 0.5, y * 0.5, 3, s + 5);
  } },
  { id: "splatter", name: "Splatter", make: (s) => (x, y) => {
    const w = fbm(x * 1.5, y * 1.5, 3, s + 1) * 0.12;
    cellular(x * 1.1 + w, y * 1.1 + w, s);
    let v = Math.pow(cidRand(1), 3) * 0.5 - F1;
    cellular(x * 4.3 + w, y * 4.3 - w, s + 7);
    v = Math.max(v, (Math.pow(cidRand(2), 4) * 0.35 - F1) / 4.3 * 1.1);
    return v + 0.02 * perlin(x * 10, y * 10, s + 3);
  } },
  { id: "scratches", name: "Scratches", make: (s) => {
    const A = angles(s, 4);
    return (x, y) => {
      let best = 0;
      for (let k = 0; k < 4; k++) {
        const xr = x * A[k][0] - y * A[k][1], yr = x * A[k][1] + y * A[k][0];
        const n = fbm(xr * 0.12, yr * 4, 3, s + 20 + k);
        const line = 1 - clamp01(Math.abs(n) / 0.035);
        if (line <= best) continue;
        const gate = clamp01(perlin(xr * 0.25 + k * 3, yr * 0.25, s + 40 + k) * 2 + 0.3);
        best = Math.max(best, line * gate);
      }
      return best + 0.12 * fbm(x * 2, y * 2, 3, s + 60);
    };
  } },
  { id: "cracks", name: "Cracks", make: (s) => (x, y) => {
    const w = fbm(x * 0.8, y * 0.8, 3, s + 1) * 0.35;
    cellular(x * 1.3 + w, y * 1.3 - w, s);
    const e1 = F2 - F1;
    cellular(x * 3.7 - w, y * 3.7 + w, s + 9);
    const e2 = F2 - F1;
    return -Math.min(e1, e2 * 1.6 + 0.05) + 0.05 * fbm(x * 6, y * 6, 2, s + 3);
  } },
  { id: "peeling", name: "Peeling", make: (s) => (x, y) => {
    const w = fbm(x * 1.2, y * 1.2, 4, s + 1) * 0.3;
    cellular(x * 0.9 + w, y * 0.9 - w, s);
    return cidRand(4) * 0.9 + 0.15 * fbm(x * 4, y * 4, 3, s + 2) + 0.5 * (1 - smooth(0, 0.12, F2 - F1));
  } },
  { id: "halftone", name: "Halftone", make: (s) => (x, y) => {
    const gx = (x + y) * 0.7071 * 6, gy = (y - x) * 0.7071 * 6;
    const cx = gx - Math.floor(gx) - 0.5, cy = gy - Math.floor(gy) - 0.5;
    return Math.sqrt(cx * cx + cy * cy) - (0.5 + 0.5 * fbm(x * 0.4, y * 0.4, 3, s)) * 0.55;
  } },
  { id: "stipple", name: "Stipple", make: (s) => (x, y) => {
    cellular(x * 10, y * 10, s);
    return 0.45 * fbm(x * 0.6, y * 0.6, 4, s + 1) + 0.6 * F1;
  } },
  { id: "concrete", name: "Concrete", make: (s) => (x, y) => {
    cellular(x * 5, y * 5, s);
    const pit = clamp01((0.06 + 0.14 * cidRand(3) - F1) / 0.08);
    return 0.55 * fbm(x * 1.2, y * 1.2, 6, s + 1) + 0.8 * pit;
  } },
  { id: "sandpaper", name: "Sandpaper", make: (s) => (x, y) =>
    0.55 * perlin(x * 22, y * 22, s) + 0.45 * (rnd(Math.floor(x * 48), Math.floor(y * 48), s + 1) * 2 - 1) },
  { id: "drybrush", name: "Dry Brush", make: (s) => (x, y) => fbm(x * 0.25, y * 7, 5, s) + 0.35 * fbm(x * 0.08, y * 0.9, 3, s + 3) },
  { id: "roller", name: "Paint roller", make: (s) => (x, y) => fbm(x * 0.04, y * 2.5, 4, s) + 0.3 * fbm(x * 1.5, y * 1.5, 3, s + 3) },
  { id: "chalk", name: "Chalk", make: (s) => (x, y) =>
    0.45 * fbm(x * 0.35, y * 3, 4, s) + 0.35 * perlin(x * 18, y * 18, s + 1) + 0.25 * (rnd(Math.floor(x * 40), Math.floor(y * 40), s + 2) * 2 - 1) },
  { id: "fibers", name: "Paper fibre", make: (s) => {
    const A = angles(s + 3, 4);
    return (x, y) => {
      let v = 0;
      for (let k = 0; k < 4; k++) {
        const xr = x * A[k][0] - y * A[k][1], yr = x * A[k][1] + y * A[k][0];
        v = Math.max(v, 1 - clamp01(Math.abs(perlin(xr * 0.5, yr * 10, s + k * 31)) / 0.08));
      }
      return v * 0.8 + 0.3 * fbm(x * 1.2, y * 1.2, 3, s + 90);
    };
  } },
  { id: "crumpled", name: "Crumpled", make: (s) => (x, y) => {
    const w = fbm(x * 0.5, y * 0.5, 2, s + 1) * 0.5;
    return ridged(x * 0.9 + w, y * 0.9 - w, 5, s);
  } },
  { id: "stains", name: "Water stains", make: (s) => (x, y) => {
    const n = fbm(x * 0.45, y * 0.45, 4, s), f = n * 7;
    const ring = 1 - Math.abs(f - Math.floor(f) - 0.5) * 2;
    return 0.55 * n + 0.35 * Math.pow(ring, 6) + 0.1 * fbm(x * 3, y * 3, 3, s + 3);
  } },
  { id: "inkbleed", name: "Ink Bleed", make: (s) => (x, y) => {
    const wx = fbm(x * 1.2, y * 1.2, 4, s + 1), wy = fbm(x * 1.2 + 3.1, y * 1.2 + 7.7, 4, s + 2);
    return fbm(x * 2 + wx * 2.5, y * 2 + wy * 2.5, 5, s + 3);
  } },
  { id: "dust", name: "Dust & hair", make: (s) => (x, y) => {
    cellular(x * 3.5, y * 3.5, s);
    let v = (Math.pow(cidRand(5), 6) * 0.35 - F1) * 2;
    const hair = (1 - clamp01(Math.abs(fbm(x * 0.35, y * 0.35, 3, s + 4)) / 0.012)) * clamp01(perlin(x * 0.2, y * 0.2, s + 8) * 3 - 0.4);
    v = Math.max(v, hair * 0.4 - 0.1);
    return v + 0.03 * perlin(x * 20, y * 20, s + 2);
  } },
  { id: "wood", name: "Wood grain", make: (s) => (x, y) => {
    const n = fbm(x * 0.15, y * 1.2, 4, s);
    return Math.sin((y * 2.5 + n * 3) * Math.PI) * 0.45 + 0.4 * fbm(x * 0.25, y * 7, 4, s + 2);
  } },
  { id: "canvas", name: "Canvas", make: (s) => (x, y) =>
    0.35 * Math.sin(x * 10 * Math.PI) * Math.sin(y * 10 * Math.PI) + 0.6 * fbm(x * 0.8, y * 0.8, 5, s) + 0.15 * perlin(x * 25, y * 25, s + 1) },
  // --- extension (v1.0.2)
  { id: "sponge", name: "Sponge", make: (s) => (x, y) => {
    cellular(x * 2.5, y * 2.5, s);
    const a = (0.1 + 0.25 * cidRand(1)) - F1;
    cellular(x * 7, y * 7, s + 3);
    const b = ((0.1 + 0.25 * cidRand(2)) - F1) / 2.8;
    return Math.max(a, b) + 0.04 * fbm(x * 4, y * 4, 2, s + 5);
  } },
  { id: "rain", name: "Rain streaks", make: (s) => (x, y) =>
    fbm(x * 6, y * 0.12, 4, s) + 0.25 * fbm(x * 1.5, y * 1.5, 3, s + 2) },
  { id: "drips", name: "Drips", make: (s) => (x, y) => {
    // columns with random run length: the lower, the less paint
    const col = Math.floor(x * 3 + perlin(y * 0.3, x, s + 4) * 0.3);
    const len = 1.5 + 4 * rnd(col, 1, s);
    const fx = x * 3 - Math.floor(x * 3) - 0.5;
    // own phase per column, otherwise all drips start at the same height (visible horizontal bar)
    const yc = y + rnd(col, 2, s) * 8;
    const yy = yc - Math.floor(yc / 8) * 8;
    return smooth(len - 1, len + 1, yy) * 0.6 + Math.abs(fx) * 0.5 + 0.2 * fbm(x * 2, y * 2, 3, s + 1);
  } },
  { id: "brushed", name: "Brushed", make: (s) => (x, y) =>
    0.6 * fbm(x * 0.05, y * 14, 4, s) + 0.4 * fbm(x * 0.6, y * 0.6, 4, s + 2) },
  { id: "filmgrain", name: "Film grain", make: (s) => (x, y) =>
    0.4 * perlin(x * 30, y * 30, s) + 0.35 * (rnd(Math.floor(x * 70), Math.floor(y * 70), s + 1) * 2 - 1) + 0.25 * fbm(x * 0.7, y * 0.7, 3, s + 2) },
  { id: "bubbles", name: "Bubbles", make: (s) => (x, y) => {
    cellular(x * 2.2, y * 2.2, s);
    const r = 0.15 + 0.3 * cidRand(1);
    return Math.max(0.5 - Math.abs(F1 - r) * 8, (r * 0.6 - F1) * 3) + 0.1 * fbm(x * 3, y * 3, 2, s + 1);
  } },
  { id: "leather", name: "Leather", make: (s) => (x, y) => {
    const w = fbm(x * 1.5, y * 1.5, 3, s + 1) * 0.25;
    cellular(x * 5 + w, y * 5 - w, s);
    return -(F2 - F1) + 0.3 * fbm(x * 1.2, y * 1.2, 4, s + 2);
  } },
  { id: "bark", name: "Bark", make: (s) => (x, y) => {
    const w = fbm(x * 0.4, y * 0.4, 3, s + 1) * 0.8;
    return ridged(x * 2.5 + w, y * 0.25, 5, s) + 0.2 * fbm(x * 4, y * 4, 3, s + 2);
  } },
  { id: "marble", name: "Marble veins", make: (s) => (x, y) => {
    const n = fbm(x * 0.6, y * 0.6, 5, s);
    return -Math.abs(Math.sin((x * 0.7 + y * 0.3 + n * 3.5) * Math.PI)) + 0.15 * fbm(x * 3, y * 3, 3, s + 2);
  } },
  { id: "topo", name: "Contour lines", make: (s) => (x, y) => {
    const n = fbm(x * 0.35, y * 0.35, 4, s) * 9;
    return 1 - Math.abs(n - Math.floor(n) - 0.5) * 2 + 0.1 * perlin(x * 8, y * 8, s + 1);
  } },
  { id: "burnt", name: "Burnt", make: (s) => (x, y) => {
    const wx = fbm(x * 0.8, y * 0.8, 3, s + 1);
    const base = fbm(x * 0.9 + wx, y * 0.9 - wx, 5, s + 2);
    cellular(x * 6, y * 6, s + 3);
    return base + 0.6 * clamp01((0.08 * cidRand(1) - F1) * 10) + 0.08 * perlin(x * 14, y * 14, s + 4);
  } },
  { id: "glitch", name: "Glitch", make: (s) => (x, y) => {
    const band = Math.floor(y * 4 + perlin(y * 0.1, 0.5, s) * 2);
    const shift = (rnd(band, 2, s) - 0.5) * 3;
    const on = rnd(band, 3, s) > 0.55 ? 1 : 0;
    return on * (0.4 + 0.6 * smooth(-0.2, 0.6, fbm((x + shift) * 0.4, band, 2, s + 1))) + 0.15 * perlin(x * 20, y * 4, s + 2);
  } },
];
const TEX_BY_ID = {};
for (const t of TEXTURES) TEX_BY_ID[t.id] = t;

const DEFAULTS = {
  texture: "grunge",
  scale: 100,
  rotation: 0,
  invert: false,
  shapeDistress: 35,
  shapeMeld: 15,
  edgeRoughness: 3,
  innerDistress: 12,
  innerEdgeSize: 10,
  fadeAmount: 0,
  fadeStyle: "top",
  fadeTarget: "distress",
  seed: 1337,
  varySeed: true,
  colorEnabled: false,
  color: "#f1e6d2",
  colorOpacity: 100,
  texture2: "",
  texture2Scale: 100,
  texture2Mix: 50,
  texture2Mode: "blend",
  texture2Invert: false,
  bleedEnabled: false,      // ink bleed: ink spreading past the edge into the paper
  bleedSpread: 4,           // how far it reaches, px
  bleedFibres: 40,          // fine tendrils along paper fibres, %
  bleedOpacity: 90,         // %
  bleedColorMode: "layer",  // layer = the layer's own colour | custom = bleedColor
  bleedColor: "#1b1b1b",
};

const MIX_MODES = [
  { id: "blend", name: "Blend" },
  { id: "add", name: "Add (both)" },
  { id: "mask", name: "Mask (overlap only)" },
];

const FADE_STYLES = [
  { id: "top", name: "From top" },
  { id: "bottom", name: "From bottom" },
  { id: "left", name: "From left" },
  { id: "right", name: "From right" },
  { id: "diagonal", name: "Diagonal" },
  { id: "center", name: "Radial – centre" },
  { id: "edges", name: "Radial – edge" },
  { id: "frame", name: "Frame" },
  { id: "random", name: "Random clouds" },
];

// ---------------------------------------------------------------- Sampler + distribution

// Returns f(xDoc, yDoc) -> raw value. Coordinates are document pixels, so the preview
// (downsampled) and the final result (full resolution) see exactly the same texture.
function buildSampler(params, customTex) {
  const seed = params.seed | 0;
  const unit = 64 * Math.max(1, params.scale) / 100;
  const ang = (params.rotation || 0) * Math.PI / 180;
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const ox = rnd(seed, 11, 3) * 4096, oy = rnd(seed, 13, 5) * 4096;
  let gen;
  if (customTex && !TEX_BY_ID[params.texture]) {
    // image/layer texture, mirrored tiling (no visible seams)
    const { w, h, data } = customTex;
    const k = customTex.k || 1;
    const w2 = w * 2, h2 = h * 2;
    gen = (x, y) => {
      let px = (x * 64) / k, py = (y * 64) / k;
      px = ((px % w2) + w2) % w2; py = ((py % h2) + h2) % h2;
      if (px >= w) px = w2 - px - 1e-3;
      if (py >= h) py = h2 - py - 1e-3;
      if (px < 0) px = 0;
      if (py < 0) py = 0;
      const x0 = px | 0, y0 = py | 0, x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
      const fx = px - x0, fy = py - y0;
      const a = data[y0 * w + x0], b = data[y0 * w + x1], c = data[y1 * w + x0], d = data[y1 * w + x1];
      const ab = a + (b - a) * fx, cd = c + (d - c) * fx;
      return ab + (cd - ab) * fy;
    };
  } else {
    gen = (TEX_BY_ID[params.texture] || TEXTURES[0]).make(seed);
  }
  const sign = params.invert ? -1 : 1;
  return (xd, yd) => {
    const x = xd / unit, y = yd / unit;
    return sign * gen(x * ca - y * sa + ox, x * sa + y * ca + oy);
  };
}

const BINS = 2048;
// histogram equalisation over a sample grid of the layer bounds.
function buildCDF(sampler, bounds, n) {
  n = n || 128;
  const bw = Math.max(1, bounds.right - bounds.left), bh = Math.max(1, bounds.bottom - bounds.top);
  const vals = new Float32Array(n * n);
  let min = Infinity, max = -Infinity;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const v = sampler(bounds.left + (i + rnd(i, j, 77)) / n * bw, bounds.top + (j + rnd(i, j, 78)) / n * bh);
      vals[j * n + i] = v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  const inv = BINS / ((max - min) || 1);
  const hist = new Float64Array(BINS);
  for (let i = 0; i < vals.length; i++) hist[Math.min(BINS - 1, ((vals[i] - min) * inv) | 0)]++;
  const cdf = new Float32Array(BINS + 1);
  for (let i = 0; i < BINS; i++) cdf[i + 1] = cdf[i] + hist[i] / vals.length;
  return { min, inv, cdf };
}

function lookupCDF(c, v) {
  const t = (v - c.min) * c.inv;
  if (t <= 0) return 0;
  if (t >= BINS) return 1;
  const i = t | 0;
  return c.cdf[i] + (c.cdf[i + 1] - c.cdf[i]) * (t - i);
}

// texture 1 (+ optional texture 2) -> { sampler, cdf }. Both textures are equalised
// separately, combined, and the result is equalised again.
function buildPipeline(p, bounds, tex1, tex2) {
  const s1 = buildSampler(p, tex1);
  const useSecond = p.texture2 && p.texture2Mix > 0 && (TEX_BY_ID[p.texture2] || tex2);
  if (!useSecond) return { sampler: s1, cdf: buildCDF(s1, bounds) };
  const c1 = buildCDF(s1, bounds);
  const p2 = Object.assign({}, p, {
    texture: p.texture2, scale: p.texture2Scale, seed: (p.seed | 0) + 101, invert: !!p.texture2Invert,
  });
  const s2 = buildSampler(p2, tex2);
  const c2 = buildCDF(s2, bounds);
  const m = Math.min(1, p.texture2Mix / 100);
  const mode = p.texture2Mode;
  const sampler = (xd, yd) => {
    const a = lookupCDF(c1, s1(xd, yd)), b = lookupCDF(c2, s2(xd, yd));
    if (mode === "add") return a + (Math.max(a, b) - a) * m;
    if (mode === "mask") return a + (Math.min(a, b) - a) * m;
    return a + (b - a) * m;
  };
  return { sampler, cdf: buildCDF(sampler, bounds) };
}

// chamfer distance of every opaque pixel to the nearest edge of the shape (in sample pixels).
function distanceTransform(alpha, w, h) {
  const d = new Float32Array(w * h);
  const D = Math.SQRT2;
  for (let i = 0; i < d.length; i++) d[i] = alpha[i] >= 128 ? 1e6 : 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (d[i] === 0) continue;
      let m = d[i];
      m = Math.min(m, (x > 0 ? d[i - 1] : 0) + 1);
      m = Math.min(m, (y > 0 ? d[i - w] : 0) + 1);
      m = Math.min(m, (x > 0 && y > 0 ? d[i - w - 1] : 0) + D);
      m = Math.min(m, (x < w - 1 && y > 0 ? d[i - w + 1] : 0) + D);
      d[i] = m;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (d[i] === 0) continue;
      let m = d[i];
      m = Math.min(m, (x < w - 1 ? d[i + 1] : 0) + 1);
      m = Math.min(m, (y < h - 1 ? d[i + w] : 0) + 1);
      m = Math.min(m, (x < w - 1 && y < h - 1 ? d[i + w + 1] : 0) + D);
      m = Math.min(m, (x > 0 && y < h - 1 ? d[i + w - 1] : 0) + D);
      d[i] = m;
    }
  }
  return d;
}

// g = 1 where the effect is strongest.
function makeFade(p, b, seed) {
  const bw = Math.max(1, b.right - b.left), bh = Math.max(1, b.bottom - b.top);
  const fu = Math.max(bw, bh) / 3;
  const style = p.fadeStyle;
  return (xd, yd) => {
    const nx = (xd - b.left) / bw, ny = (yd - b.top) / bh;
    let g;
    switch (style) {
      case "top": g = 1 - ny; break;
      case "bottom": g = ny; break;
      case "left": g = 1 - nx; break;
      case "right": g = nx; break;
      case "diagonal": g = 1 - (nx + ny) / 2; break;
      case "center": { const dx = nx - 0.5, dy = ny - 0.5; g = 1 - Math.min(1, Math.sqrt(dx * dx + dy * dy) / 0.7071); break; }
      case "edges": { const dx = nx - 0.5, dy = ny - 0.5; g = Math.min(1, Math.sqrt(dx * dx + dy * dy) / 0.7071); break; }
      case "frame": g = 1 - Math.min(nx, 1 - nx, ny, 1 - ny) * 2; break;
      case "random": g = 0.5 + fbm(xd / fu, yd / fu, 4, seed + 321) * 1.6; break;
      default: g = 1;
    }
    return smooth(0, 1, clamp01(g));
  };
}

// ---------------------------------------------------------------- Mask computation
// alpha: Uint8Array (w*h) of the layer; originX/Y + pxScale map sample pixels to document pixels.
// Returns mask (255 = visible) and optionally color (opacity of the "Shape Color" layer).
function computeMask(o) {
  const { alpha, width: w, height: h, originX, originY, bounds } = o;
  const pxScale = o.pxScale || 1;
  const p = Object.assign({}, DEFAULTS, o.params);
  const seed = p.seed | 0;
  let sampler = o.sampler, cdf = o.cdf;
  if (!sampler || !cdf) ({ sampler, cdf } = buildPipeline(p, bounds, o.customTex, o.customTex2));
  const dist = distanceTransform(alpha, w, h);
  const fade = makeFade(p, bounds, seed);

  const sd = p.shapeDistress / 100, idr = p.innerDistress / 100;
  const edge = p.innerEdgeSize, rough = p.edgeRoughness;
  const meld = p.shapeMeld / 100;
  const soft = 0.004 + meld * 0.22;
  const softPx = 0.6 + meld * 3;
  const fadeAmt = p.fadeAmount / 100;
  const roughUnit = 4 + rough * 1.5;
  const colA = p.colorOpacity / 100;

  const mask = new Uint8Array(w * h);
  const color = o.wantColor ? new Uint8Array(w * h) : null;

  for (let y = 0; y < h; y++) {
    const yd = originY + (y + 0.5) * pxScale;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const a = alpha[i];
      if (a === 0) { mask[i] = 255; continue; }
      const xd = originX + (x + 0.5) * pxScale;
      const dd = (dist[i] || a / 255) * pxScale;

      let fadeD = 1, opac = 1;
      if (fadeAmt > 0) {
        const g = fade(xd, yd);
        if (p.fadeTarget !== "opacity") fadeD = 1 - fadeAmt * (1 - g);
        if (p.fadeTarget !== "distress") opac = 1 - fadeAmt * g;
      }

      const ef = edge > 0 ? smooth(0, edge, dd) : 1;
      const amount = (sd + (idr - sd) * ef) * fadeD;
      let keep = 1;
      if (amount > 0) {
        const t = lookupCDF(cdf, sampler(xd, yd));
        const thr = (1 + soft) - amount * (1 + 2 * soft);
        keep = 1 - smooth(thr - soft, thr + soft, t);
      }
      if (rough > 0 && keep > 0) {
        // edge roughness = mix of fine noise and the chosen texture
        const tn = lookupCDF(cdf, sampler(xd, yd));
        const n = 0.5 * (0.5 + 0.5 * fbm(xd / roughUnit, yd / roughUnit, 3, seed + 555)) + 0.5 * tn;
        const r = rough * fadeD * (0.15 + 1.7 * clamp01((n - 0.3) * 2.5));
        keep *= smooth(r - softPx, r + softPx, dd);
      }
      mask[i] = (keep * opac * 255 + 0.5) | 0;
      if (color) color[i] = (a * (1 - keep) * colA * opac + 0.5) | 0;
    }
  }
  return { mask, color };
}

// chamfer distance of every empty pixel (255) to the nearest ink pixel (0); outside the image counts as empty
function outsideDistance(empty, w, h) {
  const d = new Float32Array(w * h), D = Math.SQRT2, INF = 1e6;
  for (let i = 0; i < d.length; i++) d[i] = empty[i] ? INF : 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (!d[i]) continue;
    let m = d[i];
    if (x > 0) m = Math.min(m, d[i - 1] + 1);
    if (y > 0) { m = Math.min(m, d[i - w] + 1); if (x > 0) m = Math.min(m, d[i - w - 1] + D); if (x < w - 1) m = Math.min(m, d[i - w + 1] + D); }
    d[i] = m;
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x;
    if (!d[i]) continue;
    let m = d[i];
    if (x < w - 1) m = Math.min(m, d[i + 1] + 1);
    if (y < h - 1) { m = Math.min(m, d[i + w] + 1); if (x < w - 1) m = Math.min(m, d[i + w + 1] + D); if (x > 0) m = Math.min(m, d[i + w - 1] + D); }
    d[i] = m;
  }
  return d;
}

// ---------------------------------------------------------------- Ink bleed
// Ink that soaks past the edge into the paper: it creeps out unevenly in soft blotches and runs further along
// paper fibres in fine tendrils; small gaps fill up. It grows from the ink that is left after the distress
// (alpha × mask), so worn-away areas don't bleed. Coordinates are document pixels (preview = final).
// Returns { alpha (Uint8Array), w, h, pad } – pad = samples it reaches beyond the input on every side.
function bleedPad(p, pxScale) { return Math.ceil(p.bleedSpread * 2.4 / (pxScale || 1)) + 2; }
function computeBleed(o) {
  const { alpha, mask, width: w, height: h, originX, originY } = o, pxScale = o.pxScale || 1;
  const p = Object.assign({}, DEFAULTS, o.params), seed = (p.seed | 0) + 909;
  const pad = bleedPad(p, pxScale), W = w + 2 * pad, H = h + 2 * pad;
  // where there is no ink (255), padded; the distance of every such pixel to the nearest ink
  const empty = new Uint8Array(W * H).fill(255);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, ink = mask ? alpha[i] * mask[i] / 255 : alpha[i];
    if (ink >= 128) empty[(y + pad) * W + x + pad] = 0;
  }
  const dist = outsideDistance(empty, W, H);
  const spread = Math.max(0.1, p.bleedSpread / pxScale) * pxScale, fib = p.bleedFibres / 100;
  // paper fibres: thin lines in three random directions, long along, narrow across – and only here and there
  const dirs = angles(seed, 3), along = spread * 8, across = Math.max(1.4, spread * 0.45), blot = spread * 2.2;
  const edgeSoft = Math.max(0.6 * pxScale, spread * 0.12);
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const yd = originY + (y - pad + 0.5) * pxScale;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!empty[i]) { out[i] = 255; continue; }
      const d = dist[i] * pxScale;
      if (d > spread * 2.4) continue;
      const xd = originX + (x - pad + 0.5) * pxScale;
      // blotchy reach + fibres that carry the ink further
      let reach = spread * (0.2 + 1.1 * clamp01(0.5 + 1.2 * fbm(xd / blot, yd / blot, 3, seed)));
      if (fib > 0) {
        let f = 0;
        // fibres curve a little: the position is bent by a slow noise
        const bx = xd + spread * 2.5 * perlin(xd / (spread * 7), yd / (spread * 7), seed + 5), by = yd + spread * 2.5 * perlin(xd / (spread * 7) + 9.7, yd / (spread * 7), seed + 6);
        for (let k = 0; k < 3; k++) {
          const [ca, sa] = dirs[k], u = (bx * ca + by * sa) / along, v = (-bx * sa + by * ca) / across;
          let r = 1 - Math.abs(perlin(u, v, seed + 31 * k));
          r *= r; r *= r; r *= r;   // ^8: thin lines
          f = Math.max(f, r * smooth(0.1, 0.6, perlin(u * 0.7 + 3.1, v * 0.05, seed + 77 + k)));
        }
        reach += spread * 1.8 * fib * f;
      }
      if (d >= reach + edgeSoft) continue;
      // thinner the further it soaked, crisp-soft outer edge
      const a = (1 - smooth(reach - edgeSoft, reach + edgeSoft, d)) * (1 - 0.45 * clamp01(d / Math.max(0.5, reach)));
      out[i] = (a * 255 + 0.5) | 0;
    }
  }
  return { alpha: out, w: W, h: H, pad };
}

// small preview of a texture (greyscale, 255 = paint stays).
function renderThumb(texId, size, customTex) {
  const p = Object.assign({}, DEFAULTS, { texture: texId, seed: 7 });
  const sampler = buildSampler(p, customTex);
  const region = customTex ? Math.max(customTex.w, customTex.h) * (customTex.k || 1) : 220, px = region / size;
  const b = { left: 0, top: 0, right: region, bottom: region };
  const cdf = buildCDF(sampler, b, 64);
  const out = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const t = lookupCDF(cdf, sampler((x + 0.5) * px, (y + 0.5) * px));
      out[y * size + x] = (255 * (1 - smooth(0.52, 0.6, t))) | 0;
    }
  }
  return out;
}

module.exports = {
  TEXTURES: TEXTURES.map((t) => ({ id: t.id, name: t.name })),
  FADE_STYLES, MIX_MODES, DEFAULTS,
  buildSampler, buildCDF, buildPipeline, computeMask, computeBleed, bleedPad, renderThumb,
};
