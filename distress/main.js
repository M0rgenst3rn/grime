"use strict";
// MS Distress – Photoshop-UXP-Panel.
// Liest die Pixel der ausgewählten Ebene(n), berechnet mit core.js eine Distress-Maske
// und schreibt sie als (nicht-destruktive) Ebenenmaske zurück.

const { app, core, action, imaging } = require("photoshop");
const { batchPlay } = action;
const Core = require("./core.js");
const uxpStorage = require("uxp").storage;
const lfs = uxpStorage.localFileSystem;

const $ = (id) => document.getElementById(id);
const STORE_KEY = "msdistress.state.v1";
const PRESET_KEY = "msdistress.presets.v1";
const COLOR_SUFFIX = " · Distress-Farbe";

const BUILTIN_PRESETS = {
  "Subtle Wear": { texture: "grunge", scale: 60, shapeDistress: 18, shapeMeld: 30, edgeRoughness: 1.5, innerDistress: 6, innerEdgeSize: 8 },
  "Vintage Print": { texture: "worn", scale: 80, shapeDistress: 45, shapeMeld: 10, edgeRoughness: 2, innerDistress: 25, innerEdgeSize: 8 },
  "Heavy Grunge": { texture: "grunge", scale: 150, shapeDistress: 60, shapeMeld: 25, edgeRoughness: 6, innerDistress: 40, innerEdgeSize: 14 },
  "Rubber Stamp": { texture: "stamp", scale: 120, shapeDistress: 45, shapeMeld: 5, edgeRoughness: 5, innerDistress: 30, innerEdgeSize: 6 },
  "Rusty Sign": { texture: "rust", scale: 130, shapeDistress: 50, shapeMeld: 20, edgeRoughness: 4, innerDistress: 30, innerEdgeSize: 20, colorEnabled: true, color: "#8a4a22", colorOpacity: 85 },
  "Screen Print": { texture: "halftone", scale: 60, shapeDistress: 40, shapeMeld: 5, edgeRoughness: 1, innerDistress: 20, innerEdgeSize: 10 },
  "Cracked Paint": { texture: "cracks", scale: 140, shapeDistress: 30, shapeMeld: 8, edgeRoughness: 2, innerDistress: 22, innerEdgeSize: 4 },
  "Peeling Poster": { texture: "peeling", scale: 160, shapeDistress: 45, shapeMeld: 10, edgeRoughness: 3, innerDistress: 30, innerEdgeSize: 10 },
  "Faded Poster": { texture: "worn", scale: 90, shapeDistress: 40, shapeMeld: 20, edgeRoughness: 2, innerDistress: 20, innerEdgeSize: 8, fadeAmount: 70, fadeStyle: "bottom", fadeTarget: "both" },
  "Chalkboard": { texture: "chalk", scale: 70, shapeDistress: 45, shapeMeld: 15, edgeRoughness: 3, innerDistress: 35, innerEdgeSize: 5 },
  "Dry Brush": { texture: "drybrush", scale: 110, shapeDistress: 50, shapeMeld: 12, edgeRoughness: 4, innerDistress: 30, innerEdgeSize: 6 },
};

const SLIDERS = [
  { key: "scale", label: "Scale", min: 10, max: 500, step: 1, unit: "%", parent: "secTexture" },
  { key: "rotation", label: "Rotation", min: 0, max: 360, step: 1, unit: "°", parent: "secTexture" },
  { key: "shapeDistress", label: "Shape Distress", min: 0, max: 100, step: 1, unit: "%", parent: "secShape" },
  { key: "shapeMeld", label: "Shape Meld", min: 0, max: 100, step: 1, unit: "%", parent: "secShape" },
  { key: "edgeRoughness", label: "Edge Roughness", min: 0, max: 60, step: 0.5, unit: "px", parent: "secShape" },
  { key: "innerDistress", label: "Inner Distress", min: 0, max: 100, step: 1, unit: "%", parent: "secInner" },
  { key: "innerEdgeSize", label: "Inner Edge Size", min: 0, max: 200, step: 1, unit: "px", parent: "secInner" },
  { key: "fadeAmount", label: "Fade Amount", min: 0, max: 100, step: 1, unit: "%", parent: "secFade" },
  { key: "texture2Mix", label: "Mix", min: 0, max: 100, step: 1, unit: "%", parent: "secTexture2" },
  { key: "texture2Scale", label: "Scale 2", min: 10, max: 500, step: 1, unit: "%", parent: "secTexture2" },
  { key: "colorOpacity", label: "Farb-Deckkraft", min: 0, max: 100, step: 1, unit: "%", parent: "secColor" },
];

let params = loadParams();
let previewSrc = null;   // { layerId, w, h, rgba, alpha, sb, pxScale }
let customTex = null;    // { layerId, w, h, data, k }
let imageTextures = [];  // [{ id: "img:…", name, w, h, file, data: Uint8Array }]

function texData(id) {
  if (!id) return null;
  if (id === "custom") return customTex;
  return imageTextures.find((t) => t.id === id) || null;
}
function texLabel(id) {
  const t = Core.TEXTURES.find((x) => x.id === id) || imageTextures.find((x) => x.id === id);
  return t ? t.name : id === "custom" ? "Eigene Ebene" : "";
}
let busy = false;
let cdfCache = { key: "", cdf: null };
const ctl = {};          // key -> { range, num }

// ---------------------------------------------------------------- Persistenz

function loadParams() {
  try { return Object.assign({}, Core.DEFAULTS, JSON.parse(localStorage.getItem(STORE_KEY) || "{}")); }
  catch (e) { return Object.assign({}, Core.DEFAULTS); }
}
function saveParams() { try { localStorage.setItem(STORE_KEY, JSON.stringify(params)); } catch (e) { /* egal */ } }
function loadUserPresets() { try { return JSON.parse(localStorage.getItem(PRESET_KEY) || "{}"); } catch (e) { return {}; } }
function saveUserPresets(p) { try { localStorage.setItem(PRESET_KEY, JSON.stringify(p)); } catch (e) { /* egal */ } }

// ---------------------------------------------------------------- Helfer

