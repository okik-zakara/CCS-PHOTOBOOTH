/* ==========================================================
   Web Photobooth
   - Live preview from any camera the browser sees as a webcam
     (USB webcam, camera webcam utility, HDMI capture card).
   - Filters: shown live on the preview, and applied to the photo
     strip. Raw photos are kept, so you can change the filter
     after the shots are taken.
   - Optional: set CONFIG.bridgeUrl to pull full-res stills from
     a local gphoto2 / digiCamControl helper (see captureFrame()).
   ========================================================== */

const CONFIG = {
  // Set to e.g. "http://localhost:3000" when you add a local camera bridge.
  // The bridge must answer POST /capture with a JPEG image.
  bridgeUrl: null,

  pauseBetweenShotsMs: 1500,

  // Text and colours shared by every layout (sizes live in LAYOUTS below)
  strip: {
    background: "#ffffff",
    captionColor: "#263238",
    dateColor: "#78909c",
    caption: "#photobooth",
    showDate: true,
    barColors: ["#F7CAC9", "#92A8D1"],  // Pantone 2016: Rose Quartz to Serenity
  },
};

/* ---------- filters ----------
   A filter is a colour grade, like the Instagram ones. It has up to three parts:
     ops      = [operation, value] steps: brightness, contrast, saturate,
                sepia, grayscale, hue-rotate. They map 1:1 to CSS filters.
     layers   = up to 2 colour washes blended over the photo. mode is a CSS
                blend mode: "screen" lifts the blacks and adds haze,
                "soft-light" and "overlay" tint the midtones, "multiply"
                darkens. alpha is how strong the wash is (0 to 1).
     vignette = optional dark edges (0 to 1).
   The same definition drives the live preview, the thumbnails, the editor
   and the saved strip. Add your own by adding an entry. */
const FILTERS = [
  { id: "original", name: "Original", ops: [] },

  // Washed-out, warm, bright and hazy: the nostalgic mid-2010s Tumblr look.
  { id: "rio", name: "Rio de Janeiro",
    ops: [["sepia", 0.25], ["saturate", 1.35], ["contrast", 0.85], ["brightness", 1.12]],
    layers: [
      { mode: "screen",     color: "#ffc9a0", alpha: 0.3 },     // milky haze, lifts the blacks
      { mode: "soft-light", color: "#ffd6a5", alpha: 0.45 },    // warm glow in the midtones
    ] },

  // Indigo -> magenta -> burnt orange gradient laid over the photo.
  { id: "twilight", name: "Twilight",
    ops: [["saturate", 1.2], ["contrast", 1.05]],
    layers: [
      { mode: "soft-light", alpha: 0.85, angle: 154,
        stops: [[0, "#3f428f"], [0.25, "#602d7c"], [0.5, "#7d2968"], [0.75, "#97344d"], [1, "#a64c2e"]] },
      { mode: "overlay", alpha: 0.35, angle: 154,
        stops: [[0, "#3f428f"], [0.5, "#7d2968"], [1, "#a64c2e"]] },
    ], vignette: 0.2 },

  { id: "rose", name: "Rose Quartz",
    ops: [["sepia", 0.15], ["saturate", 1.25], ["contrast", 0.95], ["brightness", 1.08]],
    layers: [
      { mode: "screen",     color: "#F7CAC9", alpha: 0.33 },
      { mode: "soft-light", color: "#ff6f9c", alpha: 0.4 },
    ] },

  { id: "serenity", name: "Serenity",
    ops: [["sepia", 0.05], ["saturate", 1.1], ["contrast", 0.95], ["brightness", 1.07]],
    layers: [
      { mode: "screen",     color: "#92A8D1", alpha: 0.33 },
      { mode: "soft-light", color: "#4f7be0", alpha: 0.4 },
    ] },

  { id: "sunset", name: "Sunset",
    ops: [["sepia", 0.3], ["saturate", 1.6], ["contrast", 1.12], ["brightness", 1.04]],
    layers: [
      { mode: "soft-light", color: "#ff6a2e", alpha: 0.6 },
      { mode: "screen",     color: "#ff9966", alpha: 0.12 },
    ],
    vignette: 0.22 },

  // bold and punchy, a little like Clarendon
  { id: "pop", name: "Pop",
    ops: [["saturate", 1.65], ["contrast", 1.28], ["brightness", 1.05]],
    layers: [{ mode: "overlay", color: "#6ec1ff", alpha: 0.18 }],
    vignette: 0.15 },

  { id: "faded", name: "Faded",
    ops: [["contrast", 0.8], ["brightness", 1.12], ["saturate", 0.65]],
    layers: [{ mode: "screen", color: "#dfe6f2", alpha: 0.22 }] },

  { id: "throwback", name: "Throwback",
    ops: [["sepia", 0.55], ["contrast", 1.15], ["saturate", 1.25]],
    layers: [
      { mode: "multiply", color: "#d9b88f", alpha: 0.3 },
      { mode: "screen",   color: "#ffe0b0", alpha: 0.12 },
    ],
    vignette: 0.4 },

  { id: "noir", name: "Noir",
    ops: [["grayscale", 1], ["contrast", 1.45], ["brightness", 0.92]],
    vignette: 0.45 },
];

const toCss = (ops) =>
  ops.length
    ? ops.map(([n, v]) => `${n}(${v}${n === "hue-rotate" ? "deg" : ""})`).join(" ")
    : "none";

/* ---------- layouts ----------
   Each layout describes ONE strip: a grid of cols x rows photos.
     sets   = how many different strips are on the sheet. Each set is its
              own round of photos, so sets: 2 means two rounds.
     copies = how many times each strip is printed (same photos repeated).
   Sizes are output pixels. Add your own by adding an entry. */
const stripBase = {
  cols: 1, aspect: 4 / 3, cellW: 540, pad: 30, gap: 16, footer: 124,
  style: "strip", sets: 1, copies: 1,
};

