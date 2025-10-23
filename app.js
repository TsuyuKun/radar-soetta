console.log("[app] starting…");

// ===== CONFIG =====
const META_URL = "https://radar-soetta.meteo-vei.workers.dev/";
const IMG_BASE  = "https://radar.bmkg.go.id/sidarma-nowcast/";

// From your station metadata image:
const overlayTLC = [-3.923728719811228, 104.398987719812]; // top-left  (lat, lon)
const overlayBRC = [-8.41895928018772, 108.894218280188];  // bottom-right (lat, lon)

// Convert to Leaflet bounds: [[southWest],[northEast]]
const southWest = [overlayBRC[0], Math.min(overlayTLC[1], overlayBRC[1])];
const northEast = [overlayTLC[0], Math.max(overlayTLC[1], overlayBRC[1])];
const IMAGE_BOUNDS = [southWest, northEast];

const MAP_CENTER = [-6.171344, 106.646603]; // Jakarta  
const MAP_ZOOM = 10;
const FRAME_INTERVAL = 700;

let frames = [];
let frameIndex = 0;
let overlay = null;
let timer = null;

// ===== MAP =====
let map;
try {
  map = L.map("map", { center: MAP_CENTER, zoom: MAP_ZOOM, minZoom: 4, maxZoom: 12 });
  map.zoomControl.setPosition("topright");
  console.log("[map] created");
} catch (e) {
  console.error("[map] failed to create:", e);
}

const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap contributors"
});
osm.on("tileerror", (ev) => console.warn("[tiles] error", ev));
osm.addTo(map);
console.log("[tiles] OSM layer added");

// Prepare overlay now, URL will be set later
overlay = L.imageOverlay("", IMAGE_BOUNDS, {
    opacity: 0.65
  }).addTo(map);

// Opacity control
document.getElementById("opacity").addEventListener("input", (e) => {
  overlay.setOpacity(Number(e.target.value));
});

// Buttons
const btnPrev = document.getElementById("btnPrev");
const btnPlay = document.getElementById("btnPlay");
const btnNext = document.getElementById("btnNext");
const timeChip = document.getElementById("time-chip");
btnPrev.addEventListener("click", () => { stop(); prevFrame(); });
btnNext.addEventListener("click", () => { stop(); nextFrame(); });
btnPlay.addEventListener("click", () => { if (timer) stop(); else play(); });

// ===== DATA LOADING =====
async function loadMetadata() {
  console.log("[fetch] metadata", META_URL);
  const resp = await fetch(META_URL, { cache: "no-store" });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const json = await resp.json();
  console.log("[fetch] got JSON", json);

  const cmax = json?.CMAX;
  if (!cmax) throw new Error("No CMAX node in JSON");

  const files = cmax?.LastOneHour?.file || [];
  const utc   = cmax?.LastOneHour?.timeUTC || [];
  const local = cmax?.LastOneHour?.timeLocal || [];

  frames = files.map((path, i) => ({
    url: IMG_BASE + path,
    timeUTC: utc[i] || "",
    timeLocal: local[i] || ""
  }));

  if (frames.length === 0 && cmax.Latest?.file) {
    frames = [{
      url: IMG_BASE + cmax.Latest.file,
      timeUTC: cmax.Latest.timeUTC || "",
      timeLocal: cmax.Latest.timeLocal || ""
    }];
  }
  if (frames.length === 0) throw new Error("No frames available");

  frameIndex = frames.length - 1;
  showFrame(frameIndex);
}

function showFrame(i) {
  frameIndex = (i + frames.length) % frames.length;
  const url = frames[frameIndex].url;
  overlay.setUrl(url);

  // Update top-left badge time
  const badgeTime = document.getElementById("badge-time");
  if (badgeTime) {
    badgeTime.textContent = `${frames[frameIndex].timeLocal} | ${frames[frameIndex].timeUTC}`;
  }
}

function nextFrame() { showFrame(frameIndex + 1); }
function prevFrame() { showFrame(frameIndex - 1); }
function play() { btnPlay.textContent = "⏸"; timer = setInterval(nextFrame, FRAME_INTERVAL); }
function stop() { btnPlay.textContent = "▶"; clearInterval(timer); timer = null; }

loadMetadata().catch(err => {
  console.error("[fetch] metadata error:", err);
  document.getElementById("timestamp").textContent = "Failed to load metadata.";
  if (document.getElementById("badge-time")) {
    document.getElementById("badge-time").textContent = "No data";
  }  
});
