// PodCommute PWA (vanilla JS)
//
// Notes:
// - RSS feeds typically require a CORS proxy in browsers.
// - Autoplay may be blocked without a user gesture, especially if another app (e.g., YouTube) is playing.
// - Location trigger works while the app is open (no true background geofencing in PWAs).

const FEEDS = {
  npr: {
    name: "NPR News Now",
    rss: "https://feeds.npr.org/500005/podcast.xml"
  },
  cnn: {
    name: "CNN 5 Things",
    rss: "https://feeds.megaphone.fm/WMHY2007701094"
  }
};

// Configure your proxy endpoint here (Cloudflare Worker)
const PROXY = "https://ancient-sunset-8391.davidsalehi.workers.dev/?url=";

// --- DOM ---
const statusEl = document.getElementById("status");
const corsNoteEl = document.getElementById("corsNote");

const listNpr = document.getElementById("listNpr");
const listCnn = document.getElementById("listCnn");

const audio = document.getElementById("audio");
const nowPlayingEl = document.getElementById("nowPlaying");

const btnRefresh = document.getElementById("btnRefresh");
const btnPlayQueue = document.getElementById("btnPlayQueue");
const btnPrev = document.getElementById("btnPrev");
const btnNext = document.getElementById("btnNext");

const latEl = document.getElementById("lat");
const lonEl = document.getElementById("lon");
const radiusEl = document.getElementById("radius");
const btnUseCurrent = document.getElementById("btnUseCurrent");
const btnStartWatch = document.getElementById("btnStartWatch");
const btnStopWatch = document.getElementById("btnStopWatch");
const watchStateEl = document.getElementById("watchState");
const distanceEl = document.getElementById("distance");

// --- State ---
let store = {
  npr: [],
  cnn: [],
  settings: {
    lat: null,
    lon: null,
    radius: 250
  }
};

let queue = [];
let queueIndex = -1;

let watchId = null;
let hasTriggeredThisSession = false;

// --- Helpers ---
function setStatus(msg) {
  statusEl.textContent = msg;
}

function loadStore() {
  try {
    const raw = localStorage.getItem("podcommute_store");
    if (raw) store = JSON.parse(raw);
  } catch {}

  if (store.settings?.lat != null) latEl.value = store.settings.lat;
  if (store.settings?.lon != null) lonEl.value = store.settings.lon;
  if (store.settings?.radius != null) radiusEl.value = store.settings.radius;
}

function saveStore() {
  localStorage.setItem("podcommute_store", JSON.stringify(store));
}

function mustHaveProxyWarning() {
  corsNoteEl.textContent =
    "If refresh fails: CORS is the bouncer at the RSS club. Set PROXY in app.js and use the proxy to get in.";
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  }[c]));
}

async function fetchRss(url) {
  const proxied = PROXY + encodeURIComponent(url);
  const resp = await fetch(proxied, { cache: "no-store" });
  if (!resp.ok) throw new Error(`Proxy fetch failed (${resp.status})`);
  return await resp.text();
}

// Parse RSS XML for items with enclosure URLs
function parseRss(xmlText, sourceKey) {
  const doc = new DOMParser().parseFromString(xmlText, "text/xml");
  const items = Array.from(doc.querySelectorAll("item"));

  const parsed = items.map((it) => {
    const title = (it.querySelector("title")?.textContent || "").trim();
    const pubDate = (it.querySelector("pubDate")?.textContent || "").trim();
    const enclosure = it.querySelector("enclosure");
    const audioUrl = enclosure?.getAttribute("url") || "";
    const link = (it.querySelector("link")?.textContent || "").trim();

    return {
      id: `${sourceKey}:${audioUrl || link || title}`.slice(0, 500),
      source: sourceKey,
      title,
      pubDate,
      audioUrl,
      link
    };
  }).filter(x => x.audioUrl);

  // Keep only newest 3 (feeds are typically newest-first)
  return parsed.slice(0, 3);
}

// --- UI render ---
function renderLists() {
  renderList(listNpr, store.npr);
  renderList(listCnn, store.cnn);
}