const LAYOUTS = [
  { ...stripBase, id: "classic4", group: "Strips", name: "Classic 4", desc: "4 photos in a column", rows: 4 },
  { ...stripBase, id: "classic3", group: "Strips", name: "Classic 3", desc: "3 photos in a column", rows: 3 },
  { ...stripBase, id: "duo", group: "Strips", name: "Duo", desc: "2 square photos", rows: 2, aspect: 1 },
  { ...stripBase, id: "film", group: "Strips", name: "Filmstrip", desc: "4 portrait photos in a row",
    cols: 4, rows: 1, aspect: 3 / 4, cellW: 300, pad: 34, padTop: 68, gap: 14, footer: 150, style: "film" },

  { ...stripBase, id: "polaroid", group: "Cards", name: "Polaroid", desc: "1 big photo with a caption",
    rows: 1, aspect: 1, cellW: 560, pad: 40, gap: 0, footer: 180, style: "polaroid" },
  { ...stripBase, id: "grid", group: "Cards", name: "Grid 4", desc: "4 photos in a 2 by 2 grid",
    cols: 2, rows: 2, aspect: 1, cellW: 380, pad: 36, footer: 130 },

  { ...stripBase, id: "double4", group: "Two strips on one sheet", name: "Double 4",
    desc: "2 sets of 4 photos, side by side", rows: 4, sets: 2 },
  { ...stripBase, id: "double3", group: "Two strips on one sheet", name: "Double 3",
    desc: "2 sets of 3 photos, side by side", rows: 3, sets: 2 },
  { ...stripBase, id: "twin4", group: "Two strips on one sheet", name: "Twin 4",
    desc: "1 set of 4, printed twice", rows: 4, copies: 2 },

  /* Canva designs: each one is a transparent PNG frame laid over the photos.
     frame.slots are the photo windows in frame pixels, [x, y, w, h], photo 1
     first. FRAME_SCALE (below) sets how big the frame is on the sheet. To add
     another, export a strip from Canva, cut the photo windows out, drop the PNG
     in frames/ and add an entry like these. */
  { ...stripBase, id: "cv-lilac-haze", group: "Canva designs", name: "Lilac Haze", desc: "4 photos in a Canva frame",
    rows: 4, aspect: 1.3904, style: "frame",
    frame: { src: "frames/lilac-haze.png", w: 454, h: 1315, slots: [[20,20,414,298],[20,324,414,298],[20,628,414,298],[20,933,414,297]] } },
  { ...stripBase, id: "cv-pink-glitter", group: "Canva designs", name: "Pink Glitter", desc: "4 photos in a Canva frame",
    rows: 4, aspect: 1.3904, style: "frame",
    frame: { src: "frames/pink-glitter.png", w: 455, h: 1316, slots: [[19,20,414,298],[19,324,414,298],[19,628,414,298],[19,933,414,297]] } },
  { ...stripBase, id: "cv-clean-white", group: "Canva designs", name: "Clean White", desc: "4 photos in a Canva frame",
    rows: 4, aspect: 1.3904, style: "frame",
    frame: { src: "frames/clean-white.png", w: 454, h: 1315, slots: [[20,20,414,298],[20,324,414,298],[20,628,414,298],[20,933,414,297]] } },
  { ...stripBase, id: "cv-sunset-waves", group: "Canva designs", name: "Sunset Waves", desc: "4 photos in a Canva frame",
    rows: 4, aspect: 1.4034, style: "frame",
    frame: { src: "frames/sunset-waves.png", w: 454, h: 1316, slots: [[19,20,415,292],[19,320,415,299],[19,626,415,299],[19,932,415,293]] } },
  { ...stripBase, id: "cv-neon-leopard", group: "Canva designs", name: "Neon Leopard", desc: "4 photos in a Canva frame",
    rows: 4, aspect: 1.3950, style: "frame",
    frame: { src: "frames/neon-leopard.png", w: 455, h: 1316, slots: [[20,24,415,298],[20,330,415,296],[19,633,415,298],[20,937,415,298]] } },
  { ...stripBase, id: "cv-galaxy", group: "Canva designs", name: "Galaxy", desc: "4 photos in a Canva frame",
    rows: 4, aspect: 1.3936, style: "frame",
    frame: { src: "frames/galaxy.png", w: 455, h: 1316, slots: [[19,24,416,298],[19,328,416,298],[19,632,415,299],[19,936,417,299]] } },
  { ...stripBase, id: "cv-candy-stripes", group: "Canva designs", name: "Candy Stripes", desc: "4 photos in a Canva frame",
    rows: 4, aspect: 1.3720, style: "frame",
    frame: { src: "frames/candy-stripes.png", w: 455, h: 1316, slots: [[20,24,415,298],[20,330,415,304],[19,639,415,304],[19,950,415,304]] } },
  { ...stripBase, id: "cv-crimson", group: "Canva designs", name: "Crimson", desc: "4 photos in a Canva frame",
    rows: 4, aspect: 1.3904, style: "frame",
    frame: { src: "frames/crimson.png", w: 455, h: 1315, slots: [[20,20,414,298],[20,324,414,298],[20,628,414,298],[20,933,414,297]] } },
  { ...stripBase, id: "cv-navy", group: "Canva designs", name: "Navy", desc: "4 photos in a Canva frame",
    rows: 4, aspect: 1.3891, style: "frame",
    frame: { src: "frames/navy.png", w: 455, h: 1315, slots: [[21,24,413,297],[21,328,413,298],[21,632,414,298],[21,937,413,297]] } },
];

/* ---------- element references ---------- */
const $ = (id) => document.getElementById(id);

const video         = $("video");
const viewfinder    = $("viewfinder");
const placeholder   = $("placeholder");
const countdownEl   = $("countdown");
const shotBadge     = $("shotBadge");
const flashEl       = $("flash");
const statusEl      = $("status");

const menuBtn       = $("menuBtn");
const closeBtn      = $("closeBtn");
const drawer        = $("drawer");
const scrim         = $("scrim");
const cameraSelect  = $("cameraSelect");
const resSelect     = $("resSelect");
const mirrorToggle  = $("mirrorToggle");
const startBtn      = $("startBtn");

const filterRail    = $("filterRail");
const layoutBtn     = $("layoutBtn");
const layoutName    = $("layoutName");
const picker        = $("picker");
const pickerGroups  = $("pickerGroups");
const pickerBack    = $("pickerBack");
const pickerNote    = $("pickerNote");
const timerSeg      = $("timerSeg");
const captureBtn    = $("captureBtn");

const stripPreview  = $("stripPreview");
const downloadBtn   = $("downloadBtn");
const printBtn      = $("printBtn");
const resetBtn      = $("resetBtn");

const captureCanvas = $("captureCanvas");
const stripCanvas   = $("stripCanvas");

// edit mode
const stage         = document.querySelector(".stage");
const editor        = $("editor");
const photoCanvas   = $("photoCanvas");
const overlayCanvas = $("overlayCanvas");
const photoTabs     = $("photoTabs");
const filterSlot    = $("filterSlot");
const toolSeg       = $("toolSeg");
const emojiGrid     = $("emojiGrid");
const textInput     = $("textInput");
const addTextBtn    = $("addTextBtn");
const textSwatches  = $("textSwatches");
const penSwatches   = $("penSwatches");
const undoBtn       = $("undoBtn");
const clearBtn      = $("clearBtn");
const panelFilters  = $("panelFilters");
const retakeBtn     = $("retakeBtn");
const doneBtn       = $("doneBtn");
const editBtn       = $("editBtn");

/* ---------- sticker set ----------
   Add or swap emoji here. Colours are used for text and the pen. */
const STICKERS = [
  "😎", "😍", "😂", "🤪", "🥰", "😘", "🤩", "😇", "🤓", "✌️",
  "🤙", "👍", "🙌", "💖", "💕", "✨", "⭐", "💫", "🔥", "💯",
  "🎉", "🎈", "🎀", "🌸", "🌈", "🦄", "🐶", "🐱", "🌴", "🍕",
  "🍦", "🍩", "👑", "🕶️", "👓", "🎩", "👻", "💋", "📸", "🎧",
];
const SWATCHES = ["#ffffff", "#263238", "#ff4081", "#ffd740", "#40c4ff", "#69f0ae"];

/* ---------- state ---------- */
let stream = null;
let busy = false;
let stripDataUrl = null;
let lastShots = null;      // raw (unfiltered) photos from the last session
let layout = LAYOUTS[0];   // the chosen strip layout
let view = "layout";       // "layout" (the picker) or "booth"
let hasChosen = false;
let sessionShots = [];     // photos taken so far (one round at a time for multi-set layouts)
let round = 0;             // finished rounds in the current session
let timerSeconds = 3;
let filterId = "original";

const currentFilter = () => FILTERS.find((f) => f.id === filterId) || FILTERS[0];

/* ---------- helpers ---------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle("error", isError);
}

function applyMirror() {
  const on = mirrorToggle.checked;
  video.classList.toggle("mirrored", on);
  filterRail.querySelectorAll("video").forEach((v) => v.classList.toggle("mirrored", on));
}

// Mirrors a filter's colour washes and vignette on a live <video> using CSS.
// root holds the .fx1, .fx2 and .fxv overlay elements (see index.html).
/* A layer is a solid colour or a linear gradient (angle in CSS degrees + stops). */
function layerCss(l) {
  if (!l.stops) return l.color;
  return `linear-gradient(${l.angle ?? 180}deg, ${l.stops.map(([t, c]) => `${c} ${t * 100}%`).join(", ")})`;
}
function layerCanvasPaint(ctx, l, x, y, w, h) {
  if (!l.stops) return l.color;
  const a = ((l.angle ?? 180) * Math.PI) / 180;
  const dx = Math.sin(a), dy = -Math.cos(a);
  const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2;   // CSS gradient-line length / 2
  const cx = x + w / 2, cy = y + h / 2;
  const g = ctx.createLinearGradient(cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half);
  l.stops.forEach(([t, c]) => g.addColorStop(t, c));
  return g;
}

