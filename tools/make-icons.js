// Creates the plugin icons (a "weathered" G) with its own engine.
const fs = require("fs");
const path = require("path");
const Core = require(path.join(__dirname, "..", "distress", "core.js"));
const { encodePNG } = require("./png.js");

const dir = path.join(__dirname, "..", "distress", "icons");
fs.mkdirSync(dir, { recursive: true });

function icon(size, file) {
  const alpha = new Uint8Array(size * size);
  const m = size * 0.16, stroke = size * 0.2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    // letter G: ring with a gap at the upper right + a bar in the middle
    const cx = size / 2, cy = size / 2, r = size / 2 - m;
    const dx = x - cx, dy = y - cy, d = Math.sqrt(dx * dx + dy * dy), ang = Math.atan2(dy, dx);
    const inRing = d <= r && d >= r - stroke && !(ang > -1.0 && ang < -0.15);
    const inBar = x >= cx && x <= cx + r && y >= cy - stroke * 0.45 && y <= cy + stroke * 0.45;
    if (inBar || inRing) alpha[y * size + x] = 255;
  }
  const p = Object.assign({}, Core.DEFAULTS, { texture: "grunge", scale: size * 1.2, shapeDistress: 30, innerDistress: 20, innerEdgeSize: 1, edgeRoughness: 0 });
  const res = Core.computeMask({ alpha, width: size, height: size, originX: 0, originY: 0, pxScale: 1, bounds: { left: 0, top: 0, right: size, bottom: size }, params: p });
  const rgba = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    rgba[i * 4] = 220; rgba[i * 4 + 1] = 220; rgba[i * 4 + 2] = 220;
    rgba[i * 4 + 3] = alpha[i] * res.mask[i] / 255;
  }
  fs.writeFileSync(path.join(dir, file), encodePNG(size, size, rgba, 4));
}

icon(23, "icon@1x.png");
icon(46, "icon@2x.png");
icon(48, "plugin@1x.png");
icon(96, "plugin@2x.png");
console.log("Icons written:", fs.readdirSync(dir).join(", "));