function renderList(container, items) {
  container.innerHTML = "";
  if (!items?.length) {
    container.innerHTML = `<li class="small">No items yet. Tap Refresh.</li>`;
    return;
  }

  for (const ep of items) {
    const li = document.createElement("li");
    li.className = "item";
    li.innerHTML = `
      <div class="title">${escapeHtml(ep.title || "(untitled)")}</div>
      <div class="meta">${escapeHtml(ep.pubDate || "")}</div>
      <div class="actions">
        <button data-act="play">Play</button>
        <button data-act="queue" class="ghost">Add to Queue</button>
        <a href="${ep.audioUrl}" target="_blank" rel="noopener">Open Audio</a>
      </div>
    `;

    li.querySelector('[data-act="play"]').addEventListener("click", async () => {
      queue = [ep];
      queueIndex = 0;
      await playCurrent(true); // user initiated
    });

    li.querySelector('[data-act="queue"]').addEventListener("click", () => {
      queue.push(ep);
      setStatus(`Queued: ${ep.title}`);
    });

    container.appendChild(li);
  }
}

// --- Refresh ---
async function refreshAll() {
  mustHaveProxyWarning();
  setStatus("Refreshing feeds…");

  try {
    const [nprXml, cnnXml] = await Promise.all([
      fetchRss(FEEDS.npr.rss),
      fetchRss(FEEDS.cnn.rss)
    ]);

    store.npr = parseRss(nprXml, "npr");
    store.cnn = parseRss(cnnXml, "cnn");
    saveStore();
    renderLists();

    setStatus("Updated latest 3 episodes for each feed.");
  } catch (err) {
    console.error(err);
    setStatus("Refresh failed. Check proxy and console.");
  }
}

// --- Queue + playback ---
function buildCommuteQueue() {
  const npr = (store.npr || []).filter(x => x.audioUrl);
  const cnn = (store.cnn || []).filter(x => x.audioUrl);

  const q = [];
  const maxLen = Math.max(npr.length, cnn.length);

  for (let i = 0; i < maxLen; i++) {
    if (npr[i]) q.push(npr[i]);
    if (cnn[i]) q.push(cnn[i]);
  }

  return q;
}

async function playQueue(userInitiated = false) {
  queue = buildCommuteQueue();

  if (!queue.length) {
    setStatus("Queue is empty. Refresh first.");
    return;
  }

  queueIndex = 0;
  await playCurrent(userInitiated);
}

async function playCurrent(userInitiated = false) {
  if (queueIndex < 0 || queueIndex >= queue.length) return;
  const ep = queue[queueIndex];

  nowPlayingEl.textContent = `Playing (${queueIndex + 1}/${queue.length}): ${ep.title}`;
  audio.src = ep.audioUrl;

  // If this was a user click, we still attempt normal play (likely to succeed).
  // If not, autoplay/audio focus may block — show banner fallback.
  const ok = await tryPlayWithFallback(userInitiated);

  if (ok) {
    setStatus("Playing.");
  } else {
    setStatus("Playback blocked (often because another app is playing). Tap Play in the banner.");
  }
}

function next() {
  if (!queue.length) return;
  queueIndex = Math.min(queueIndex + 1, queue.length - 1);
  playCurrent(false);
}

function prev() {
  if (!queue.length) return;
  queueIndex = Math.max(queueIndex - 1, 0);
  playCurrent(false);
}

audio.addEventListener("ended", () => {
  if (queueIndex < queue.length - 1) {
    queueIndex++;
    playCurrent(false);
  } else {
    setStatus("Queue finished.");
  }
});

// --- Autoplay/audio focus fallback banner ---
let tapBannerEl = null;