function applyFx(root, f) {
  const layers = f.layers || [];
  [".fx1", ".fx2"].forEach((sel, i) => {
    const el = root.querySelector(sel);
    if (!el) return;
    const l = layers[i];
    el.style.display = l ? "" : "none";
    if (l) {
      el.style.background = layerCss(l);
      el.style.mixBlendMode = l.mode;
      el.style.opacity = l.alpha;
    }
  });
  const v = root.querySelector(".fxv");
  if (v) {
    v.style.display = f.vignette ? "" : "none";
    if (f.vignette) {
      v.style.background = `radial-gradient(ellipse at center, transparent 55%, rgba(0, 0, 0, ${f.vignette}) 100%)`;
    }
  }
}

/* ---------- filter picker ---------- */
function buildFilterRail() {
  FILTERS.forEach((f) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "filter";
    btn.dataset.id = f.id;
    btn.setAttribute("role", "radio");
    btn.setAttribute("aria-checked", String(f.id === filterId));
    btn.innerHTML =
      '<span class="thumb"><span class="disc"><video muted playsinline autoplay></video>' +
      '<span class="fx fx1"></span><span class="fx fx2"></span><span class="fx fxv"></span></span></span>' +
      `<span class="name">${f.name}</span>`;
    btn.querySelector("video").style.filter = toCss(f.ops);
    applyFx(btn.querySelector(".disc"), f);
    btn.addEventListener("click", () => selectFilter(f.id));
    filterRail.appendChild(btn);
  });
}

function selectFilter(id) {
  filterId = id;
  filterRail.querySelectorAll(".filter").forEach((b) =>
    b.setAttribute("aria-checked", String(b.dataset.id === id))
  );
  video.style.filter = toCss(currentFilter().ops);
  applyFx(viewfinder, currentFilter());

  // Editing? Redraw the photo you're working on with the new filter.
  if (mode === "edit") renderEditorPhoto();

  // Already took photos? Re-render the strip with the new filter.
  if (!busy) refreshStrip();
}

function stepFilter(dir) {
  const i = FILTERS.findIndex((f) => f.id === filterId);
  selectFilter(FILTERS[(i + dir + FILTERS.length) % FILTERS.length].id);
}

/* ---------- segmented controls ---------- */
function setupSegmented(el, onChange) {
  el.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || b.disabled) return;
    el.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    onChange(b.dataset.value);
  });
}

/* ---------- camera ---------- */
function attachStreamToThumbs(s) {
  filterRail.querySelectorAll("video").forEach((v) => {
    v.srcObject = s;
    if (s) v.play().catch(() => {});
  });
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("This browser can't access cameras. Use Chrome, Edge or Firefox on localhost or HTTPS.", true);
    return;
  }

  stopCamera();

  const [w, h] = resSelect.value.split("x").map(Number);
  const deviceId = cameraSelect.value;

  const constraints = {
    audio: false,
    video: {
      width:  { ideal: w },
      height: { ideal: h },
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    },
  };

  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = stream;
    await video.play();
    attachStreamToThumbs(stream);

    placeholder.classList.add("hidden");
    captureBtn.disabled = false;
    applyMirror();

    await populateCameras();

    const s = stream.getVideoTracks()[0].getSettings();
    setStatus(`Camera ready at ${s.width}×${s.height}. Pick a filter, then press the shutter or Space.`);
  } catch (err) {
    console.error(err);
    placeholder.classList.remove("hidden");
    const messages = {
      NotAllowedError: "Camera permission was blocked. Allow it in the address bar and try again.",
      NotFoundError: "No camera found. Check the USB cable or webcam utility.",
      NotReadableError: "Another app is using the camera. Close it and try again.",
      OverconstrainedError: "This camera doesn't support that resolution. Try 720p in Settings.",
    };
    setStatus(messages[err.name] || `Could not start the camera: ${err.message}`, true);
  }
}

function stopCamera() {
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  video.srcObject = null;
  attachStreamToThumbs(null);
  captureBtn.disabled = true;
}

async function populateCameras() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const cams = devices.filter((d) => d.kind === "videoinput");
  const currentId = stream?.getVideoTracks()[0]?.getSettings().deviceId;

  cameraSelect.innerHTML = "";
  cams.forEach((cam, i) => {
    const opt = document.createElement("option");
    opt.value = cam.deviceId;
    opt.textContent = cam.label || `Camera ${i + 1}`;
    if (cam.deviceId === currentId) opt.selected = true;
    cameraSelect.appendChild(opt);
  });
}

/* ---------- capture ----------
   Photos are stored raw (mirrored if the mirror switch is on). The filter
   is applied when the strip is drawn, so it can be changed afterwards. */
async function captureFrame() {
  // Option A: full-resolution still from a local camera bridge (gphoto2 etc.)
  if (CONFIG.bridgeUrl) {
    const res = await fetch(`${CONFIG.bridgeUrl}/capture`, { method: "POST" });
    if (!res.ok) throw new Error(`Bridge returned ${res.status}`);
    const blob = await res.blob();
    return await createImageBitmap(blob);
  }

  // Option B: grab the current video frame
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) throw new Error("The video isn't ready yet.");

  captureCanvas.width = w;
  captureCanvas.height = h;
  const ctx = captureCanvas.getContext("2d");

  ctx.save();
  if (mirrorToggle.checked) {
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, 0, 0, w, h);
  ctx.restore();

  return await createImageBitmap(captureCanvas);
}

async function runCountdown(seconds) {
  countdownEl.classList.remove("hidden");
  for (let i = seconds; i >= 1; i--) {
    countdownEl.textContent = i;
    countdownEl.classList.remove("pop");
    void countdownEl.offsetWidth; // restart animation
    countdownEl.classList.add("pop");
    await sleep(1000);
  }
  countdownEl.classList.add("hidden");
}

function doFlash() {
  flashEl.classList.remove("go");
  void flashEl.offsetWidth;
  flashEl.classList.add("go");
}

async function startSession() {
  if (busy || !stream || view !== "booth") return;
  busy = true;

  // A finished strip is on screen: taking photos again starts a new one.
  if (lastShots) {
    lastShots = null;
    sessionShots = [];
    round = 0;
    edits = [];
    clearStrip();
  }

  captureBtn.disabled = true;
  layoutBtn.disabled = true;
  [downloadBtn, printBtn, resetBtn, editBtn].forEach((b) => (b.disabled = true));

  const per = layout.cols * layout.rows;
  const shots = [];

  try {
    for (let i = 1; i <= per; i++) {
      shotBadge.textContent = layout.sets > 1
        ? `Set ${round + 1} of ${layout.sets}: photo ${i} of ${per}`
        : `Photo ${i} of ${per}`;
      shotBadge.classList.remove("hidden");
      setStatus("Get ready…");

      await runCountdown(timerSeconds);
      doFlash();
      shots.push(await captureFrame());

      if (i < per) await sleep(CONFIG.pauseBetweenShotsMs);
    }

    shotBadge.classList.add("hidden");
    sessionShots = sessionShots.concat(shots);
    round++;

    if (round < layout.sets) {
      // More sets to go: show what we have so far and wait for the next press.
      buildStrip(sessionShots);
      setStatus(`Set ${round} done. Swap places, then press the shutter for set ${round + 1}.`);
    } else {
      lastShots = sessionShots;
      edits = lastShots.map(newEdit);
      buildStrip(lastShots);
      enterEdit(0);
    }
  } catch (err) {
    console.error(err);
    shotBadge.classList.add("hidden");
    countdownEl.classList.add("hidden");
    setStatus(`Capture failed: ${err.message}`, true);
  } finally {
    busy = false;
    captureBtn.disabled = !stream;
    layoutBtn.disabled = false;
    resetBtn.disabled = !(lastShots || sessionShots.length);
    editBtn.disabled = !lastShots;
  }
}