function setStatus(msg, isErr) {
  const el = $("status");
  el.textContent = msg || "";
  el.className = isErr ? "status err" : "status";
}
function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || "").trim());
  const n = m ? parseInt(m[1], 16) : 0xf1e6d2;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function rgbToHex(r, g, b) {
  return "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
}
function allLayers(list, out) {
  out = out || [];
  for (const l of list) { out.push(l); if (l.layers) allLayers(l.layers, out); }
  return out;
}
// Pixel-Bounds der Ebene plus Puffer: Konturen von Formebenen (Stroke außen/mittig) liegen
// teils außerhalb von boundsNoEffects und blieben sonst unmaskiert als Rand stehen.
function layerBounds(layer, doc) {
  const a = layer.boundsNoEffects || layer.bounds;
  const pad = 12;
  let left = Math.floor(a.left) - pad, top = Math.floor(a.top) - pad;
  let right = Math.ceil(a.right) + pad, bottom = Math.ceil(a.bottom) + pad;
  if (a.right - a.left <= 0 || a.bottom - a.top <= 0) return { left: 0, top: 0, right: 0, bottom: 0 };
  if (doc) {
    left = Math.max(0, left); top = Math.max(0, top);
    right = Math.min(Math.round(Number(doc.width)), right);
    bottom = Math.min(Math.round(Number(doc.height)), bottom);
  }
  return { left, top, right, bottom };
}
function paramsFor(index) {
  const p = Object.assign({}, params);
  if (p.varySeed && index > 0) p.seed = (p.seed | 0) + index * 7919;
  return p;
}
function debounce(fn, ms) {
  let t = null;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

async function selectLayer(id) {
  await batchPlay([{ _obj: "select", _target: [{ _ref: "layer", _id: id }], makeVisible: false }], {});
}
async function selectLayers(ids) {
  const cmds = ids.map((id, i) => {
    const c = { _obj: "select", _target: [{ _ref: "layer", _id: id }], makeVisible: false };
    if (i > 0) c.selectionModifier = { _enum: "selectionModifierType", _value: "addToSelection" };
    return c;
  });
  if (cmds.length) await batchPlay(cmds, {});
}
async function hasUserMask(id) {
  const r = await batchPlay([{ _obj: "get", _target: [{ _property: "hasUserMask" }, { _ref: "layer", _id: id }] }], {});
  return !!(r && r[0] && r[0].hasUserMask);
}

async function maskEnabled(id) {
  const r = await batchPlay([{ _obj: "get", _target: [{ _property: "userMaskEnabled" }, { _ref: "layer", _id: id }] }], {});
  return !(r && r[0] && r[0].userMaskEnabled === false);
}
async function setMaskEnabled(id, on) {
  await batchPlay([{ _obj: "set", _target: [{ _ref: "layer", _id: id }], to: { _obj: "layer", userMaskEnabled: on } }], {});
}

// ---------------------------------------------------------------- Protokoll
// Jede Aktion landet in PluginData/distress-log.txt (letzte 400 Zeilen), für die Fehleranalyse.
const logLines = [];
let logWriteTimer = null;
function log(msg, data) {
  const line = new Date().toISOString() + " " + msg + (data !== undefined ? " " + JSON.stringify(data) : "");
  logLines.push(line);
  if (logLines.length > 400) logLines.splice(0, logLines.length - 400);
  clearTimeout(logWriteTimer);
  logWriteTimer = setTimeout(async () => {
    try {
      const folder = await lfs.getDataFolder();
      const f = await folder.createFile("distress-log.txt", { overwrite: true });
      await f.write(logLines.join("\n") + "\n");
    } catch (e) { console.log("Log nicht schreibbar", e); }
  }, 300);
}
function effectiveParams(p) {
  const out = {};
  for (const k of Object.keys(Core.DEFAULTS)) if (k !== "varySeed") out[k] = p[k];
  return out;
}
function diffParams(a, b) {
  return Object.keys(a).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}
// Was zuletzt wirklich auf jede Ebene geschrieben wurde: "docId:layerId" -> Parameter
const lastApplied = new Map();

// Liest Ebenenpixel OHNE die (Distress-)Ebenenmaske. Muss im Modal-Kontext laufen.
// keepHistory=false: Masken-Umschalten wird über die Protokoll-Unterbrechung zurückgerollt.
async function readLayerUnmasked(ctx, doc, layer, sourceBounds, targetSize) {
  const opts = { documentID: doc.id, layerID: layer.id, sourceBounds, colorSpace: "RGB", componentSize: 8 };
  if (targetSize) opts.targetSize = targetSize;
  let disabled = false, hid = null;
  if (await hasUserMask(layer.id) && await maskEnabled(layer.id)) {
    if (ctx) hid = await ctx.hostControl.suspendHistory({ documentID: doc.id, name: "MS Distress lesen" });
    await setMaskEnabled(layer.id, false);
    disabled = true;
  }
  try {
    return await imaging.getPixels(opts);
  } finally {
    if (disabled) {
      if (hid !== null) await ctx.hostControl.resumeHistory(hid, false);
      else await setMaskEnabled(layer.id, true);
    }
  }
}

// Rohdaten (chunky) -> Alpha-Kanal
function extractAlpha(data, comps, n) {
  const alpha = new Uint8Array(n);
  if (comps === 4 || comps === 2) {
    for (let i = 0; i < n; i++) alpha[i] = data[i * comps + comps - 1];
  } else {
    alpha.fill(255);
  }
  return alpha;
}
function to8bit(data, componentSize) {
  if (componentSize === 8) return data;
  const out = new Uint8Array(data.length);
  const f = componentSize === 16 ? 255 / 32768 : 255;
  for (let i = 0; i < data.length; i++) out[i] = Math.max(0, Math.min(255, Math.round(data[i] * f)));
  return out;
}
// 8-Bit-Puffer an die Bittiefe des Dokuments anpassen
function fromBuf8(buf, doc) {
  const depth = String(doc.bitsPerChannel || "");
  if (depth.indexOf("16") >= 0) {
    const out = new Uint16Array(buf.length);
    for (let i = 0; i < buf.length; i++) out[i] = Math.round(buf[i] * 32768 / 255);
    return out;
  }
  if (depth.indexOf("32") >= 0) {
    const out = new Float32Array(buf.length);
    for (let i = 0; i < buf.length; i++) out[i] = buf[i] / 255;
    return out;
  }
  return buf;
}

// ---------------------------------------------------------------- UI aufbauen

function buildSliders() {
  for (const s of SLIDERS) {
    const row = document.createElement("div");
    row.className = "ctl";
    row.innerHTML =
      `<span class="ctl-label">${s.label}</span>` +
      `<sp-slider class="ctl-range" min="${s.min}" max="${s.max}" step="${s.step}"></sp-slider>` +
      `<input class="ctl-num" type="text"><span class="ctl-unit">${s.unit}</span>`;
    $(s.parent).appendChild(row);
    const range = row.querySelector(".ctl-range");
    const num = row.querySelector(".ctl-num");
    ctl[s.key] = { range, num, def: s };
    const onRange = () => {
      params[s.key] = Number(range.value);
      num.value = String(params[s.key]);
      changed();
    };
    range.addEventListener("input", onRange);
    range.addEventListener("change", onRange);
    num.addEventListener("change", () => {
      let v = parseFloat(String(num.value).replace(",", "."));
      if (isNaN(v)) v = params[s.key];
      v = Math.max(s.min, Math.min(s.max, v));
      params[s.key] = v;
      syncUI();
      changed();
    });
  }
}

function buildTextureGrid() {
  const grid = $("texGrid");
  grid.innerHTML = "";
  const list = Core.TEXTURES
    .concat(imageTextures.map((t) => ({ id: t.id, name: t.name })))
    .concat([{ id: "custom", name: "Eigene Ebene" }, { id: "__add", name: "+ Bild laden" }]);
  for (const t of list) {
    const tile = document.createElement("div");
    tile.className = "tile";
    tile.dataset.id = t.id;
    tile.innerHTML = `<div class="ph"></div><div class="lbl">${t.name}</div>`;
    tile.title = t.name;
    if (t.id === "__add") tile.innerHTML = `<div class="ph add">+</div><div class="lbl">Bild laden…</div>`;
    tile.addEventListener("click", () => {
      if (t.id === "__add") return importImageTextures();
      params.texture = t.id;
      syncUI();
      if (t.id === "custom") refreshCustomLayers();
      changed();
    });
    grid.appendChild(tile);
  }
  renderThumbs();
}

async function renderThumbs() {
  if (!imaging || !imaging.encodeImageData) return;
  const size = 38;
  const all = Core.TEXTURES.concat(imageTextures);
  for (const t of all) {
    try {
      const g = Core.renderThumb(t.id, size, texData(t.id));
      const rgb = new Uint8Array(size * size * 3);
      for (let i = 0; i < g.length; i++) {
        const v = 40 + g[i] * 0.85;
        rgb[i * 3] = v; rgb[i * 3 + 1] = v; rgb[i * 3 + 2] = v;
      }
      const src = await encodeRGB(rgb, size, size);
      const tile = document.querySelector(`.tile[data-id="${t.id}"]`);
      if (tile && src) {
        const img = document.createElement("img");
        img.src = src;
        tile.replaceChild(img, tile.firstChild);
      }
    } catch (e) { console.log("Thumb-Fehler", t.id, e); return; }
  }
}

async function encodeRGB(rgb, w, h) {
  const imgData = await imaging.createImageDataFromBuffer(rgb, {
    width: w, height: h, components: 3, chunky: true, colorSpace: "RGB", colorProfile: "sRGB IEC61966-2.1",
  });
  try {
    const b64 = await imaging.encodeImageData({ imageData: imgData, base64: true });
    return "data:image/jpeg;base64," + b64;
  } finally {
    imgData.dispose();
  }
}

function buildSelects() {
  $("fadeStyle").innerHTML = Core.FADE_STYLES.map((f) => `<option value="${f.id}">${f.name}</option>`).join("");
  $("texture2Mode").innerHTML = Core.MIX_MODES.map((f) => `<option value="${f.id}">${f.name}</option>`).join("");
  buildTexture2Select();
  rebuildPresetSelect();
}

function buildTexture2Select() {
  let html = `<option value="">– keine –</option>`;
  html += Core.TEXTURES.map((t) => `<option value="${t.id}">${t.name}</option>`).join("");
  if (imageTextures.length) {
    html += `<option value="" disabled>── Bilder ──</option>`;
    html += imageTextures.map((t) => `<option value="${t.id}">🖼 ${t.name}</option>`).join("");
  }
  $("texture2").innerHTML = html;
  $("texture2").value = params.texture2 || "";
}

function rebuildPresetSelect() {
  const user = loadUserPresets();
  let html = `<option value="">– Preset wählen –</option>`;
  for (const n of Object.keys(BUILTIN_PRESETS)) html += `<option value="b:${n}">${n}</option>`;
  const userNames = Object.keys(user);
  if (userNames.length) {
    html += `<option value="" disabled>── Eigene ──</option>`;
    for (const n of userNames) html += `<option value="u:${n}">★ ${n}</option>`;
  }
  $("presetSelect").innerHTML = html;
  $("presetSelect").value = "";
}

function syncUI() {
  for (const key of Object.keys(ctl)) {
    ctl[key].range.value = String(params[key]);
    ctl[key].num.value = String(params[key]);
  }
  document.querySelectorAll(".tile").forEach((el) => {
    el.className = el.dataset.id === params.texture ? "tile active" : "tile";
  });
  $("texName").textContent = "· " + texLabel(params.texture) + (params.texture2 ? " + " + texLabel(params.texture2) : "");
  $("deleteImgTex").className = String(params.texture).startsWith("img:") ? "" : "hidden";
  $("texture2").value = params.texture2 || "";
  $("texture2Mode").value = params.texture2Mode;
  $("texture2Invert").checked = !!params.texture2Invert;
  $("tex2Controls").className = params.texture2 ? "" : "hidden";
  $("customRow").className = params.texture === "custom" ? "" : "hidden";
  $("invert").checked = !!params.invert;
  $("fadeStyle").value = params.fadeStyle;
  $("fadeTarget").value = params.fadeTarget;
  $("colorEnabled").checked = !!params.colorEnabled;
  $("colorHex").value = params.color;
  $("swatch").style.backgroundColor = params.color;
  $("seed").value = String(params.seed);
  $("varySeed").checked = !!params.varySeed;
}

function bindControls() {
  $("invert").addEventListener("change", (e) => { params.invert = e.target.checked; changed(); });
  $("texture2").addEventListener("change", (e) => { params.texture2 = e.target.value; syncUI(); changed(); });
  $("texture2Mode").addEventListener("change", (e) => { params.texture2Mode = e.target.value; changed(); });
  $("texture2Invert").addEventListener("change", (e) => { params.texture2Invert = e.target.checked; changed(); });
  $("deleteImgTex").addEventListener("click", () => deleteImageTexture(params.texture));
  $("fadeStyle").addEventListener("change", (e) => { params.fadeStyle = e.target.value; changed(); });
  $("fadeTarget").addEventListener("change", (e) => { params.fadeTarget = e.target.value; changed(); });
  $("colorEnabled").addEventListener("change", (e) => { params.colorEnabled = e.target.checked; changed(); });
  $("colorHex").addEventListener("change", (e) => {
    let v = String(e.target.value).trim();
    if (v[0] !== "#") v = "#" + v;
    if (/^#[0-9a-f]{6}$/i.test(v)) params.color = v.toLowerCase();
    syncUI(); changed();
  });
  $("swatch").addEventListener("click", pickColor);
  $("fgColor").addEventListener("click", () => {
    try {
      params.color = "#" + app.foregroundColor.rgb.hexValue.toLowerCase();
      params.colorEnabled = true;
      syncUI(); changed();
    } catch (e) { setStatus("Vordergrundfarbe nicht lesbar: " + e.message, true); }
  });
  $("seed").addEventListener("change", (e) => {
    const v = parseInt(e.target.value, 10);
    if (!isNaN(v)) params.seed = v;
    syncUI(); changed();
  });
  $("dice").addEventListener("click", () => { params.seed = Math.floor(Math.random() * 99999); syncUI(); changed(); });
  $("varySeed").addEventListener("change", (e) => { params.varySeed = e.target.checked; saveParams(); });
  $("previewDark").addEventListener("change", () => renderPreview());
  $("refreshPreview").addEventListener("click", () => refreshPreviewSource());
  $("customLayer").addEventListener("change", (e) => loadCustomTexture(parseInt(e.target.value, 10)));

  $("presetSelect").addEventListener("change", (e) => {
    const v = e.target.value;
    if (!v) return;
    const src = v.startsWith("b:") ? BUILTIN_PRESETS[v.slice(2)] : loadUserPresets()[v.slice(2)];
    if (!src) return;
    params = Object.assign({}, Core.DEFAULTS, { seed: params.seed, varySeed: params.varySeed }, src);
    syncUI(); changed();
    setStatus(`Preset „${v.slice(2)}“ geladen.`);
  });
  $("presetSave").addEventListener("click", () => {
    const name = String($("presetName").value || "").trim();
    if (!name) return setStatus("Bitte einen Namen für das Preset eingeben.", true);
    const user = loadUserPresets();
    user[name] = Object.assign({}, params);
    saveUserPresets(user);
    rebuildPresetSelect();
    $("presetName").value = "";
    setStatus(`Preset „${name}“ gespeichert.`);
  });
  $("presetDelete").addEventListener("click", () => {
    const v = $("presetSelect").value;
    if (!v.startsWith("u:")) return setStatus("Wähle zuerst ein eigenes Preset (★) aus.", true);
    const user = loadUserPresets();
    delete user[v.slice(2)];
    saveUserPresets(user);
    rebuildPresetSelect();
    setStatus("Preset gelöscht.");
  });
  $("resetAll").addEventListener("click", () => {
    params = Object.assign({}, Core.DEFAULTS);
    syncUI(); changed();
  });

  $("liveCanvas").addEventListener("change", (e) => {
    liveLast = null;
    if (e.target.checked) applyDistress(true);
    else setStatus("Live aus – der aktuelle Stand bleibt auf der Ebene.");
  });
  $("apply").addEventListener("click", () => applyDistress(false));
  $("remove").addEventListener("click", removeDistress);
  $("verify").addEventListener("click", verifyCanvas);
  $("selfTest").addEventListener("click", runSelfTest);
}

const debouncedPreview = debounce(() => renderPreview(), 60);
function changed() {
  saveParams();
  debouncedPreview();
  if ($("liveCanvas").checked) debouncedLive();
  else showSyncHint();
}

// Hinweis, wenn die aktuellen Einstellungen noch nicht auf dem Canvas sind
function showSyncHint() {
  try {
    const doc = app.activeDocument;
    if (!doc) return;
    const layer = doc.activeLayers[0];
    if (!layer) return;
    const applied = lastApplied.get(doc.id + ":" + layer.id);
    if (!applied) return;
    const diff = diffParams(effectiveParams(paramsFor(0)), applied);
    if (diff.length) setStatus(`● Noch nicht auf dem Canvas: ${diff.join(", ")} – „Distress anwenden“ klicken oder Live einschalten.`);
    else setStatus("Canvas entspricht den Einstellungen.");
  } catch (e) { /* egal */ }
}

// ---------------------------------------------------------------- Selbsttest
// Liest die echte Maske aus Photoshop zurück und vergleicht sie mit dem, was die aktuellen
// Einstellungen ergeben müssten. So lassen sich Abweichungen ohne Durchprobieren finden.
// Prüft eine Ebene: liest die echte Maske aus Photoshop und vergleicht sie mit dem Sollwert
// für die Parameter p. Muss im Modal-Kontext laufen.
async function verifyLayer(ctx, doc, layer, p) {
  const r = { ebene: layer.name };
  const b = layerBounds(layer, doc);
  const bw = b.right - b.left, bh = b.bottom - b.top;
  if (bw <= 0 || bh <= 0) { r.fehler = "leer"; return r; }
  const f = Math.min(1, 1200 / Math.max(bw, bh)); // möglichst 1:1, sonst verfälscht Verkleinern feine Texturen
  const ts = f < 1 ? { width: Math.max(1, Math.round(bw * f)), height: Math.max(1, Math.round(bh * f)) } : null;
  r.hatMaske = await hasUserMask(layer.id);
  const colorName = layer.name + COLOR_SUFFIX;
  r.farbebenen = allLayers(doc.layers).filter((l) => l.name === colorName).length;
  r.farbeErwartet = !!p.colorEnabled;
  const px = await readLayerUnmasked(ctx, doc, layer, b, ts);
  const pd = px.imageData;
  const raw = to8bit(await pd.getData({ chunky: true }), pd.componentSize || 8);
  const alpha = extractAlpha(raw, pd.components, pd.width * pd.height);
  const sb = px.sourceBounds || b;
  const w = pd.width, h = pd.height;
  pd.dispose();
  if (!r.hatMaske) { r.fehler = "keine Maske auf der Ebene"; return r; }
  const { sampler, cdf } = Core.buildPipeline(p, sb, texData(p.texture), texData(p.texture2));
  const exp = Core.computeMask({ alpha, width: w, height: h, originX: sb.left, originY: sb.top,
    pxScale: (sb.right - sb.left) / w, bounds: sb, params: p, sampler, cdf });
  const mr = await imaging.getLayerMask({ documentID: doc.id, layerID: layer.id, kind: "user", sourceBounds: sb, targetSize: { width: w, height: h } });
  const md = mr.imageData;
  const mraw = to8bit(await md.getData({ chunky: true }), md.componentSize || 8);
  const mw = md.width, mh = md.height;
  md.dispose();
  let diff = 0, n = 0, bigDiff = 0, removedExp = 0, removedAct = 0;
  for (let y = 0; y < Math.min(h, mh); y++) for (let x = 0; x < Math.min(w, mw); x++) {
    const i2 = y * w + x;
    if (alpha[i2] < 128) continue;
    const a = mraw[y * mw + x], e = exp.mask[i2];
    const d = Math.abs(e - a);
    diff += d; n++;
    if (d > 128) bigDiff++;
    if (e < 128) removedExp++;
    if (a < 128) removedAct++;
  }
  r.abweichungProzent = n ? Math.round(bigDiff / n * 1000) / 10 : 0;
  r.mittlereDifferenz = n ? Math.round(diff / n) : 0;
  r.abtragSoll = n ? Math.round(removedExp / n * 100) : 0;
  r.abtragIst = n ? Math.round(removedAct / n * 100) : 0;
  r.ok = !r.fehler && r.abweichungProzent <= 2 && (r.farbebenen > 0) === r.farbeErwartet && r.farbebenen <= 1;
  return r;
}

async function verifyCanvas() {
  if (busy) return;
  const doc = app.activeDocument;
  if (!doc || !doc.activeLayers.length) return setStatus("Keine Ebene ausgewählt.", true);
  const layers = doc.activeLayers.slice();
  const report = [];
  busy = true;
  try {
    await core.executeAsModal(async (ctx) => {
      for (let i = 0; i < layers.length; i++) {
        const r = await verifyLayer(ctx, doc, layers[i], paramsFor(i));
        const applied = lastApplied.get(doc.id + ":" + layers[i].id);
        r.geaenderteEinstellungen = applied ? diffParams(effectiveParams(paramsFor(i)), applied) : "unbekannt";
        report.push(r);
      }
    }, { commandName: "MS Distress prüfen" });
  } catch (e) {
    report.push({ fehler: e.message || String(e) });
  }
  busy = false;
  ignoreEventsUntil = Date.now() + 600;
  log("PRÜFEN", report);
  const bad = report.filter((r) => !r.ok);
  if (!bad.length) setStatus("✓ Canvas entspricht den aktuellen Einstellungen.");
  else setStatus("✗ Abweichung: " + bad.map((r) => `${r.ebene || ""} ${r.fehler || ""} ${r.abweichungProzent !== undefined ? r.abweichungProzent + "% Pixel anders" : ""}${r.farbebenen !== undefined && (r.farbebenen > 0) !== r.farbeErwartet ? ", Farbebene " + (r.farbebenen ? "zu viel" : "fehlt") : ""}`).join(" | ") + " (Details im Log)", true);
}

// ---------------------------------------------------------------- Automatischer Selbsttest
// Legt ein Testdokument an und prüft alle Funktionen gegen die echte Photoshop-Maske.

function testShapePixels(w, h) {
  const G = {
    D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
    I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
    S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  };
  const buf = new Uint8Array(w * h * 4);
  const cell = 22, word = "DIS";
  [...word].forEach((ch, n) => G[ch].forEach((row, gy) => [...row].forEach((bit, gx) => {
    if (bit !== "1") return;
    for (let y = 30 + gy * cell; y < 30 + (gy + 1) * cell; y++) for (let x = 30 + (n * 6 + gx) * cell; x < 30 + (n * 6 + gx + 1) * cell; x++) {
      const i = (y * w + x) * 4; buf[i] = 30; buf[i + 1] = 60; buf[i + 2] = 200; buf[i + 3] = 255;
    }
  })));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = x - 560, dy = y - 110, d = Math.sqrt(dx * dx + dy * dy);
    if (d < 90) { const i = (y * w + x) * 4; buf[i] = 230; buf[i + 1] = 170; buf[i + 2] = 20; buf[i + 3] = Math.round(255 * Math.min(1, 90 - d)); }
  }
  return buf;
}

async function runSelfTest() {
  if (busy) return;
  const saved = Object.assign({}, params);
  const wasLive = $("liveCanvas").checked;
  $("liveCanvas").checked = false;
  const results = [];
  const t0 = Date.now();
  let doc = null;
  log("SELBSTTEST START");
  setStatus("Selbsttest läuft… (ca. 1–2 Minuten, bitte nichts anklicken)");
  try {
    // Testdokument + Testebenen
    await core.executeAsModal(async () => {
      doc = await app.documents.add({ width: 700, height: 420, resolution: 72, mode: "RGBColorMode", fill: "white", name: "MS Distress Selbsttest" });
      await batchPlay([{ _obj: "make", _target: [{ _ref: "layer" }], using: { _obj: "layer", name: "Test Pixel" } }], {});
      const pl = doc.activeLayers[0];
      const W = 700, H = 230;
      const id = await imaging.createImageDataFromBuffer(testShapePixels(W, H), { width: W, height: H, components: 4, chunky: true, colorSpace: "RGB", colorProfile: "sRGB IEC61966-2.1" });
      await imaging.putPixels({ documentID: doc.id, layerID: pl.id, imageData: id, targetBounds: { left: 0, top: 0 } });
      id.dispose();
      try {
        await batchPlay([{
          _obj: "make", _target: [{ _ref: "textLayer" }],
          using: {
            _obj: "textLayer", textKey: "TEXT",
            textClickPoint: { _obj: "paint", horizontal: { _unit: "percentUnit", _value: 5 }, vertical: { _unit: "percentUnit", _value: 92 } },
            textStyleRange: [{ _obj: "textStyleRange", from: 0, to: 4, textStyle: { _obj: "textStyle", size: { _unit: "pointsUnit", _value: 150 }, color: { _obj: "RGBColor", red: 200, grain: 30, blue: 30 } } }],
          },
        }], {});
      } catch (e) { log("  Textebene nicht erstellbar", String(e.message || e)); }
    }, { commandName: "MS Distress Selbsttest vorbereiten" });

    const layers = allLayers(doc.layers).filter((l) => !l.isBackgroundLayer);
    const D = Object.assign({}, Core.DEFAULTS, { seed: 1337, varySeed: false });
    const cases = [];
    for (const t of Core.TEXTURES) cases.push([`Textur ${t.id}`, { texture: t.id }]);
    for (const m of Core.MIX_MODES) cases.push([`Textur 2 ${m.id}`, { texture: "grunge", texture2: "cracks", texture2Mix: 70, texture2Mode: m.id }]);
    for (const f of Core.FADE_STYLES) cases.push([`Fade ${f.id}`, { fadeAmount: 80, fadeStyle: f.id }]);
    for (const tg of ["distress", "opacity", "both"]) cases.push([`Fade-Ziel ${tg}`, { fadeAmount: 70, fadeTarget: tg }]);
    cases.push(["Invertiert", { invert: true }]);
    cases.push(["Rotation 45", { rotation: 45 }]);
    cases.push(["Scale 30", { scale: 30 }]);
    cases.push(["Scale 400", { scale: 400 }]);
    cases.push(["Meld 0 / Rauheit 0", { shapeMeld: 0, edgeRoughness: 0 }]);
    cases.push(["Meld 100 / Rauheit 25", { shapeMeld: 100, edgeRoughness: 25 }]);
    cases.push(["Inner Edge 0", { innerEdgeSize: 0, innerDistress: 50 }]);
    cases.push(["Inner Edge 80", { innerEdgeSize: 80 }]);
    cases.push(["Distress 0", { shapeDistress: 0, innerDistress: 0, edgeRoughness: 0 }]);
    cases.push(["Distress 100", { shapeDistress: 100, innerDistress: 100 }]);
    cases.push(["Farbe AN", { colorEnabled: true, color: "#ff00ff" }]);
    cases.push(["Farbe wieder AUS", { colorEnabled: false }]);
    cases.push(["Textur 2 wieder AUS", { texture2: "" }]);

    const ids = layers.map((l) => l.id);
    for (const [name, over] of cases) {
      params = Object.assign({}, D, over);
      await selectLayersModal(ids);
      await applyDistress(false);
      const r = await verifyAll(doc, layers);
      results.push({ test: name, ok: r.every((x) => x.ok), details: r });
      setStatus(`Selbsttest: ${results.length}/${cases.length + 4} – ${name}`);
    }

    // Live-Modus: zwei Updates hintereinander dürfen nur EINEN Protokollschritt ergeben
    params = Object.assign({}, D, { texture: "rust" });
    await selectLayersModal(ids);
    liveLast = null;
    // Nicht die Anzahl zählen (bleibt am Protokoll-Limit konstant), sondern prüfen, dass direkt vor
    // dem letzten Live-Schritt wieder der Stand von vor dem ersten Live-Update liegt.
    const s0 = historyStateId(doc);
    await applyDistress(true);
    params = Object.assign({}, D, { texture: "speckle", colorEnabled: true });
    await applyDistress(true);
    params = Object.assign({}, D, { texture: "halftone", colorEnabled: false });
    await applyDistress(true);
    const states = doc.historyStates;
    const ai = states.findIndex((h) => h.id === historyStateId(doc));
    const before = ai > 0 ? states[ai - 1].id : null;
    const rl = await verifyAll(doc, layers);
    results.push({ test: "Live: Protokoll zusammengefasst", ok: before === s0 && states[ai].name === "MS Distress Live",
      details: { vorErstemLive: s0, vorLetztemLive: before, aktuell: ai >= 0 ? states[ai].name : null } });
    results.push({ test: "Live: Canvas = letzte Einstellung (Farbe aus)", ok: rl.every((x) => x.ok), details: rl });

    // Rückgängig: ein Schritt zurück entfernt das Live-Ergebnis
    await core.executeAsModal(async () => {
      await batchPlay([{ _obj: "select", _target: [{ _ref: "historyState", _enum: "ordinal", _value: "previous" }] }], {});
    }, { commandName: "MS Distress Test Undo" });
    liveLast = null;
    params = Object.assign({}, D, { texture: "grunge", texture2: "", colorEnabled: false });
    const ru = await verifyAll(doc, layers);
    results.push({ test: "Rückgängig stellt vorherigen Stand her", ok: ru.every((x) => x.ok), details: ru });

    // Entfernen
    await selectLayersModal(ids);
    await removeDistress();
    let removedOk = true;
    await core.executeAsModal(async () => {
      for (const l of layers) {
        if (await hasUserMask(l.id)) removedOk = false;
        if (allLayers(doc.layers).some((x) => x.name === l.name + COLOR_SUFFIX)) removedOk = false;
      }
    }, { commandName: "MS Distress Test" });
    results.push({ test: "Entfernen löscht Maske und Farbebene", ok: removedOk });
  } catch (e) {
    results.push({ test: "Abbruch", ok: false, details: String(e && e.stack || e) });
  }
  params = saved;
  $("liveCanvas").checked = wasLive;
  syncUI();
  const failed = results.filter((r) => !r.ok);
  log("SELBSTTEST ERGEBNIS", { bestanden: results.length - failed.length, gesamt: results.length, sekunden: Math.round((Date.now() - t0) / 1000) });
  for (const r of results) log((r.ok ? "  ✓ " : "  ✗ ") + r.test, r.ok ? undefined : r.details);
  setStatus(`Selbsttest: ${results.length - failed.length}/${results.length} bestanden` +
    (failed.length ? ` – fehlgeschlagen: ${failed.map((r) => r.test).join(", ")}` : " ✓"), failed.length > 0);
  refreshPreviewSource();
}

async function selectLayersModal(ids) {
  await core.executeAsModal(async () => { await selectLayers(ids); }, { commandName: "MS Distress Test" });
}
async function verifyAll(doc, layers) {
  const out = [];
  await core.executeAsModal(async (ctx) => {
    for (let i = 0; i < layers.length; i++) out.push(await verifyLayer(ctx, doc, layers[i], paramsFor(i)));
  }, { commandName: "MS Distress Test prüfen" });
  return out;
}

// ---------------------------------------------------------------- Farbwähler

async function pickColor() {
  const c0 = hexToRgb(params.color);
  try {
    let res;
    await core.executeAsModal(async () => {
      res = await batchPlay([{
        _obj: "showColorPicker",
        _target: { _ref: "application" },
        context: "MS Distress – Shape Color",
        color: { _obj: "RGBColor", red: c0.r, grain: c0.g, blue: c0.b },
      }], {});
    }, { commandName: "Farbe wählen" });
    const c = res && res[0] && (res[0].RGBFloatColor || res[0].color);
    if (c && c.red !== undefined) {
      params.color = rgbToHex(c.red, c.grain !== undefined ? c.grain : c.green, c.blue);
      params.colorEnabled = true;
      syncUI(); changed();
    }
  } catch (e) {
    setStatus("Farbwähler nicht verfügbar – Hex-Wert eintippen.", true);
  }
}

// ---------------------------------------------------------------- Vorschau

async function refreshPreviewSource() {
  if (busy) return;
  const doc = app.activeDocument;
  if (!doc) { previewSrc = null; $("layerName").textContent = "–"; return renderPreview("Kein Dokument geöffnet."); }
  const layer = doc.activeLayers[0];
  if (!layer) { previewSrc = null; $("layerName").textContent = "–"; return renderPreview("Keine Ebene ausgewählt."); }
  $("layerName").textContent = doc.activeLayers.length > 1 ? `${layer.name} (+${doc.activeLayers.length - 1})` : layer.name;
  const b = layerBounds(layer, doc);
  const bw = b.right - b.left, bh = b.bottom - b.top;
  if (bw <= 0 || bh <= 0) { previewSrc = null; return renderPreview("Ebene ist leer."); }
  const f = Math.min(1, 300 / bw, 168 / bh);
  const tw = Math.max(1, Math.round(bw * f)), th = Math.max(1, Math.round(bh * f));
  try {
    let src = null;
    await core.executeAsModal(async (ctx) => {
      const res = await readLayerUnmasked(ctx, doc, layer, b, { width: tw, height: th });
      const id = res.imageData;
      const raw = to8bit(await id.getData({ chunky: true }), id.componentSize || 8);
      const n = id.width * id.height, comps = id.components;
      const rgba = new Uint8Array(n * 4);
      for (let i = 0; i < n; i++) {
        rgba[i * 4] = raw[i * comps]; rgba[i * 4 + 1] = raw[i * comps + 1]; rgba[i * 4 + 2] = raw[i * comps + 2];
        rgba[i * 4 + 3] = comps >= 4 ? raw[i * comps + 3] : 255;
      }
      const sb = res.sourceBounds || b;
      src = {
        layerId: layer.id, w: id.width, h: id.height, rgba,
        alpha: extractAlpha(raw, comps, n), sb, pxScale: (sb.right - sb.left) / id.width,
      };
      id.dispose();
    }, { commandName: "MS Distress Vorschau" });
    ignoreEventsUntil = Date.now() + 600; // Masken-Umschalten beim Lesen nicht als Änderung werten
    previewSrc = src;
    renderPreview();
  } catch (e) {
    previewSrc = null;
    renderPreview("Vorschau nicht möglich: " + (e.message || e));
  }
}

function getPipeline(p, bounds) {
  const key = JSON.stringify([p.texture, p.scale, p.rotation, p.invert, p.seed, p.texture2, p.texture2Scale,
    p.texture2Mix, p.texture2Mode, p.texture2Invert, bounds, customTex && customTex.layerId]);
  if (cdfCache.key !== key) cdfCache = { key, pipe: Core.buildPipeline(p, bounds, texData(p.texture), texData(p.texture2)) };
  return cdfCache.pipe;
}

let previewToken = 0;
async function renderPreview(msg) {
  const img = $("preview"), m = $("previewMsg");
  if (msg || !previewSrc) {
    img.className = "hidden"; m.className = "preview-msg";
    m.textContent = msg || "Ebene auswählen…";
    return;
  }
  if (params.texture === "custom" && !customTex) {
    img.className = "hidden"; m.className = "preview-msg";
    m.textContent = "Wähle unten eine Ebene als Textur-Quelle.";
    return;
  }
  const token = ++previewToken;
  const s = previewSrc;
  const p = paramsFor(0);
  const { sampler, cdf } = getPipeline(p, s.sb);
  const out = Core.computeMask({
    alpha: s.alpha, width: s.w, height: s.h, originX: s.sb.left, originY: s.sb.top,
    pxScale: s.pxScale, bounds: s.sb, params: p, sampler, cdf, wantColor: p.colorEnabled,
  });
  const dark = $("previewDark").checked;
  const c1 = dark ? 34 : 255, c2 = dark ? 44 : 228;
  const col = hexToRgb(p.color);
  const rgb = new Uint8Array(s.w * s.h * 3);
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      const i = y * s.w + x;
      const bg = ((x >> 3) + (y >> 3)) & 1 ? c2 : c1;
      const a = (s.alpha[i] / 255) * (out.mask[i] / 255);
      const ca = out.color ? out.color[i] / 255 : 0;
      for (let ch = 0; ch < 3; ch++) {
        let v = bg * (1 - a) + s.rgba[i * 4 + ch] * a;
        v = v * (1 - ca) + (ch === 0 ? col.r : ch === 1 ? col.g : col.b) * ca;
        rgb[i * 3 + ch] = v;
      }
    }
  }
  try {
    const src = await encodeRGB(rgb, s.w, s.h);
    if (token !== previewToken) return;
    img.src = src;
    img.className = ""; m.className = "hidden";
  } catch (e) {
    img.className = "hidden"; m.className = "preview-msg";
    m.textContent = "Vorschau benötigt Photoshop 24.2 oder neuer.";
  }
}

