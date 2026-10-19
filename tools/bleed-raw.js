// Ink bleed of the Grime engine on a raw alpha mask (for showcase images).
// Usage: node tools/bleed-raw.js <alpha.raw> <width> <height> '<params-json>' <mask.raw> <bleed.raw>
// Writes the distress mask (width × height) and the bleed alpha ((width + 2·pad) × (height + 2·pad));
// prints {"pad": n}.
const fs = require("fs");
const path = require("path");
const Core = require(path.join(__dirname, "..", "distress", "core.js"));

const [inFile, w, h, json, maskFile, bleedFile] = process.argv.slice(2);
const width = +w, height = +h;
const alpha = new Uint8Array(fs.readFileSync(inFile));
const params = Object.assign({}, Core.DEFAULTS, JSON.parse(json));
const bounds = { left: 0, top: 0, right: width, bottom: height };
const { mask } = Core.computeMask({ alpha, width, height, originX: 0, originY: 0, pxScale: 1, bounds, params });
const b = Core.computeBleed({ alpha, mask, width, height, originX: 0, originY: 0, pxScale: 1, params });
fs.writeFileSync(maskFile, mask);
fs.writeFileSync(bleedFile, b.alpha);
console.log(JSON.stringify({ pad: b.pad }));