/* ---------- filter on canvas ----------
   Uses ctx.filter where the browser supports it (Chrome, Edge, Firefox).
   Where it doesn't (some Safari versions), the same filters are applied
   pixel by pixel. */
function supportsCanvasFilter() {
  try {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    const x = c.getContext("2d");
    x.filter = "grayscale(1)";
    x.fillStyle = "#ff0000";
    x.fillRect(0, 0, 1, 1);
    const d = x.getImageData(0, 0, 1, 1).data;
    return Math.abs(d[0] - d[1]) < 12;
  } catch (e) {
    return false;
  }
}
const CANVAS_FILTER = supportsCanvasFilter();

function opMatrix(name, v) {
  switch (name) {
    case "grayscale": {
      const a = 1 - Math.min(1, v);
      return [
        0.2126 + 0.7874 * a, 0.7152 - 0.7152 * a, 0.0722 - 0.0722 * a,
        0.2126 - 0.2126 * a, 0.7152 + 0.2848 * a, 0.0722 - 0.0722 * a,
        0.2126 - 0.2126 * a, 0.7152 - 0.7152 * a, 0.0722 + 0.9278 * a,
      ];
    }
    case "sepia": {
      const a = 1 - Math.min(1, v);
      return [
        0.393 + 0.607 * a, 0.769 - 0.769 * a, 0.189 - 0.189 * a,
        0.349 - 0.349 * a, 0.686 + 0.314 * a, 0.168 - 0.168 * a,
        0.272 - 0.272 * a, 0.534 - 0.534 * a, 0.131 + 0.869 * a,
      ];
    }
    case "saturate":
      return [
        0.213 + 0.787 * v, 0.715 - 0.715 * v, 0.072 - 0.072 * v,
        0.213 - 0.213 * v, 0.715 + 0.285 * v, 0.072 - 0.072 * v,
        0.213 - 0.213 * v, 0.715 - 0.715 * v, 0.072 + 0.928 * v,
      ];
    case "hue-rotate": {
      const r = (v * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
      return [
        0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928,
        0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.140, 0.072 - c * 0.072 - s * 0.283,
        0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072,
      ];
    }
    default:
      return null;
  }
}

function applyOpsToPixels(ctx, x, y, w, h, ops) {
  const img = ctx.getImageData(x, y, w, h);
  const d = img.data;
  const steps = ops.map(([n, v]) => ({ n, v, m: opMatrix(n, v) }));
  const clamp = (n) => (n < 0 ? 0 : n > 255 ? 255 : n);

  for (let i = 0; i < d.length; i += 4) {
    let r = d[i], g = d[i + 1], b = d[i + 2];
    for (const s of steps) {
      if (s.m) {
        const m = s.m;
        const nr = m[0] * r + m[1] * g + m[2] * b;
        const ng = m[3] * r + m[4] * g + m[5] * b;
        const nb = m[6] * r + m[7] * g + m[8] * b;
        r = nr; g = ng; b = nb;
      } else if (s.n === "brightness") {
        r *= s.v; g *= s.v; b *= s.v;
      } else if (s.n === "contrast") {
        r = (r - 127.5) * s.v + 127.5;
        g = (g - 127.5) * s.v + 127.5;
        b = (b - 127.5) * s.v + 127.5;
      }
      r = clamp(r); g = clamp(g); b = clamp(b);
    }
    d[i] = r; d[i + 1] = g; d[i + 2] = b;
  }
  ctx.putImageData(img, x, y);
}

/* ---------- strip builder ---------- */
function drawCover(ctx, img, x, y, w, h) {
  // Scale + center-crop the image to fill the w×h cell
  const scale = Math.max(w / img.width, h / img.height);
  const sw = w / scale;
  const sh = h / scale;
  const sx = (img.width - sw) / 2;
  const sy = (img.height - sh) / 2;
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

// Draws one photo into the w×h cell with filter f applied (see FILTERS).
function drawShot(ctx, img, x, y, w, h, f) {
  const ops = f.ops;
  if (!ops.length) {
    drawCover(ctx, img, x, y, w, h);
  } else if (CANVAS_FILTER) {
    ctx.filter = toCss(ops);
    drawCover(ctx, img, x, y, w, h);
    ctx.filter = "none";
  } else {
    drawCover(ctx, img, x, y, w, h);
    applyOpsToPixels(ctx, x, y, w, h, ops);
  }
  drawLayers(ctx, f, x, y, w, h);
}

// colour washes and vignette, blended over the photo already in the cell
function drawLayers(ctx, f, x, y, w, h) {
  if (!f.layers?.length && !f.vignette) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  for (const layer of f.layers || []) {
    ctx.globalCompositeOperation = layer.mode;
    ctx.globalAlpha = layer.alpha;
    ctx.fillStyle = layerCanvasPaint(ctx, layer, x, y, w, h);
    ctx.fillRect(x, y, w, h);
  }
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;

  if (f.vignette) {
    // same shape as the CSS radial-gradient used in the live preview
    ctx.translate(x + w / 2, y + h / 2);
    ctx.scale((w / 2) * Math.SQRT2, (h / 2) * Math.SQRT2);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, "rgba(0, 0, 0, 0)");
    g.addColorStop(0.55, "rgba(0, 0, 0, 0)");
    g.addColorStop(1, `rgba(0, 0, 0, ${f.vignette})`);
    ctx.fillStyle = g;
    ctx.fillRect(-1, -1, 2, 2);
  }
  ctx.restore();
}

/* ---------- sheet builder ----------
   A "sheet" is the whole printed image: one or more strips laid side by
   side, built from the layout's geometry. */
const FRAME_SCALE = 1.32;   // Canva frames are drawn this much bigger than the PNG

function geometry(L) {
  if (L.frame) {
    const panelW = Math.round(L.frame.w * FRAME_SCALE);
    const panelH = Math.round(L.frame.h * FRAME_SCALE);
    return {
      cellW: Math.round(L.frame.slots[0][2] * FRAME_SCALE),
      cellH: Math.round(L.frame.slots[0][3] * FRAME_SCALE),
      padTop: 0, panelW, panelH, panels: 1, margin: 0, between: 0,
      perPanel: L.frame.slots.length,
      kx: panelW / L.frame.w, ky: panelH / L.frame.h,
      width: panelW, height: panelH,
    };
  }
  const cellW = L.cellW;
  const cellH = Math.round(cellW / L.aspect);
  const padTop = L.padTop ?? L.pad;
  const panelW = L.pad * 2 + L.cols * cellW + (L.cols - 1) * L.gap;
  const panelH = padTop + L.rows * cellH + (L.rows - 1) * L.gap + L.footer;
  const panels = L.sets * L.copies;
  const margin = panels > 1 ? 36 : 0;     // white border round a multi-strip sheet
  const between = panels > 1 ? 48 : 0;    // room for the cut line
  return {
    cellW, cellH, padTop, panelW, panelH, panels, margin, between,
    perPanel: L.cols * L.rows,
    width: panels * panelW + (panels - 1) * between + margin * 2,
    height: panelH + margin * 2,
  };
}

const totalPhotos = (L) => L.cols * L.rows * L.sets;

function pathRound(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

const PLACEHOLDER_COLORS = [
  ["#F7CAC9", "#92A8D1"], ["#92A8D1", "#F7CAC9"], ["#f3d5d3", "#a3b8dc"], ["#e9bcc8", "#8aa0cc"],
];

// a stand-in "photo" for the layout previews
function drawPlaceholder(ctx, x, y, w, h, seed) {
  const [a, b] = PLACEHOLDER_COLORS[seed % PLACEHOLDER_COLORS.length];
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, a);
  g.addColorStop(1, b);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
  ctx.beginPath();
  ctx.arc(x + w / 2, y + h * 0.42, Math.min(w, h) * 0.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x + w / 2, y + h * 1.02, w * 0.3, h * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// an empty slot, for a sheet that is still waiting for its next set
function drawEmptySlot(ctx, L, x, y, w, h, n) {
  const film = L.style === "film";
  ctx.fillStyle = film ? "#2a2a2a" : "#eceff1";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = film ? "#555555" : "#b0bec5";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `200 ${Math.round(Math.min(w, h) * 0.3)}px Montserrat, "Helvetica Neue", Arial, sans-serif`;
  ctx.fillText(String(n), x + w / 2, y + h / 2);
  ctx.textBaseline = "alphabetic";
}

function drawSprockets(ctx, ox, y, w) {
  const pitch = 46, holeW = 24, holeH = 28;
  const n = Math.floor((w - 40) / pitch);
  const total = n * pitch - (pitch - holeW);
  const startX = ox + (w - total) / 2;
  ctx.fillStyle = "#f2f2f2";
  for (let i = 0; i < n; i++) {
    pathRound(ctx, startX + i * pitch, y, holeW, holeH, 5);
    ctx.fill();
  }
}

const FOOTER_TEXT = {
  strip:    { cap: 30, capY: 56, date: 17, dateY: 86 },
  polaroid: { cap: 46, capY: 82, date: 22, dateY: 124 },
  film:     { cap: 26, capY: 46, date: 16, dateY: 74 },
};

/* ---------- Canva frames ----------
   Photos go in the frame's windows first, then the frame PNG (transparent
   where the photos show) is laid over them. */
const frameImages = {};   // layout id -> loaded <img>
let framesTimer = null;

function loadFrames() {
  LAYOUTS.filter((l) => l.frame).forEach((L) => {
    const img = new Image();
    img.onload = () => {
      frameImages[L.id] = img;
      // redraw once, after the last of a burst of frames arrives
      clearTimeout(framesTimer);
      framesTimer = setTimeout(() => {
        drawPickerPreviews();
        if (!busy) refreshStrip();
        if (mode === "edit") renderEditorPhoto();
      }, 40);
    };
    img.onerror = () => console.warn(`Frame image not found: ${L.frame.src}`);
    img.src = L.frame.src;
  });
}

function drawFramePanel(ctx, L, g, ox, oy, setIdx, photos, f, preview) {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(ox, oy, g.panelW, g.panelH);

  L.frame.slots.forEach(([sx, sy, sw, sh], slot) => {
    const idx = setIdx * g.perPanel + slot;
    const x = ox + sx * g.kx, y = oy + sy * g.ky, w = sw * g.kx, h = sh * g.ky;
    if (preview) {
      drawPlaceholder(ctx, x, y, w, h, slot + setIdx);
    } else if (photos[idx]) {
      drawShot(ctx, photos[idx], x, y, w, h, f);
      drawEdits(ctx, edits[idx], x, y, w, h);
    } else {
      drawEmptySlot(ctx, L, x, y, w, h, idx + 1);
    }
  });

  const img = frameImages[L.id];
  if (img) ctx.drawImage(img, ox, oy, g.panelW, g.panelH);
}

function drawPanel(ctx, L, g, ox, oy, setIdx, photos, f, preview) {
  if (L.frame) return drawFramePanel(ctx, L, g, ox, oy, setIdx, photos, f, preview);

  const c = CONFIG.strip;
  const film = L.style === "film";

  ctx.fillStyle = film ? "#161616" : c.background;
  ctx.fillRect(ox, oy, g.panelW, g.panelH);

  for (let r = 0; r < L.rows; r++) {
    for (let col = 0; col < L.cols; col++) {
      const slot = r * L.cols + col;
      const idx = setIdx * g.perPanel + slot;
      const x = ox + L.pad + col * (g.cellW + L.gap);
      const y = oy + g.padTop + r * (g.cellH + L.gap);

      if (preview) {
        drawPlaceholder(ctx, x, y, g.cellW, g.cellH, slot + setIdx);
      } else if (photos[idx]) {
        drawShot(ctx, photos[idx], x, y, g.cellW, g.cellH, f);
        drawEdits(ctx, edits[idx], x, y, g.cellW, g.cellH);
      } else {
        drawEmptySlot(ctx, L, x, y, g.cellW, g.cellH, idx + 1);
      }
    }
  }

  // caption + date
  const t = FOOTER_TEXT[L.style];
  const footerTop = oy + g.panelH - L.footer;
  const cx = ox + g.panelW / 2;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = film ? "#f5f5f5" : c.captionColor;
  ctx.font = `600 ${t.cap}px Montserrat, "Helvetica Neue", Arial, sans-serif`;
  ctx.fillText(c.caption, cx, footerTop + t.capY);

  if (c.showDate) {
    ctx.fillStyle = film ? "#9e9e9e" : c.dateColor;
    ctx.font = `400 ${t.date}px Roboto, "Helvetica Neue", Arial, sans-serif`;
    ctx.fillText(
      new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }),
      cx,
      footerTop + t.dateY
    );
  }

  if (film) {
    drawSprockets(ctx, ox, oy + 20, g.panelW);
    drawSprockets(ctx, ox, oy + g.panelH - 48, g.panelW);
  } else {
    // Rose Quartz to Serenity bar along the bottom edge
    const bar = ctx.createLinearGradient(ox, 0, ox + g.panelW, 0);
    bar.addColorStop(0, c.barColors[0]);
    bar.addColorStop(1, c.barColors[1]);
    ctx.fillStyle = bar;
    ctx.fillRect(ox, oy + g.panelH - 12, g.panelW, 12);
  }
}

/* Draws the whole sheet for layout L.
   photos  = the shots taken so far (missing ones show as numbered empty slots)
   preview = draw stand-in photos instead, for the layout picker */
function renderSheet(L, photos, { canvas = document.createElement("canvas"), scale = 1, preview = false } = {}) {
  const g = geometry(L);
  canvas.width = Math.round(g.width * scale);
  canvas.height = Math.round(g.height * scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: !CANVAS_FILTER && !preview });

  ctx.save();
  ctx.scale(scale, scale);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, g.width, g.height);

  const f = currentFilter();
  for (let p = 0; p < g.panels; p++) {
    const ox = g.margin + p * (g.panelW + g.between);
    drawPanel(ctx, L, g, ox, g.margin, Math.floor(p / L.copies), photos, f, preview);

    if (p < g.panels - 1) {
      // dashed cut line between strips
      const lineX = ox + g.panelW + g.between / 2;
      ctx.save();
      ctx.setLineDash([10, 10]);
      ctx.strokeStyle = "#b0bec5";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(lineX, 0);
      ctx.lineTo(lineX, g.height);
      ctx.stroke();
      ctx.restore();
    }
  }
  ctx.restore();
  return canvas;
}