// ---------------------------------------------------------------- Eigene Textur

function refreshCustomLayers() {
  const doc = app.activeDocument;
  const sel = $("customLayer");
  if (!doc) { sel.innerHTML = ""; return; }
  const layers = allLayers(doc.layers).filter((l) => l.kind !== "group");
  sel.innerHTML = `<option value="">– Ebene wählen –</option>` +
    layers.map((l) => `<option value="${l.id}">${l.name}</option>`).join("");
  sel.value = customTex ? String(customTex.layerId) : "";
}

async function loadCustomTexture(layerId) {
  if (!layerId) { customTex = null; return renderPreview(); }
  const doc = app.activeDocument;
  const layer = allLayers(doc.layers).find((l) => l.id === layerId);
  if (!layer) return;
  const b = layerBounds(layer, doc);
  const bw = b.right - b.left, bh = b.bottom - b.top;
  if (bw <= 0 || bh <= 0) return setStatus("Textur-Ebene ist leer.", true);
  const f = Math.min(1, 1024 / Math.max(bw, bh));
  try {
    await core.executeAsModal(async () => {
      const res = await imaging.getPixels({
        documentID: doc.id, layerID: layer.id, sourceBounds: b, colorSpace: "RGB", componentSize: 8,
        targetSize: { width: Math.max(1, Math.round(bw * f)), height: Math.max(1, Math.round(bh * f)) },
      });
      const id = res.imageData;
      const raw = to8bit(await id.getData({ chunky: true }), id.componentSize || 8);
      const n = id.width * id.height, comps = id.components;
      const data = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const a = comps >= 4 ? raw[i * comps + 3] / 255 : 1;
        const lum = (0.299 * raw[i * comps] + 0.587 * raw[i * comps + 1] + 0.114 * raw[i * comps + 2]) / 255;
        data[i] = 1 - (lum * a + (1 - a)); // dunkel = trägt ab, transparent = bleibt
      }
      customTex = { layerId, w: id.width, h: id.height, data, k: (b.right - b.left) / id.width };
      id.dispose();
    }, { commandName: "MS Distress Textur laden" });
    setStatus(`Textur aus „${layer.name}“ geladen.`);
    renderPreview();
  } catch (e) {
    setStatus("Textur konnte nicht geladen werden: " + (e.message || e), true);
  }
}

