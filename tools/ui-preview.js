// Shows the panel UI in a browser (without Photoshop): Photoshop/UXP are mocked.
// Open ui-preview.html; it names the plugin folder in data-plugin (e.g. "../distress/").
// ui-preview.html?demo adds a small document with a text layer, so the preview and the texture thumbnails
// render with the real engine (imaging is mimicked with a canvas) – used for the README screenshot.
const SCRIPT_END = "</" + "script>";
const f = document.getElementById("frame");
const base = f.getAttribute("data-plugin");
(async () => {
  const get = async (p) => (await fetch(base + p)).text();
  const html = await get("index.html");
  const main = await get("main.js");
  // collect every local module that main.js (and its modules) load via require("./x.js")
  const mods = {};
  const scan = async (src) => {
    for (const m of src.matchAll(/require\("\.\/([^"]+)"\)/g)) {
      if (mods[m[1]] !== undefined) continue;
      mods[m[1]] = "";
      mods[m[1]] = await get(m[1]);
      await scan(mods[m[1]]);
    }
  };
  await scan(main);
  const defs = Object.keys(mods).map((n) => `window.__defs[${JSON.stringify(n)}] = function (module, exports, require) {\n${mods[n]}\n};`).join("\n");
  const stub = "<script>" + `
  window.__defs = {}; window.__cache = {};
  ` + defs + `
  const fake = { app: { activeDocument: null, version: "test", documents: [], foregroundColor: { rgb: { red: 0, green: 0, blue: 0 } } }, core: { executeAsModal: async (fn) => fn({ hostControl: { suspendHistory: async () => 1, resumeHistory: async () => {} } }) },
    action: { batchPlay: async () => [{}], addNotificationListener: () => {} }, imaging: {}, constants: {} };
  if (` + JSON.stringify(/[?&]demo\b/.test(location.search)) + `) {
    // a 1600 × 600 document with one layer: a light card with distressable lettering
    const W = 1600, H = 600, art = document.createElement("canvas"); art.width = W; art.height = H;
    const x = art.getContext("2d");
    x.fillStyle = "#efe6d6"; x.fillRect(0, 0, W, H);
    x.textAlign = "center"; x.fillStyle = "#c8201e"; x.font = "900 200px Impact, 'Archivo Black', 'Arial Black', sans-serif"; x.fillText("MS DISTRESS", W / 2, 290);
    x.fillStyle = "#151515"; x.font = "900 84px Impact, 'Archivo Black', 'Arial Black', sans-serif"; x.fillText("PLUGIN FOR PHOTOSHOP", W / 2, 480);
    const imgData = (buf, w, h, c) => ({ width: w, height: h, components: c, componentSize: 8, getData: async () => buf, dispose: () => {} });
    const layer = { id: 2, name: "MS DISTRESS", kind: "pixel", bounds: { left: 0, top: 0, right: W, bottom: H }, boundsNoEffects: { left: 0, top: 0, right: W, bottom: H } };
    fake.app.activeDocument = { id: 1, title: "MS Distress.psd", width: W, height: H, bitsPerChannel: "bitDepth8", layers: [layer], activeLayers: [layer] };
    fake.app.documents = [fake.app.activeDocument];
    fake.imaging = {
      createImageDataFromBuffer: async (buf, o) => imgData(buf, o.width, o.height, o.components),
      encodeImageData: async ({ imageData: d }) => {
        const c = document.createElement("canvas"); c.width = d.width; c.height = d.height;
        const g = c.getContext("2d"), id = g.createImageData(d.width, d.height), src = await d.getData();
        for (let i = 0; i < d.width * d.height; i++) for (let k = 0; k < 4; k++) id.data[i * 4 + k] = k < 3 ? src[i * d.components + (d.components >= 3 ? k : 0)] : (d.components === 4 ? src[i * 4 + 3] : 255);
        g.putImageData(id, 0, 0); return c.toDataURL("image/jpeg", 0.92).split(",")[1];
      },
      getPixels: async (o) => {
        const sb = o.sourceBounds || { left: 0, top: 0, right: W, bottom: H }, sw = sb.right - sb.left, sh = sb.bottom - sb.top;
        const tw = o.targetSize ? o.targetSize.width : sw, th = o.targetSize ? o.targetSize.height : sh;
        const c = document.createElement("canvas"); c.width = tw; c.height = th;
        const g = c.getContext("2d"); g.drawImage(art, sb.left, sb.top, sw, sh, 0, 0, tw, th);
        return { imageData: imgData(new Uint8Array(g.getImageData(0, 0, tw, th).data.buffer), tw, th, 4), sourceBounds: sb };
      },
    };
  }
  const uxp = { storage: { localFileSystem: { getDataFolder: async () => ({ createFile: async () => ({ write: async () => {} }), getEntry: async () => { throw 1; }, getEntries: async () => [] }), getFileForSaving: async () => null }, formats: { utf8: "utf8", binary: "binary" } }, entrypoints: { setup: () => {} } };
  window.require = (n) => {
    if (n === "photoshop") return fake;
    if (n === "uxp") return uxp;
    const k = n.replace("./", "");
    if (window.__cache[k]) return window.__cache[k].exports;
    const module = { exports: {} }; window.__cache[k] = module;
    window.__defs[k](module, module.exports, window.require);
    return module.exports;
  };
  ` + SCRIPT_END;
  const doc = html
    .replace(/<link rel="stylesheet" href="([^"]+)">/g, (m, h) => `<link rel="stylesheet" href="${base}${h}">`)
    .replace("</head>", () => stub + "</head>")
    .replace('<script src="main.js"></' + 'script>', () => "<script>" + main + SCRIPT_END);
  f.srcdoc = doc;
})();