function buildStrip(shots) {
  const complete = shots.length >= totalPhotos(layout);
  renderSheet(layout, shots, { canvas: stripCanvas });
  const url = stripCanvas.toDataURL("image/jpeg", 0.92);

  stripPreview.innerHTML = "";
  const img = document.createElement("img");
  img.src = url;
  img.alt = complete ? "Your photo strip" : "Photo strip in progress";
  stripPreview.appendChild(img);

  stripDataUrl = complete ? url : null;
  downloadBtn.disabled = !complete;
  printBtn.disabled = !complete;
  editBtn.disabled = !complete;
  resetBtn.disabled = false;
}

// redraw the strip from whatever photos exist (used when the filter changes)
function refreshStrip() {
  const shots = lastShots || (sessionShots.length ? sessionShots : null);
  if (shots) buildStrip(shots);
}

/* ==========================================================
   Edit mode: stickers, text and doodles, per photo.
   Everything is drawn on canvas (editor and final strip use the
   same drawing code), and positions are stored as fractions of the
   photo so they carry over to the strip at any size.
   ========================================================== */
const EDIT_W = 1080;
let EDIT_H = Math.round(EDIT_W / layout.aspect);   // follows the layout's photo shape
const HANDLE_R = 30;
const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla", sans-serif';
const TEXT_FONT = 'Montserrat, "Helvetica Neue", Arial, sans-serif';