// ---------------------------------------------------------------- Bild-Texturen (Bibliothek)
// Bilder werden einmal über Photoshop geöffnet, als Graustufen (max. 2048 px) im Datenordner
// des Plugins gespeichert und stehen danach dauerhaft als Textur-Kacheln zur Verfügung.

const TEX_MAX = 2048;

async function texFolder() {
  const data = await lfs.getDataFolder();
  try { return await data.getEntry("textures"); } catch (e) { return await data.createFolder("textures"); }
}

async function saveTextureIndex() {
  const folder = await texFolder();
  const f = await folder.createFile("index.json", { overwrite: true });
  await f.write(JSON.stringify(imageTextures.map(({ id, name, w, h, file }) => ({ id, name, w, h, file }))));
}

async function loadImageTextures() {
  try {
    const folder = await texFolder();
    let index = [];
    try { index = JSON.parse(await (await folder.getEntry("index.json")).read()); } catch (e) { index = []; }
    for (const t of index) {
      try {
        const buf = await (await folder.getEntry(t.file)).read({ format: uxpStorage.formats.binary });
        imageTextures.push(Object.assign({}, t, { data: new Uint8Array(buf) }));
      } catch (e) { console.log("Textur fehlt", t.file); }
    }
  } catch (e) { console.log("Textur-Bibliothek nicht lesbar", e); }
}