function ensureTapBanner() {
  if (tapBannerEl) return;

  tapBannerEl = document.createElement("div");
  tapBannerEl.style.position = "fixed";
  tapBannerEl.style.left = "16px";
  tapBannerEl.style.right = "16px";
  tapBannerEl.style.bottom = "16px";
  tapBannerEl.style.padding = "12px";
  tapBannerEl.style.borderRadius = "12px";
  tapBannerEl.style.background = "rgba(20, 20, 20, 0.95)";
  tapBannerEl.style.border = "1px solid rgba(255, 255, 255, 0.14)";
  tapBannerEl.style.zIndex = "9999";
  tapBannerEl.style.display = "none";
  tapBannerEl.style.backdropFilter = "blur(6px)";

  tapBannerEl.innerHTML = `
    <div style="display:flex; gap:12px; align-items:center; justify-content:space-between;">
      <div style="font-size:14px; line-height:1.25;">
        <div style="font-weight:650;">Trigger reached</div>
        <div style="opacity:0.85;">Autoplay/audio focus blocked. Tap Play to take over audio.</div>
      </div>
      <div style="display:flex; gap:10px; align-items:center;">
        <button id="tapToPlayBtn" style="padding:10px 12px; border-radius:10px; border:0; font-weight:650; cursor:pointer;">
          Play
        </button>
        <button id="dismissBannerBtn" style="padding:10px 12px; border-radius:10px; border:1px solid rgba(255,255,255,0.15); background:transparent; color:#fff; cursor:pointer;">
          Dismiss
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(tapBannerEl);

  tapBannerEl.querySelector("#tapToPlayBtn").addEventListener("click", async () => {
    try {
      await audio.play();
      hideTapToPlayBanner();
      setStatus("Playing.");
    } catch (e) {
      setStatus("Still blocked. Pause the other audio (e.g., YouTube) and tap Play again.");
    }
  });

  tapBannerEl.querySelector("#dismissBannerBtn").addEventListener("click", () => {
    hideTapToPlayBanner();
  });
}

function showTapToPlayBanner() {
  ensureTapBanner();
  tapBannerEl.style.display = "block";
}

function hideTapToPlayBanner() {
  if (tapBannerEl) tapBannerEl.style.display = "none";
}

async function tryPlayWithFallback(userInitiated = false) {
  try {
    await audio.play();
    hideTapToPlayBanner();
    return true;
  } catch (e) {
    // If user initiated and still failed, banner is still helpful.
    // If not user initiated, we almost certainly need a tap.
    showTapToPlayBanner();
    return false;
  }
}

// --- Location trigger (while app is open) ---
function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000; // meters
  const toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function getSettingsFromInputs() {
  const lat = Number(latEl.value);
  const lon = Number(lonEl.value);
  const radius = Number(radiusEl.value) || 250;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon, radius };
}

function saveSettingsFromInputs() {
  const s = getSettingsFromInputs();
  if (!s) return false;
  store.settings = s;
  saveStore();
  return true;
}

function updateWatchUI(on) {
  watchStateEl.textContent = on ? "ON" : "OFF";
}

function startWatch() {
  const s = getSettingsFromInputs();
  if (!s) {
    setStatus("Enter a valid latitude and longitude first.");
    return;
  }
  saveSettingsFromInputs();

  if (!navigator.geolocation) {
    setStatus("Geolocation not supported in this browser.");
    return;
  }

  hasTriggeredThisSession = false;
  updateWatchUI(true);
  setStatus("Watching location…");

  watchId = navigator.geolocation.watchPosition(
    async (pos) => {
      const { latitude, longitude } = pos.coords;
      const dist = haversineMeters(latitude, longitude, s.lat, s.lon);
      distanceEl.textContent = `${Math.round(dist)} m`;

      if (!hasTriggeredThisSession && dist <= s.radius) {
        hasTriggeredThisSession = true;
        setStatus(`Entered zone (≤ ${s.radius}m). Attempting to start commute queue…`);

        // Trigger-based playback is NOT user initiated.
        await playQueue(false);
      }
    },
    (err) => {
      console.warn(err);
      setStatus("Location error. Check permissions (and HTTPS).");
    },
    {
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 15000
    }
  );
}

function stopWatch() {
  if (watchId != null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  updateWatchUI(false);
  distanceEl.textContent = "—";
  setStatus("Watch stopped.");
}

function useCurrentLocation() {
  if (!navigator.geolocation) {
    setStatus("Geolocation not supported.");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      latEl.value = pos.coords.latitude.toFixed(6);
      lonEl.value = pos.coords.longitude.toFixed(6);
      setStatus("Set trigger to your current location.");
      saveSettingsFromInputs();
    },
    () => setStatus("Could not get current location. Check permissions/HTTPS."),
    { enableHighAccuracy: true, timeout: 15000 }
  );
}

// --- Wiring ---
btnRefresh.addEventListener("click", refreshAll);
btnPlayQueue.addEventListener("click", () => playQueue(true)); // user gesture helps autoplay
btnNext.addEventListener("click", next);
btnPrev.addEventListener("click", prev);

btnUseCurrent.addEventListener("click", useCurrentLocation);
btnStartWatch.addEventListener("click", startWatch);
btnStopWatch.addEventListener("click", stopWatch);

window.addEventListener("load", () => {
  loadStore();
  renderLists();
  mustHaveProxyWarning();

  // Register service worker (needed for install/offline shell)
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(console.warn);
  }

  setStatus("Ready. Tap Refresh.");
});