let mode = "camera";        // "camera" or "edit"
let edits = [];             // one { items, strokes } per photo
let editIndex = 0;
let tool = "stickers";
let selectedId = null;
let textColor = SWATCHES[0];
let penColor = SWATCHES[2];
let nextItemId = 1;
let drag = null;
let stripTimer = null;

photoCanvas.width = overlayCanvas.width = EDIT_W;
photoCanvas.height = overlayCanvas.height = EDIT_H;
const ctxPhoto = photoCanvas.getContext("2d", { willReadFrequently: !CANVAS_FILTER });
const ctxOverlay = overlayCanvas.getContext("2d");

// the camera view and editor take the photo shape of the chosen layout
function setEditAspect(a) {
  EDIT_H = Math.round(EDIT_W / a);
  photoCanvas.width = overlayCanvas.width = EDIT_W;
  photoCanvas.height = overlayCanvas.height = EDIT_H;
  document.documentElement.style.setProperty("--aspect", String(a));
}

const newEdit = () => ({ items: [], strokes: [] });
const currentEdit = () => edits[editIndex];
const selectedItem = () => currentEdit()?.items.find((it) => it.id === selectedId) || null;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/* ---- drawing (shared by the editor and the final strip) ---- */
function setItemFont(ctx, it, w) {
  const px = Math.round(it.size * w);
  ctx.font = it.type === "text" ? `700 ${px}px ${TEXT_FONT}` : `${px}px ${EMOJI_FONT}`;
  return px;
}

function drawItem(ctx, it, ox, oy, w, h) {
  ctx.save();
  ctx.translate(ox + it.x * w, oy + it.y * h);
  ctx.rotate(it.rot);
  const px = setItemFont(ctx, it, w);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0, 0, 0, 0.3)";
  ctx.shadowBlur = px * 0.12;
  ctx.shadowOffsetY = px * 0.04;
  ctx.fillStyle = it.type === "text" ? it.color : "#000";
  ctx.fillText(it.value, 0, 0);
  ctx.restore();
}

function drawStrokes(ctx, strokes, ox, oy, w, h) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const s of strokes) {
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineWidth = s.width * w;
    if (s.pts.length === 1) {
      ctx.beginPath();
      ctx.arc(ox + s.pts[0][0] * w, oy + s.pts[0][1] * h, (s.width * w) / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      s.pts.forEach(([x, y], i) => {
        if (i) ctx.lineTo(ox + x * w, oy + y * h);
        else ctx.moveTo(ox + x * w, oy + y * h);
      });
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawEdits(ctx, edit, ox, oy, w, h) {
  if (!edit) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(ox, oy, w, h);   // keep everything inside the photo
  ctx.clip();
  drawStrokes(ctx, edit.strokes, ox, oy, w, h);
  edit.items.forEach((it) => drawItem(ctx, it, ox, oy, w, h));
  ctx.restore();
}

/* ---- geometry for selecting / transforming ---- */
function itemBox(it) {
  ctxOverlay.save();
  const px = setItemFont(ctxOverlay, it, EDIT_W);
  const tw = ctxOverlay.measureText(it.value).width;
  ctxOverlay.restore();
  return { w: Math.max(tw, px * 0.6) + px * 0.2, h: px * 1.25 };
}

function toWorld(it, lx, ly) {
  const c = Math.cos(it.rot), s = Math.sin(it.rot);
  return { x: it.x * EDIT_W + lx * c - ly * s, y: it.y * EDIT_H + lx * s + ly * c };
}

function handlePositions(it) {
  const box = itemBox(it);
  return { box, del: toWorld(it, -box.w / 2, -box.h / 2), scale: toWorld(it, box.w / 2, box.h / 2) };
}

function hitItem(p) {
  const items = currentEdit().items;
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    const b = itemBox(it);
    const dx = p.x - it.x * EDIT_W, dy = p.y - it.y * EDIT_H;
    const c = Math.cos(-it.rot), s = Math.sin(-it.rot);
    const lx = dx * c - dy * s, ly = dx * s + dy * c;
    if (Math.abs(lx) <= b.w / 2 && Math.abs(ly) <= b.h / 2) return it;
  }
  return null;
}

/* ---- rendering the editor ---- */
function renderEditorPhoto() {
  const img = lastShots?.[editIndex];
  if (!img) return;
  ctxPhoto.clearRect(0, 0, EDIT_W, EDIT_H);
  drawShot(ctxPhoto, img, 0, 0, EDIT_W, EDIT_H, currentFilter());
}

function drawHandle(p, fill, kind) {
  const c = ctxOverlay;
  c.save();
  c.shadowColor = "rgba(0, 0, 0, 0.35)";
  c.shadowBlur = 8;
  c.fillStyle = fill;
  c.beginPath();
  c.arc(p.x, p.y, HANDLE_R, 0, Math.PI * 2);
  c.fill();
  c.shadowColor = "transparent";
  c.strokeStyle = kind === "x" ? "#263238" : "#ffffff";
  c.lineWidth = 5;
  c.lineCap = "round";
  const k = HANDLE_R * 0.38;
  c.beginPath();
  if (kind === "x") {
    c.moveTo(p.x - k, p.y - k); c.lineTo(p.x + k, p.y + k);
    c.moveTo(p.x + k, p.y - k); c.lineTo(p.x - k, p.y + k);
  } else {
    // double-headed diagonal arrow = resize and rotate
    c.moveTo(p.x - k, p.y - k); c.lineTo(p.x + k, p.y + k);
    c.moveTo(p.x + k, p.y + k); c.lineTo(p.x + k, p.y + k * 0.1);
    c.moveTo(p.x + k, p.y + k); c.lineTo(p.x + k * 0.1, p.y + k);
    c.moveTo(p.x - k, p.y - k); c.lineTo(p.x - k, p.y - k * 0.1);
    c.moveTo(p.x - k, p.y - k); c.lineTo(p.x - k * 0.1, p.y - k);
  }
  c.stroke();
  c.restore();
}

function renderOverlay() {
  ctxOverlay.clearRect(0, 0, EDIT_W, EDIT_H);
  const edit = currentEdit();
  if (!edit) return;
  drawEdits(ctxOverlay, edit, 0, 0, EDIT_W, EDIT_H);

  const it = selectedItem();
  if (!it || tool === "draw") return;
  const { box, del, scale } = handlePositions(it);

  ctxOverlay.save();
  ctxOverlay.translate(it.x * EDIT_W, it.y * EDIT_H);
  ctxOverlay.rotate(it.rot);
  ctxOverlay.setLineDash([12, 9]);
  ctxOverlay.lineWidth = 3;
  ctxOverlay.strokeStyle = "#ffffff";
  ctxOverlay.shadowColor = "rgba(0, 0, 0, 0.5)";
  ctxOverlay.shadowBlur = 5;
  ctxOverlay.strokeRect(-box.w / 2, -box.h / 2, box.w, box.h);
  ctxOverlay.restore();

  drawHandle(del, "#ffffff", "x");
  drawHandle(scale, "#ff4081", "arrow");
}

/* ---- changes ---- */
function commitEdit() {
  // keep the strip preview on the right up to date (debounced)
  clearTimeout(stripTimer);
  stripTimer = setTimeout(() => lastShots && buildStrip(lastShots), 120);
}

function addItem(props) {
  const it = {
    id: nextItemId++,
    x: 0.5 + (Math.random() - 0.5) * 0.2,
    y: 0.5 + (Math.random() - 0.5) * 0.2,
    rot: (Math.random() - 0.5) * 0.3,
    size: 0.18,
    ...props,
  };
  currentEdit().items.push(it);
  selectedId = it.id;
  renderOverlay();
  syncTextControls();
  commitEdit();
}

function removeItem(id) {
  const edit = currentEdit();
  edit.items = edit.items.filter((i) => i.id !== id);
  if (selectedId === id) selectedId = null;
  renderOverlay();
  commitEdit();
}

function syncTextControls() {
  const it = selectedItem();
  if (it && it.type === "text") {
    textInput.value = it.value;
    textColor = it.color;
    markSwatch(textSwatches, textColor);
  }
}

/* ---- tools, photo tabs, swatches ---- */
function setTool(t) {
  tool = t;
  editor.dataset.tool = t;
  document.querySelectorAll(".tool-panel").forEach((p) =>
    p.classList.toggle("hidden", p.dataset.panel !== t)
  );
  toolSeg.querySelectorAll("button").forEach((b) =>
    b.setAttribute("aria-pressed", String(b.dataset.value === t))
  );
  if (t === "draw") selectedId = null;
  renderOverlay();
}

function buildPhotoTabs() {
  photoTabs.innerHTML = "";
  lastShots.forEach((_, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = i + 1;
    b.dataset.index = i;
    if (layout.sets > 1 && i > 0 && i % (layout.cols * layout.rows) === 0) b.className = "set-start";
    b.setAttribute("aria-label", `Photo ${i + 1}`);
    b.addEventListener("click", () => selectPhoto(i));
    photoTabs.appendChild(b);
  });
  photoTabs.classList.toggle("hidden", lastShots.length < 2);
}

function selectPhoto(i) {
  editIndex = i;
  selectedId = null;
  drag = null;
  photoTabs.querySelectorAll("button").forEach((b) =>
    b.setAttribute("aria-pressed", String(Number(b.dataset.index) === i))
  );
  renderEditorPhoto();
  renderOverlay();
}

function markSwatch(el, color) {
  el.querySelectorAll(".swatch").forEach((b) =>
    b.setAttribute("aria-pressed", String(b.dataset.color === color))
  );
}

function buildSwatches(el, initial, onPick) {
  SWATCHES.forEach((c) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "swatch";
    b.style.background = c;
    b.dataset.color = c;
    b.setAttribute("aria-label", `Colour ${c}`);
    b.setAttribute("aria-pressed", String(c === initial));
    b.addEventListener("click", () => { onPick(c); markSwatch(el, c); });
    el.appendChild(b);
  });
}

function moveFilterRail(target) {
  target.appendChild(filterRail);
  filterRail.querySelectorAll("video").forEach((v) => v.play().catch(() => {}));
}

/* ---- entering and leaving ---- */
function enterEdit(i = 0) {
  if (!lastShots) return;
  mode = "edit";
  stage.classList.add("editing");
  moveFilterRail(panelFilters);
  buildPhotoTabs();
  setTool(tool);
  selectPhoto(Math.min(i, lastShots.length - 1));
  setStatus("Add stickers, text or doodles to each photo, then tap Done.");
}

function leaveEdit() {
  if (mode !== "edit") return;
  mode = "camera";
  stage.classList.remove("editing");
  selectedId = null;
  drag = null;
  moveFilterRail(filterSlot);
}

function finishEdit() {
  leaveEdit();
  if (lastShots) buildStrip(lastShots);
  setStatus("Looking good. Download or print your strip, or edit it again.");
}

/* ---- pointer interaction on the editor ---- */
const evPoint = (e) => {
  const r = overlayCanvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) * EDIT_W) / r.width, y: ((e.clientY - r.top) * EDIT_H) / r.height };
};