async function importImageTextures() {
  if (busy) return;
  let files;
  try {
    files = await lfs.getFileForOpening({ allowMultiple: true, types: ["png", "jpg", "jpeg", "tif", "tiff", "psd", "webp", "bmp", "gif"] });
  } catch (e) { return setStatus("Dateiauswahl nicht möglich: " + (e.message || e), true); }
  const list = !files ? [] : Array.isArray(files) ? files : [files];
  if (!list.length) return;
  busy = true;
  setStatus(`Importiere ${list.length} Bild(er)…`);
  const added = [];
  const prevDoc = app.activeDocument;
  try {
    const folder = await texFolder();
    for (const file of list) {
      let tex = null;
      await core.executeAsModal(async () => {
        const d = await app.open(file);
        try {
          const W = Number(d.width), H = Number(d.height);
          const f = Math.min(1, TEX_MAX / Math.max(W, H));
          const res = await imaging.getPixels({
            documentID: d.id, colorSpace: "RGB", componentSize: 8,
            targetSize: { width: Math.max(1, Math.round(W * f)), height: Math.max(1, Math.round(H * f)) },
          });
          const id = res.imageData;
          const raw = to8bit(await id.getData({ chunky: true }), id.componentSize || 8);
          const n = id.width * id.height, comps = id.components;
          const data = new Uint8Array(n);
          for (let i = 0; i < n; i++) {
            const a = comps >= 4 ? raw[i * comps + 3] / 255 : 1;
            const lum = (0.299 * raw[i * comps] + 0.587 * raw[i * comps + 1] + 0.114 * raw[i * comps + 2]) * a + 255 * (1 - a);
            data[i] = 255 - Math.round(lum); // dunkel = trägt ab, transparent = bleibt
          }
          tex = { w: id.width, h: id.height, data };
          id.dispose();
        } finally {
          await d.closeWithoutSaving();
          if (prevDoc) { try { app.activeDocument = prevDoc; } catch (e) { /* egal */ } }
        }
      }, { commandName: "MS Distress Textur importieren" });
      if (!tex) continue;
      const id = "img:" + Date.now().toString(36) + Math.floor(Math.random() * 1e5).toString(36);
      const fileName = id.slice(4) + ".bin";
      const fe = await folder.createFile(fileName, { overwrite: true });
      await fe.write(tex.data.buffer, { format: uxpStorage.formats.binary });
      const t = { id, name: file.name.replace(/\.[^.]+$/, ""), w: tex.w, h: tex.h, file: fileName, data: tex.data };
      imageTextures.push(t);
      added.push(t);
    }
    await saveTextureIndex();
  } catch (e) {
    setStatus("Import fehlgeschlagen: " + (e.message || e), true);
  }
  busy = false;
  if (added.length) {
    params.texture = added[added.length - 1].id;
    buildTextureGrid(); buildTexture2Select(); syncUI(); changed();
    setStatus(`${added.length} Bild-Textur(en) hinzugefügt.`);
  }
}

