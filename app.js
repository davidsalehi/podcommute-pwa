// PodCommute PWA (vanilla JS)
// Notes:
// - RSS feeds typically require a CORS proxy in browsers.
// - Autoplay may be blocked without a user gesture.
// - Location trigger works while the app is open (no true background geofencing).

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

// --- Configure your proxy endpoint here ---
// You will run a tiny proxy (provided below) and set it like:
// const PROXY = "http://localhost:8787/rss?url=";
// For production you’ll deploy this proxy to a serverless endpoint.
const PROXY = "http://localhost:8787/rss?url=";

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

function setStatus(msg) {
  statusEl.textContent = msg;
}

function loadStore() {
  try {
    const raw = localStorage.getItem("podcommute_store");
    if (raw) store = JSON.parse(raw);
  } catch {}
  // hydrate inputs
  if (store.settings?.lat != null) latEl.value = store.settings.lat;
  if (store.settings?.lon != null) lonEl.value = store.settings.lon;
  if (store.settings?.radius != null) radiusEl.value = store.settings.radius;
}

function saveStore() {
  localStorage.setItem("podcommute_store", JSON.stringify(store));
}

function mustHaveProxyWarning() {
  corsNoteEl.textContent =
    "If refresh fails: browsers usually need a CORS proxy to fetch RSS. Set PROXY in app.js and run the proxy server.";
}

async function fetchRss(url) {
  const proxied = PROXY + encodeURIComponent(url);
  const resp = await fetch(proxied, { cache: "no-store" });
  if (!resp.ok) throw new Error(`Proxy fetch failed (${resp.status})`);
  return await resp.text();
}

// Parse RSS XML for items with enclosure urls
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

  // Keep only newest 3 (feeds are typically already newest-first)
  return parsed.slice(0, 3);
}

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
    li.querySelector('[data-act="play"]').addEventListener("click", () => {
      queue = [ep];
      queueIndex = 0;
      playCurrent();
    });
    li.querySelector('[data-act="queue"]').addEventListener("click", () => {
      queue.push(ep);
      setStatus(`Queued: ${ep.title}`);
    });
    container.appendChild(li);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"
  }[c]));
}

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

function buildCommuteQueue() {
  // newest 3 NPR then newest 3 CNN (you can change ordering)
  const q = [];
  q.push(...(store.npr || []));
  q.push(...(store.cnn || []));
  return q.filter(x => x.audioUrl);
}

async function playQueue() {
  queue = buildCommuteQueue();
  if (!queue.length) {
    setStatus("Queue is empty. Refresh first.");
    return;
  }
  queueIndex = 0;
  await playCurrent(true);
}

async function playCurrent(userInitiated = false) {
  if (queueIndex < 0 || queueIndex >= queue.length) return;
  const ep = queue[queueIndex];

  nowPlayingEl.textContent = `Playing (${queueIndex + 1}/${queue.length}): ${ep.title}`;
  audio.src = ep.audioUrl;

  try {
    // Autoplay policies: play() may fail unless there was a user gesture.
    await audio.play();
    setStatus("Playing.");
  } catch (err) {
    console.warn("Autoplay blocked or failed:", err);
    setStatus("Playback blocked. Tap Play Commute Queue / Play on an episode once, then it should work.");
    if (!userInitiated) {
      // leave it ready; user can press play on the audio controls
    }
  }
}

function next() {
  if (!queue.length) return;
  queueIndex = Math.min(queueIndex + 1, queue.length - 1);
  playCurrent();
}

function prev() {
  if (!queue.length) return;
  queueIndex = Math.max(queueIndex - 1, 0);
  playCurrent();
}

audio.addEventListener("ended", () => {
  if (queueIndex < queue.length - 1) {
    queueIndex++;
    playCurrent();
  } else {
    setStatus("Queue finished.");
  }
});

// --- Location trigger (while app is open) ---
function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000; // meters
  const toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat/2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
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
        // Attempt to start playback; may be blocked without user gesture.
        await playQueue();
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

async function useCurrentLocation() {
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

// --- UI wiring ---
btnRefresh.addEventListener("click", refreshAll);
btnPlayQueue.addEventListener("click", () => playQueue()); // user gesture helps autoplay
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

  // Show stored queue state
  setStatus("Ready. Tap Refresh.");
});
