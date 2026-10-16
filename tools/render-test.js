// Rendert alle Texturen auf einen Test-Schriftzug -> PNG, um die Engine ohne Photoshop zu prüfen.
// Aufruf: node tools/render-test.js <ausgabe.png> [json-params]
const fs = require("fs");
const path = require("path");
const Core = require(path.join(__dirname, "..", "distress", "core.js"));
const { encodePNG } = require("./png.js");

const GLYPHS = {
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
};

function textShape(word, cell) {
  const pad = cell;
  const w = word.length * 6 * cell - cell + pad * 2, h = 7 * cell + pad * 2;
  const alpha = new Uint8Array(w * h);
  [...word].forEach((ch, n) => {
    GLYPHS[ch].forEach((row, gy) => [...row].forEach((bit, gx) => {
      if (bit !== "1") return;
      const x0 = pad + (n * 6 + gx) * cell, y0 = pad + gy * cell;
      for (let y = y0; y < y0 + cell; y++) for (let x = x0; x < x0 + cell; x++) alpha[y * w + x] = 255;
    }));
  });
  return { alpha, w, h };
}

const out = process.argv[2] || "test.png";
const extra = process.argv[3] ? JSON.parse(process.argv[3]) : {};
const cell = 14;
const shape = textShape("DISTRESS", cell);
const cols = 3, gap = 12;
const list = process.env.FROM ? Core.TEXTURES.slice(+process.env.FROM) : Core.TEXTURES;
const rows = Math.ceil(list.length / cols);
const W = cols * (shape.w + gap) + gap, H = rows * (shape.h + gap) + gap;
const img = new Uint8Array(W * H * 3).fill(232);
const ink = [24, 24, 28], color = [200, 70, 50];

let total = 0;
list.forEach((t, k) => {
  const params = Object.assign({}, Core.DEFAULTS, { texture: t.id }, extra);
  const bounds = { left: 0, top: 0, right: shape.w, bottom: shape.h };
  const t0 = Date.now();
  const res = Core.computeMask({ alpha: shape.alpha, width: shape.w, height: shape.h, originX: 0, originY: 0, pxScale: 1, bounds, params, wantColor: params.colorEnabled });
  total += Date.now() - t0;
  const ox = gap + (k % cols) * (shape.w + gap), oy = gap + Math.floor(k / cols) * (shape.h + gap);
  for (let y = 0; y < shape.h; y++) for (let x = 0; x < shape.w; x++) {
    const i = y * shape.w + x, o = ((oy + y) * W + ox + x) * 3;
    const a = shape.alpha[i] / 255 * res.mask[i] / 255;
    const c = res.color ? res.color[i] / 255 : 0;
    for (let ch = 0; ch < 3; ch++) {
      let v = img[o + ch] * (1 - a) + ink[ch] * a;
      v = v * (1 - c) + color[ch] * c;
      img[o + ch] = v;
    }
  }
});
fs.writeFileSync(out, encodePNG(W, H, img, 3));
const px = shape.w * shape.h;
console.log(`${list.length} Texturen, ${shape.w}x${shape.h}px je Schriftzug, Ø ${(total / list.length).toFixed(0)} ms (${(total / list.length / px * 1e6).toFixed(0)} ms pro Megapixel)`);