async function deleteImageTexture(id) {
  const t = imageTextures.find((x) => x.id === id);
  if (!t) return;
  imageTextures = imageTextures.filter((x) => x.id !== id);
  try { await (await (await texFolder()).getEntry(t.file)).delete(); } catch (e) { /* egal */ }
  await saveTextureIndex();
  if (params.texture === id) params.texture = "grunge";
  if (params.texture2 === id) params.texture2 = "";
  buildTextureGrid(); buildTexture2Select(); syncUI(); changed();
  setStatus(`Textur „${t.name}“ gelöscht.`);
}

// ---------------------------------------------------------------- Anwenden / Entfernen

async function applyToLayer(doc, layer, p) {
  if (layer.isBackgroundLayer) throw new Error("Hintergrundebene – bitte erst in normale Ebene umwandeln");
  if (layer.allLocked) throw new Error("Ebene ist gesperrt");
  const b = layerBounds(layer, doc);
  if (b.right - b.left <= 0 || b.bottom - b.top <= 0) throw new Error("Ebene ist leer");

  await selectLayer(layer.id);
  const hadMask = await hasUserMask(layer.id);
  if (hadMask && await maskEnabled(layer.id)) await setMaskEnabled(layer.id, false);
  const res = await imaging.getPixels({ documentID: doc.id, layerID: layer.id, sourceBounds: b, colorSpace: "RGB", componentSize: 8 });
  if (hadMask) await setMaskEnabled(layer.id, true);
  const id = res.imageData;
  const w = id.width, h = id.height, comps = id.components;
  const raw = to8bit(await id.getData({ chunky: true }), id.componentSize || 8);
  const alpha = extractAlpha(raw, comps, w * h);
  id.dispose();
  const sb = res.sourceBounds || b;

  const { sampler, cdf } = Core.buildPipeline(p, sb, texData(p.texture), texData(p.texture2));
  const out = Core.computeMask({
    alpha, width: w, height: h, originX: sb.left, originY: sb.top, pxScale: 1,
    bounds: sb, params: p, sampler, cdf, wantColor: p.colorEnabled,
  });

  if (!hadMask) {
    await batchPlay([{
      _obj: "make", new: { _class: "channel" },
      at: { _ref: "channel", _enum: "channel", _value: "mask" },
      using: { _enum: "userMaskEnabled", _value: "revealAll" },
    }], {});
  }
  const maskData = await imaging.createImageDataFromBuffer(fromBuf8(out.mask, doc), {
    width: w, height: h, components: 1, chunky: true, colorSpace: "Grayscale", colorProfile: "Gray Gamma 2.2",
  });
  try {
    await imaging.putLayerMask({
      documentID: doc.id, layerID: layer.id, imageData: maskData,
      targetBounds: { left: sb.left, top: sb.top }, replace: false,
    });
  } finally {
    maskData.dispose();
  }

  // Shape Color: separate Ebene direkt über der Ebene, damit sie frei editierbar bleibt
  const colorName = layer.name + COLOR_SUFFIX;
  const oldColor = allLayers(doc.layers).filter((l) => l.name === colorName);
  for (const old of oldColor) await old.delete();
  let removed = 0, opaque = 0;
  for (let i = 0; i < w * h; i++) if (alpha[i] > 0) { opaque++; if (out.mask[i] < 128) removed++; }
  log("  Ebene", { name: layer.name, id: layer.id, bounds: sb, hadMask, abgetragenProzent: opaque ? Math.round(removed / opaque * 100) : 0,
    alteFarbebenenGeloescht: oldColor.length, neueFarbebene: !!(p.colorEnabled && out.color) });
  lastApplied.set(doc.id + ":" + layer.id, effectiveParams(p));
  if (p.colorEnabled && out.color) {
    await selectLayer(layer.id);
    await batchPlay([{ _obj: "make", _target: [{ _ref: "layer" }], using: { _obj: "layer", name: colorName } }], {});
    const colorLayer = doc.activeLayers[0];
    const c = hexToRgb(p.color);
    const buf = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      buf[i * 4] = c.r; buf[i * 4 + 1] = c.g; buf[i * 4 + 2] = c.b; buf[i * 4 + 3] = out.color[i];
    }
    const cd = await imaging.createImageDataFromBuffer(fromBuf8(buf, doc), {
      width: w, height: h, components: 4, chunky: true, colorSpace: "RGB", colorProfile: "sRGB IEC61966-2.1",
    });
    try {
      await imaging.putPixels({ documentID: doc.id, layerID: colorLayer.id, imageData: cd, targetBounds: { left: sb.left, top: sb.top } });
    } finally {
      cd.dispose();
    }
  }
}

