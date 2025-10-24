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
  map = L.map("map", { center: MAP_CENTER, zoom: MAP_ZOOM, minZoom: 4, maxZoom: 17 });
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


// SVG icon factory (inline for best rendering)
function iconSVG(name) {
  switch (name) {
    case 'prev':   // |◀ (step back)
      return `
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M6 5v14" />
          <path d="M18 6l-9 6 9 6V6z" />
        </svg>`;
    case 'next':   // ▶| (step forward)
      return `
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M18 5v14" />
          <path d="M6 6l9 6-9 6V6z" />
        </svg>`;
    case 'play':   // ▶
      return `
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M8 5l12 7-12 7V5z" />
        </svg>`;
    case 'pause':  // ⏸
      return `
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M8 5h3v14H8zM13 5h3v14h-3z" />
        </svg>`;
    default:
      return '';
  }
}

// Initialize button icons once
let PRODUCT = "CMAX";
const productSel = document.getElementById("product");
const noticeChip = document.getElementById("notice-chip");
const btnPrev = document.getElementById("btnPrev");
const btnPlay = document.getElementById("btnPlay");
const btnNext = document.getElementById("btnNext");
const badgeTime = document.getElementById("badge-time");
btnPrev.innerHTML = iconSVG('prev');
btnPlay.innerHTML = iconSVG('play');
btnNext.innerHTML = iconSVG('next');
// Update play button icon consistently

function setPlayUI(isPlaying) {
  btnPlay.innerHTML = isPlaying ? iconSVG('pause') : iconSVG('play');
  btnPlay.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
}

// Buttons
const timeChip = document.getElementById("time-chip");
btnPrev.addEventListener("click", () => { stop(); prevFrame(); });
btnNext.addEventListener("click", () => { stop(); nextFrame(); });
btnPlay.addEventListener("click", () => { if (timer) stop(); else play(); });

// ===== DATA LOADING =====
async function loadMetadata() {
  console.log("[fetch] metadata", META_URL, "product:", PRODUCT);
  const resp = await fetch(META_URL, { cache: "no-store" });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const json = await resp.json();

  frames = buildFramesFromJSON(json, PRODUCT);
  if (frames.length === 0) throw new Error("No frames available");

  // Start position depends on product type
  if (PRODUCT === "STEPS") {
    frameIndex = 0; // forecast: start from first frame
  } else {
    frameIndex = frames.length - 1; // observation: start from latest
  }
  showFrame(frameIndex);
}

function buildFramesFromJSON(json, product) {
  let node = null;
  if (product === "CMAX") node = json?.CMAX;
  if (product === "STEPS") node = json?.STEPS;
  if (!node) return [];

  const files = node?.LastOneHour?.file || [];
  const utc   = node?.LastOneHour?.timeUTC || [];
  const local = node?.LastOneHour?.timeLocal || [];

  const isForecast = product === "STEPS";
  let out = files.map((path, i) => ({
    url: IMG_BASE + path,
    timeUTC: utc[i] || "",
    timeLocal: local[i] || "",
    leadMin: (local[i] || utc[i] || "").match(/\\(\\+(\\d+)\\s*min\\)/i)?.[1] || 0,
    isForecast
  }));

  // Fallback Latest
  if (!out.length && node?.Latest?.file) {
    out.push({
      url: IMG_BASE + node.Latest.file,
      timeUTC: node.Latest.timeUTC || "",
      timeLocal: node.Latest.timeLocal || "",
      leadMin: (node.Latest.timeLocal || "").match(/\\(\\+(\\d+)\\s*min\\)/i)?.[1] || 0,
      isForecast
    });
  }

  if (isForecast && out.length > 8) {
    out = out.slice(0, 8);
    console.log(`[steps] truncated to first 8 frames (of ${files.length})`);
  }

  return out;
}

if (productSel) {
  productSel.addEventListener("change", async () => {
    PRODUCT = productSel.value;
    stop();
    await loadMetadata();
  });
}

function showFrame(i) {
  frameIndex = (i + frames.length) % frames.length;
  const f = frames[frameIndex];
  overlay.setUrl(f.url);

  // Write to the badge pill
  if (badgeTime) {
    badgeTime.textContent = `${f.timeLocal} | ${f.timeUTC}`;
  }

  // Forecast notice (if you have it)
  if (noticeChip) {
    if (f.isForecast) {
      const lead = Number(f.leadMin) || 0;
      noticeChip.textContent = lead > 0 ? `Forecast +${lead} min` : "Forecast";
      noticeChip.hidden = false;
    } else {
      noticeChip.hidden = true;
    }
  }
}

function nextFrame() { showFrame(frameIndex + 1); }
function prevFrame() { showFrame(frameIndex - 1); }
function play() {
  setPlayUI(true);
  timer = setInterval(nextFrame, FRAME_INTERVAL);
}

function stop() {
  setPlayUI(false);
  clearInterval(timer);
  timer = null;
}

loadMetadata().catch(err => {
  console.error("[fetch] metadata error:", err);
  document.getElementById("timestamp").textContent = "Failed to load metadata.";
  if (document.getElementById("badge-time")) {
    document.getElementById("badge-time").textContent = "No data";
  }  
});

// ===== USER LOCATION =====
if ("geolocation" in navigator) {
  console.log("[geo] requesting user location...");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      console.log(`[geo] user location: ${lat}, ${lon}`);

      // Center the map smoothly to user position
      map.setView([lat, lon], 10, { animate: true });

      // Add marker
      const userMarker = L.circleMarker([lat, lon], {
        radius: 6,
        fillColor: "#00b8a9",
        color: "#fff",
        weight: 2,
        opacity: 1,
        fillOpacity: 0.9,
      }).addTo(map);

      userMarker.bindPopup("<b>Lokasi Anda</b>").openPopup();
    },
    (err) => {
      console.warn("[geo] permission denied or unavailable:", err.message);
    },
    {
      enableHighAccuracy: true,
      timeout: 8000,
      maximumAge: 0,
    }
  );
} else {
  console.warn("[geo] geolocation not supported by this browser.");
}