overlayCanvas.addEventListener("pointerdown", (e) => {
  if (mode !== "edit") return;
  e.preventDefault();
  overlayCanvas.setPointerCapture(e.pointerId);
  const p = evPoint(e);
  const edit = currentEdit();

  if (tool === "draw") {
    const s = { color: penColor, width: 0.012, pts: [[p.x / EDIT_W, p.y / EDIT_H]] };
    edit.strokes.push(s);
    drag = { kind: "draw", s };
    renderOverlay();
    return;
  }

  const sel = selectedItem();
  if (sel) {
    const h = handlePositions(sel);
    if (Math.hypot(p.x - h.del.x, p.y - h.del.y) <= HANDLE_R + 8) {
      removeItem(sel.id);
      return;
    }
    if (Math.hypot(p.x - h.scale.x, p.y - h.scale.y) <= HANDLE_R + 8) {
      const cx = sel.x * EDIT_W, cy = sel.y * EDIT_H;
      drag = {
        kind: "xform", it: sel,
        d0: Math.max(1, Math.hypot(p.x - cx, p.y - cy)),
        a0: Math.atan2(p.y - cy, p.x - cx),
        size0: sel.size, rot0: sel.rot,
      };
      return;
    }
  }

  const hit = hitItem(p);
  if (hit) {
    selectedId = hit.id;
    edit.items = edit.items.filter((i) => i !== hit).concat(hit);   // bring to front
    drag = { kind: "move", it: hit, dx: p.x - hit.x * EDIT_W, dy: p.y - hit.y * EDIT_H };
  } else {
    selectedId = null;
  }
  syncTextControls();
  renderOverlay();
});

overlayCanvas.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const p = evPoint(e);
  if (drag.kind === "draw") {
    drag.s.pts.push([p.x / EDIT_W, p.y / EDIT_H]);
  } else if (drag.kind === "move") {
    drag.it.x = clamp((p.x - drag.dx) / EDIT_W, 0, 1);
    drag.it.y = clamp((p.y - drag.dy) / EDIT_H, 0, 1);
  } else if (drag.kind === "xform") {
    const cx = drag.it.x * EDIT_W, cy = drag.it.y * EDIT_H;
    drag.it.size = clamp(drag.size0 * (Math.hypot(p.x - cx, p.y - cy) / drag.d0), 0.04, 0.7);
    drag.it.rot = drag.rot0 + (Math.atan2(p.y - cy, p.x - cx) - drag.a0);
  }
  renderOverlay();
});

const endDrag = () => {
  if (!drag) return;
  drag = null;
  commitEdit();
};
overlayCanvas.addEventListener("pointerup", endDrag);
overlayCanvas.addEventListener("pointercancel", endDrag);

/* ---- edit controls ---- */
STICKERS.forEach((s) => {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = s;
  b.setAttribute("aria-label", `Add ${s} sticker`);
  b.addEventListener("click", () => addItem({ type: "emoji", value: s, size: 0.18 }));
  emojiGrid.appendChild(b);
});

buildSwatches(textSwatches, textColor, (c) => {
  textColor = c;
  const it = selectedItem();
  if (it?.type === "text") { it.color = c; renderOverlay(); commitEdit(); }
});
buildSwatches(penSwatches, penColor, (c) => { penColor = c; });

addTextBtn.addEventListener("click", () =>
  addItem({ type: "text", value: textInput.value.trim() || "Say cheese!", size: 0.1, color: textColor })
);
textInput.addEventListener("input", () => {
  const it = selectedItem();
  if (it?.type === "text") { it.value = textInput.value; renderOverlay(); commitEdit(); }
});

undoBtn.addEventListener("click", () => {
  const e = currentEdit();
  if (e?.strokes.length) { e.strokes.pop(); renderOverlay(); commitEdit(); }
});
clearBtn.addEventListener("click", () => {
  const e = currentEdit();
  if (e?.strokes.length) { e.strokes = []; renderOverlay(); commitEdit(); }
});

setupSegmented(toolSeg, setTool);
doneBtn.addEventListener("click", finishEdit);
editBtn.addEventListener("click", () => enterEdit(editIndex));
retakeBtn.addEventListener("click", () => {
  resetSession();
  setStatus("Ready for a new set.");
});