// Live-Modus: letzter eigener Protokollschritt, damit Folge-Updates ihn ersetzen statt neue Schritte anzuhängen
let liveLast = null;     // { docId, stateId, ids }
let livePending = false;

function historyStateId(doc) {
  try { return doc.activeHistoryState ? doc.activeHistoryState.id : null; } catch (e) { return null; }
}

async function applyDistress(live) {
  live = live === true;
  if (busy) { if (live) livePending = true; return; }
  const doc = app.activeDocument;
  if (!doc) return setStatus("Kein Dokument geöffnet.", true);
  const layers = doc.activeLayers.slice();
  if (!layers.length) return setStatus("Keine Ebene ausgewählt.", true);
  if (params.texture === "custom" && !customTex) return setStatus("Bitte zuerst eine Textur-Ebene wählen.", true);
  busy = true;
  setStatus(live ? "Live-Update…" : `Wende an auf ${layers.length} Ebene(n)…`);
  const ids = layers.map((l) => l.id);
  const errors = [];
  let ok = 0;
  const t0 = Date.now();
  // Ist der aktuelle Protokollschritt unser letztes Live-Update auf denselben Ebenen? Dann ersetzen.
  const replaceLast = live && liveLast && liveLast.docId === doc.id &&
    liveLast.stateId !== null && liveLast.stateId === historyStateId(doc) &&
    liveLast.ids.join(",") === ids.join(",");
  log(live ? "LIVE" : "ANWENDEN", { ebenen: layers.map((l) => l.name), ersetztLetztenSchritt: !!replaceLast,
    protokollVorher: historyStateId(doc), params: effectiveParams(params) });
  try {
    await core.executeAsModal(async (ctx) => {
      if (replaceLast) {
        await batchPlay([{ _obj: "select", _target: [{ _ref: "historyState", _enum: "ordinal", _value: "previous" }] }], {});
      }
      const hid = await ctx.hostControl.suspendHistory({ documentID: doc.id, name: live ? "MS Distress Live" : "MS Distress" });
      try {
        for (let i = 0; i < layers.length; i++) {
          if (ctx.reportProgress) ctx.reportProgress({ value: i / layers.length, commandName: `MS Distress: ${layers[i].name}` });
          try { await applyToLayer(doc, layers[i], paramsFor(i)); ok++; }
          catch (e) { errors.push(`${layers[i].name}: ${e.message || e}`); }
        }
        await selectLayers(ids);
      } finally {
        await ctx.hostControl.resumeHistory(hid);
      }
    }, { commandName: "MS Distress anwenden" });
  } catch (e) {
    errors.push(e.message || String(e));
  }
  liveLast = live && ok > 0 ? { docId: doc.id, stateId: historyStateId(doc), ids } : null;
  log("  Ergebnis", { ok, fehler: errors, protokollNachher: historyStateId(doc), ms: Date.now() - t0 });
  ignoreEventsUntil = Date.now() + 600; // eigene Änderungen lösen keine Vorschau-Neuladung aus
  busy = false;
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (errors.length) setStatus(`${ok} ok, ${errors.length} Fehler – ${errors.join(" | ")}`, true);
  else if (live) setStatus(`Live: ${ok} Ebene(n) aktualisiert (${secs}s).`);
  else setStatus(`Fertig: ${ok} Ebene(n) in ${secs}s. Rückgängig mit ⌘Z.`);
  if (livePending && $("liveCanvas").checked) {
    livePending = false;
    applyDistress(true);
  }
}

