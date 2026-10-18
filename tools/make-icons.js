// Creates the plugin icons (a "weathered" D) with its own engine.
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
    // letter D: left bar + half-ring
    const cx = size * 0.42, cy = size / 2, r = size / 2 - m;
    const inBar = x >= m && x < m + stroke && y >= m && y < size - m;
    const dx = x - cx, dy = y - cy, d = Math.sqrt(dx * dx + dy * dy);
    const inRing = (x >= cx ? d <= r && d >= r - stroke : (y < m + stroke || y >= size - m - stroke) && x >= m && y >= m && y < size - m);
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
