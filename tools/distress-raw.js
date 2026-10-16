// Wendet die MS-Distress-Engine auf eine rohe Alpha-Maske an (für Showcase-Bilder).
// Aufruf: node tools/distress-raw.js <alpha.raw> <breite> <höhe> '<params-json>' <maske.raw> [<farbe.raw>]
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
