// Applies the MS Distress engine to a raw alpha mask (for showcase images).
// Usage: node tools/distress-raw.js <alpha.raw> <width> <height> '<params-json>' <mask.raw> [<colour.raw>]
const fs = require("fs");
const path = require("path");
const Core = require(path.join(__dirname, "..", "distress", "core.js"));

const [inFile, w, h, json, outFile, colorFile] = process.argv.slice(2);
const width = +w, height = +h;
const alpha = new Uint8Array(fs.readFileSync(inFile));
const params = Object.assign({}, Core.DEFAULTS, JSON.parse(json));
const bounds = { left: 0, top: 0, right: width, bottom: height };
const res = Core.computeMask({
  alpha, width, height, originX: 0, originY: 0, pxScale: 1, bounds, params, wantColor: !!colorFile,
});
fs.writeFileSync(outFile, res.mask);
if (colorFile) fs.writeFileSync(colorFile, res.color);