/* ---------- strip actions ---------- */
function downloadStrip() {
  if (!stripDataUrl) return;
  const a = document.createElement("a");
  a.href = stripDataUrl;
  a.download = `photobooth-${layout.id}-${Date.now()}.jpg`;
  a.click();
}

function printStrip() {
  if (!stripDataUrl) return;
  const win = window.open("", "_blank");
  if (!win) {
    setStatus("Your browser blocked the print window. Allow pop-ups and try again.", true);
    return;
  }
  win.document.write(`
    <html><head><title>Print</title>
    <style>
      @page { margin: 0; }
      body { margin: 0; display: grid; place-items: center; }
      img { max-width: 100%; max-height: 100vh; }
    </style></head>
    <body><img src="${stripDataUrl}"
      onload="window.focus(); window.print(); window.onafterprint = () => window.close();">
    </body></html>`);
  win.document.close();
}

function clearStrip() {
  stripDataUrl = null;
  stripPreview.innerHTML = '<p class="empty">Take photos and your strip will appear here.</p>';
}

function readyMessage() {
  if (!stream) return "";
  const per = layout.cols * layout.rows;
  return layout.sets > 1
    ? `${layout.name}: ${layout.sets} sets of ${per} photos. Press the shutter to start set 1.`
    : `${layout.name}: ${per} ${per === 1 ? "photo" : "photos"}. Press the shutter or Space.`;
}

function resetSession() {
  clearTimeout(stripTimer);
  leaveEdit();
  lastShots = null;
  sessionShots = [];
  round = 0;
  edits = [];
  editIndex = 0;
  clearStrip();
  [downloadBtn, printBtn, resetBtn, editBtn].forEach((b) => (b.disabled = true));
  setStatus(readyMessage());
}

/* ---------- layout picker ---------- */
const layoutPreviews = [];   // { layout, canvas, scale }: redrawn once the fonts load

function drawPickerPreviews() {
  layoutPreviews.forEach(({ layout: L, canvas, scale }) =>
    renderSheet(L, [], { canvas, scale, preview: true })
  );
}

function buildPicker() {
  const groups = [...new Set(LAYOUTS.map((l) => l.group))];

  groups.forEach((name) => {
    const section = document.createElement("section");
    section.className = "picker-group";
    const heading = document.createElement("h2");
    heading.textContent = name;
    const grid = document.createElement("div");
    grid.className = "picker-grid";
    section.append(heading, grid);

    LAYOUTS.filter((l) => l.group === name).forEach((L) => {
      const g = geometry(L);
      const canvas = document.createElement("canvas");
      layoutPreviews.push({ layout: L, canvas, scale: Math.min(440 / g.height, 560 / g.width) });

      const card = document.createElement("button");
      card.type = "button";
      card.className = "layout-card has-ripple";
      card.dataset.id = L.id;
      card.setAttribute("aria-label", `${L.name}: ${L.desc}`);
      card.innerHTML =
        '<span class="well"></span>' +
        `<span class="meta"><span class="title">${L.name}</span><span class="desc">${L.desc}</span></span>`;
      card.querySelector(".well").appendChild(canvas);
      card.addEventListener("click", () => pickLayout(L.id));
      grid.appendChild(card);
    });

    pickerGroups.appendChild(section);
  });
}

function showView(v) {
  view = v;
  document.body.dataset.view = v;
  if (v === "layout") {
    pickerGroups.querySelectorAll(".layout-card").forEach((b) =>
      b.setAttribute("aria-current", String(hasChosen && b.dataset.id === layout.id))
    );
    pickerBack.classList.toggle("hidden", !hasChosen);
    pickerNote.classList.toggle("hidden", !(lastShots || sessionShots.length));
    window.scrollTo(0, 0);
  }
}

function applyLayout() {
  layoutName.textContent = layout.name;
  setEditAspect(layout.aspect);
  setStatus(readyMessage());
}

function pickLayout(id) {
  const L = LAYOUTS.find((l) => l.id === id);
  if (L && L !== layout) {
    resetSession();     // different layout: start a fresh set of photos
    layout = L;
    applyLayout();
  }
  hasChosen = true;
  showView("booth");
}

/* ---------- events ---------- */
startBtn.addEventListener("click", startCamera);
captureBtn.addEventListener("click", startSession);
downloadBtn.addEventListener("click", downloadStrip);
printBtn.addEventListener("click", printStrip);
resetBtn.addEventListener("click", resetSession);

mirrorToggle.addEventListener("change", applyMirror);
cameraSelect.addEventListener("change", () => stream && startCamera());
resSelect.addEventListener("change", () => stream && startCamera());

layoutBtn.addEventListener("click", () => showView("layout"));
pickerBack.addEventListener("click", () => showView("booth"));
setupSegmented(timerSeg, (v) => (timerSeconds = Number(v)));

// settings drawer
function openDrawer() {
  drawer.classList.add("open");
  scrim.classList.add("open");
  menuBtn.setAttribute("aria-expanded", "true");
  closeBtn.focus();
}
function closeDrawer() {
  if (!drawer.classList.contains("open")) return;
  drawer.classList.remove("open");
  scrim.classList.remove("open");
  menuBtn.setAttribute("aria-expanded", "false");
  menuBtn.focus();
}
menuBtn.addEventListener("click", openDrawer);
closeBtn.addEventListener("click", closeDrawer);
scrim.addEventListener("click", closeDrawer);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeDrawer();
});

// ripple on buttons marked .has-ripple
document.addEventListener("pointerdown", (e) => {
  const target = e.target.closest(".has-ripple");
  if (!target || target.disabled) return;
  const rect = target.getBoundingClientRect();
  const size = Math.hypot(rect.width, rect.height) * 2;
  const wave = document.createElement("span");
  wave.className = "ripple-wave";
  wave.style.width = wave.style.height = `${size}px`;
  wave.style.left = `${e.clientX - rect.left - size / 2}px`;
  wave.style.top = `${e.clientY - rect.top - size / 2}px`;
  target.appendChild(wave);
  wave.addEventListener("animationend", () => wave.remove());
});

// Space = take photos, Left/Right = change filter
document.addEventListener("keydown", (e) => {
  if (drawer.classList.contains("open") || view !== "booth") return;
  const el = document.activeElement;
  if (["SELECT", "INPUT"].includes(el.tagName)) return;

  if (mode === "edit") {
    if ((e.key === "Delete" || e.key === "Backspace") && selectedItem()) {
      e.preventDefault();
      removeItem(selectedId);
    } else if (e.key === "Escape") {
      selectedId = null;
      renderOverlay();
    } else if ((e.code === "ArrowRight" || e.code === "ArrowLeft") && tool === "filters") {
      e.preventDefault();
      stepFilter(e.code === "ArrowRight" ? 1 : -1);
    }
    return;
  }

  if (e.code === "Space") {
    // focused buttons (other than filters and toggles) keep their own Space behaviour
    if (el.tagName === "BUTTON" && !el.matches(".filter, .seg button")) return;
    if (!captureBtn.disabled && !busy) {
      e.preventDefault();
      startSession();
    }
  } else if (e.code === "ArrowRight" || e.code === "ArrowLeft") {
    if (busy) return;
    e.preventDefault();
    stepFilter(e.code === "ArrowRight" ? 1 : -1);
  }
});

navigator.mediaDevices?.addEventListener?.("devicechange", () => {
  if (stream) populateCameras();
});

window.addEventListener("beforeunload", stopCamera);

/* ---------- init ---------- */
buildFilterRail();
applyFx(viewfinder, currentFilter());
buildPicker();
applyLayout();
drawPickerPreviews();
showView("layout");
loadFrames();

// redraw the previews once the strip fonts are ready
if (document.fonts?.load) {
  Promise.all([
    document.fonts.load('600 30px Montserrat'),
    document.fonts.load('400 17px Roboto'),
  ]).then(() => drawPickerPreviews(), () => {});
}