const debouncedLive = debounce(() => applyDistress(true), 220);

async function removeDistress() {
  if (busy) return;
  const doc = app.activeDocument;
  if (!doc || !doc.activeLayers.length) return setStatus("Keine Ebene ausgewählt.", true);
  const layers = doc.activeLayers.slice();
  const ids = layers.map((l) => l.id);
  busy = true;
  try {
    await core.executeAsModal(async (ctx) => {
      const hid = await ctx.hostControl.suspendHistory({ documentID: doc.id, name: "MS Distress entfernen" });
      try {
        for (const layer of layers) {
          const colorName = layer.name + COLOR_SUFFIX;
          for (const old of allLayers(doc.layers).filter((l) => l.name === colorName)) await old.delete();
          if (await hasUserMask(layer.id)) {
            await selectLayer(layer.id);
            await batchPlay([{ _obj: "delete", _target: [{ _ref: "channel", _enum: "channel", _value: "mask" }] }], {});
          }
        }
        await selectLayers(ids);
      } finally {
        await ctx.hostControl.resumeHistory(hid);
      }
    }, { commandName: "MS Distress entfernen" });
    for (const id of ids) lastApplied.delete(doc.id + ":" + id);
    log("ENTFERNEN", { ebenen: layers.map((l) => l.name) });
    setStatus("Maske(n) und Farb-Ebenen entfernt.");
  } catch (e) {
    setStatus("Fehler beim Entfernen: " + (e.message || e), true);
  }
  busy = false;
}

// ---------------------------------------------------------------- Start

let ignoreEventsUntil = 0;
const onPsEvent = debounce(() => {
  if (busy || Date.now() < ignoreEventsUntil) return;
  refreshPreviewSource();
  if (params.texture === "custom") refreshCustomLayers();
}, 350);

async function init() {
  log("START", { version: require("uxp").versions && require("uxp").versions.plugin, ps: app.version });
  await loadImageTextures();
  if (String(params.texture).startsWith("img:") && !texData(params.texture)) params.texture = "grunge";
  if (String(params.texture2).startsWith("img:") && !texData(params.texture2)) params.texture2 = "";
  buildSliders();
  buildSelects();
  buildTextureGrid();
  bindControls();
  syncUI();
  try {
    action.addNotificationListener(["select", "make", "delete", "open", "close", "set", "move", "transform", "placedLayerEditContents"], onPsEvent);
  } catch (e) { console.log("Event-Listener nicht verfügbar", e); }
  refreshPreviewSource();
  if (params.texture === "custom") refreshCustomLayers();
}

init();
