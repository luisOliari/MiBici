// Centro de Montevideo (Plaza Independencia) como fallback si no hay permiso de ubicacion.
const FALLBACK_LOCATION = { lat: -34.9058, lon: -56.1913 };
const MONTEVIDEO_VIEWBOX = "-56.42,-34.70,-55.95,-34.95"; // left,top,right,bottom
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const ORS_KEY_STORAGE = "mibici_ors_key";

// Perfil de ruteo de OpenRouteService: no existe un perfil especifico de
// "monopatin", asi que usamos el mismo perfil ciclista (prioriza ciclovias
// y calles tranquilas) para bici y monopatin.
const ORS_PROFILE = "cycling-regular";

const state = {
  userLocation: null,
  originLocation: null, // si el usuario elige un origen distinto al GPS
  destLocation: null,
  vehicle: "bici",
  weather: null,
  map: null,
  userMarker: null,
  destMarker: null,
  routeLayer: null,
  poiMarkers: [],
  activeSuggestionInput: null,
  addressSearchToken: 0,
  navSteps: [],
  navIndex: 0,
  navWatchId: null,
  wakeLock: null,
  isNavigating: false,
  cardExpanded: false,
};

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const el = {
  statusBanner: document.getElementById("statusBanner"),
  weatherCard: document.getElementById("weatherCard"),
  cardHandle: document.getElementById("cardHandle"),
  btnLocate: document.getElementById("btnLocate"),
  btnSettings: document.getElementById("btnSettings"),
  vehicleBtns: document.querySelectorAll(".vehicle-btn"),
  weatherIcon: document.getElementById("weatherIcon"),
  weatherTemp: document.getElementById("weatherTemp"),
  weatherVerdict: document.getElementById("weatherVerdict"),
  verdictLabel: document.getElementById("verdictLabel"),
  verdictVehicle: document.getElementById("verdictVehicle"),
  weatherWind: document.getElementById("weatherWind"),
  weatherRain: document.getElementById("weatherRain"),
  originInput: document.getElementById("originInput"),
  destInput: document.getElementById("destInput"),
  destSuggestions: document.getElementById("destSuggestions"),
  btnCalcRoute: document.getElementById("btnCalcRoute"),
  routeResult: document.getElementById("routeResult"),
  routeDistance: document.getElementById("routeDistance"),
  routeDuration: document.getElementById("routeDuration"),
  routeEta: document.getElementById("routeEta"),
  routeRain: document.getElementById("routeRain"),
  routeNoKey: document.getElementById("routeNoKey"),
  voiceNavControls: document.getElementById("voiceNavControls"),
  btnStartNav: document.getElementById("btnStartNav"),
  voiceNavActive: document.getElementById("voiceNavActive"),
  voiceNextInstruction: document.getElementById("voiceNextInstruction"),
  voiceNextDistance: document.getElementById("voiceNextDistance"),
  btnStopNav: document.getElementById("btnStopNav"),
  voiceNotSupported: document.getElementById("voiceNotSupported"),
  settingsSheet: document.getElementById("settingsSheet"),
  btnCloseSettings: document.getElementById("btnCloseSettings"),
  orsKeyInput: document.getElementById("orsKeyInput"),
  btnSaveKey: document.getElementById("btnSaveKey"),
  keyStatus: document.getElementById("keyStatus"),
};

function setStatus(message, kind) {
  if (!message) {
    el.statusBanner.classList.add("hidden");
    return;
  }
  el.statusBanner.classList.remove("hidden");
  el.statusBanner.textContent = message;
  el.statusBanner.classList.toggle("error", kind === "error");
}

function getOrsKey() {
  return localStorage.getItem(ORS_KEY_STORAGE) || "";
}

// --- Tarjeta plegable: colapsada deja el mapa casi a pantalla completa ---
function setCardExpanded(expanded) {
  state.cardExpanded = expanded;
  el.weatherCard.classList.toggle("collapsed", !expanded);
  // Leaflet cachea el tamaño de su contenedor: hay que avisarle cuando cambia.
  setTimeout(() => state.map?.invalidateSize(), 300);
}
el.cardHandle.addEventListener("click", (e) => {
  e.stopPropagation();
  setCardExpanded(!state.cardExpanded);
});
el.weatherCard.addEventListener("click", () => {
  if (!state.cardExpanded) setCardExpanded(true);
});

// --- Mapa ---
function initMap(lat, lon) {
  state.map = L.map("map", { zoomControl: false }).setView([lat, lon], 15);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
    maxZoom: 19,
  }).addTo(state.map);
  L.control.zoom({ position: "bottomright" }).addTo(state.map);
}

function placeUserMarker(lat, lon) {
  const icon = L.divIcon({ className: "", html: '<div class="user-dot"></div>', iconSize: [18, 18] });
  if (state.userMarker) state.userMarker.setLatLng([lat, lon]);
  else state.userMarker = L.marker([lat, lon], { icon, zIndexOffset: 1000 }).addTo(state.map);
}

function placeDestMarker(lat, lon) {
  const icon = L.divIcon({ className: "", html: '<div class="dest-pin"></div>', iconSize: [26, 26], iconAnchor: [13, 26] });
  if (state.destMarker) state.destMarker.setLatLng([lat, lon]);
  else state.destMarker = L.marker([lat, lon], { icon, zIndexOffset: 900 }).addTo(state.map);
}

// --- Clima ---
async function loadWeather(lat, lon) {
  el.weatherIcon.textContent = "⏳";
  el.verdictLabel.textContent = "Consultando clima…";
  el.weatherVerdict.className = "weather-verdict verdict-loading";
  try {
    const w = await fetchWeather(lat, lon);
    state.weather = w;
    renderWeather();
  } catch {
    el.verdictLabel.textContent = "No se pudo obtener el clima";
    el.weatherVerdict.className = "weather-verdict verdict-warn";
  }
}

function renderWeather() {
  if (!state.weather) return;
  const w = state.weather;
  el.weatherIcon.textContent = weatherCodeToIcon(w.weatherCode);
  el.weatherTemp.textContent = `${Math.round(w.temperature)}°`;
  el.weatherWind.textContent = `Viento: ${Math.round(w.windSpeed)} km/h`;
  el.weatherRain.textContent = w.rainProbability !== null ? `Lluvia: ${w.rainProbability}%` : "Lluvia: s/d";

  const verdict = computeVerdict(state.vehicle, w);
  el.verdictLabel.textContent = verdict.label;
  el.weatherVerdict.className = `weather-verdict verdict-${verdict.level}`;
  el.verdictVehicle.textContent = state.vehicle === "monopatin" ? "monopatín" : "bici";
}

// --- Geolocalizacion ---
function onLocationReady(lat, lon, { fallback } = {}) {
  state.userLocation = { lat, lon };

  if (!state.map) initMap(lat, lon);
  else state.map.panTo([lat, lon]);

  placeUserMarker(lat, lon);
  loadWeather(lat, lon);

  setStatus(
    fallback ? "No se pudo acceder a tu ubicación — mostrando zona de ejemplo (Centro)" : null,
    fallback ? "error" : undefined
  );
}

function requestGeolocation() {
  setStatus("Obteniendo tu ubicación…");
  if (!navigator.geolocation) {
    onLocationReady(FALLBACK_LOCATION.lat, FALLBACK_LOCATION.lon, { fallback: true });
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => onLocationReady(pos.coords.latitude, pos.coords.longitude),
    (err) => {
      const messages = {
        1: "Permiso de ubicación bloqueado. Revisá los permisos del sitio en tu navegador y tocá 📍 de nuevo.",
        2: "No se pudo determinar tu posición (revisá que el Servicio de Ubicación esté activado en tu SO).",
        3: "Tardó demasiado en responder. Tocá 📍 para reintentar.",
      };
      console.warn("Geolocation error:", err.code, err.message);
      setStatus(messages[err.code] || "No se pudo acceder a tu ubicación", "error");
      onLocationReady(FALLBACK_LOCATION.lat, FALLBACK_LOCATION.lon, { fallback: true });
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
  );
}

// --- Buscador de direcciones (Nominatim) para origen/destino ---
function renderSuggestions(results, targetInput) {
  if (!results.length) {
    el.destSuggestions.classList.add("hidden");
    return;
  }
  el.destSuggestions.classList.remove("hidden");
  el.destSuggestions.innerHTML = results
    .map((r, i) => `<div class="suggestion-item" data-idx="${i}">📍 ${r.display_name}</div>`)
    .join("");

  el.destSuggestions.querySelectorAll(".suggestion-item").forEach((node) => {
    node.addEventListener("click", () => {
      const r = results[Number(node.dataset.idx)];
      const label = r.display_name.split(",").slice(0, 2).join(",");
      const loc = { lat: parseFloat(r.lat), lon: parseFloat(r.lon) };

      if (targetInput === el.originInput) {
        state.originLocation = loc;
        el.originInput.value = label;
      } else {
        state.destLocation = loc;
        el.destInput.value = label;
        placeDestMarker(loc.lat, loc.lon);
        state.map.panTo([loc.lat, loc.lon]);
        loadNearbyPOIs(loc.lat, loc.lon);
      }
      el.destSuggestions.classList.add("hidden");
    });
  });
}

async function searchAddress(rawQuery, targetInput) {
  const token = ++state.addressSearchToken;
  const results = [];

  // Si el texto tiene forma de cruce ("Calle1 y Calle2"), buscamos el punto
  // exacto por geometria real de calles (Nominatim no resuelve esquinas).
  const intersectionParts = parseIntersectionQuery(rawQuery);
  if (intersectionParts) {
    try {
      const point = await findStreetIntersection(intersectionParts[0], intersectionParts[1]);
      if (point) {
        results.push({
          display_name: `🔀 Cruce: ${intersectionParts[0].trim()} y ${intersectionParts[1].trim()}`,
          lat: point.lat,
          lon: point.lon,
        });
      }
    } catch {
      /* si falla, seguimos con la busqueda normal igual */
    }
  }

  try {
    const url = `${NOMINATIM_URL}?format=json&limit=5&countrycodes=uy&viewbox=${MONTEVIDEO_VIEWBOX}&bounded=1&q=${encodeURIComponent(`${rawQuery}, Montevideo, Uruguay`)}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (res.ok) results.push(...(await res.json()));
  } catch {
    /* la busqueda de direcciones puede fallar sin romper un resultado de cruce ya encontrado */
  }

  if (token !== state.addressSearchToken) return;
  renderSuggestions(results, targetInput);
}

let addressDebounce = null;
function wireAddressInput(inputEl) {
  inputEl.addEventListener("focus", () => (state.activeSuggestionInput = inputEl));
  inputEl.addEventListener("input", (e) => {
    state.activeSuggestionInput = inputEl;
    const q = e.target.value.trim();
    clearTimeout(addressDebounce);
    if (q.length < 3) {
      el.destSuggestions.classList.add("hidden");
      return;
    }
    addressDebounce = setTimeout(() => searchAddress(q, inputEl), 400);
  });
}
wireAddressInput(el.originInput);
wireAddressInput(el.destInput);

// --- Puntos de interes cerca del destino (Overpass / OpenStreetMap) ---
function clearPoiMarkers() {
  state.poiMarkers.forEach((m) => state.map.removeLayer(m));
  state.poiMarkers = [];
}

async function loadNearbyPOIs(lat, lon) {
  clearPoiMarkers();

  try {
    const pois = await fetchNearbyPOIs(lat, lon);
    pois.forEach((p) => {
      const icon = L.divIcon({
        className: "",
        html: `<div class="poi-marker">${POI_CATEGORIES[p.category].icon}</div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      });
      const marker = L.marker([p.lat, p.lon], { icon }).bindPopup(p.name);
      marker.addTo(state.map);
      state.poiMarkers.push(marker);
    });
  } catch (e) {
    console.warn("No se pudieron cargar los puntos de interés:", e.message);
  }
}

// --- Ruteo (OpenRouteService) ---
function formatDuration(seconds) {
  const min = Math.round(seconds / 60);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)}h ${min % 60}min`;
}

async function calculateRoute() {
  const key = getOrsKey();
  if (!key) {
    el.routeNoKey.classList.remove("hidden");
    el.routeResult.classList.add("hidden");
    return;
  }
  const origin = state.originLocation || state.userLocation;
  if (!origin || !state.destLocation) {
    setStatus("Elegí un destino de la lista de sugerencias antes de calcular la ruta", "error");
    return;
  }

  el.btnCalcRoute.disabled = true;
  el.btnCalcRoute.textContent = "Calculando…";
  el.routeNoKey.classList.add("hidden");

  try {
    const res = await fetch(`https://api.openrouteservice.org/v2/directions/${ORS_PROFILE}/geojson`, {
      method: "POST",
      headers: {
        Authorization: key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        coordinates: [
          [origin.lon, origin.lat],
          [state.destLocation.lon, state.destLocation.lat],
        ],
      }),
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody?.error?.message || `Error ${res.status}`);
    }
    const geojson = await res.json();

    if (state.routeLayer) state.map.removeLayer(state.routeLayer);
    state.routeLayer = L.geoJSON(geojson, {
      style: { color: "#16a34a", weight: 5, opacity: 0.85 },
    }).addTo(state.map);
    setCardExpanded(false);
    setTimeout(() => state.map.fitBounds(state.routeLayer.getBounds(), { padding: [40, 100] }), 320);

    const summary = geojson.features[0].properties.summary;
    const now = new Date();
    const etaDate = new Date(now.getTime() + summary.duration * 1000);

    el.routeDistance.textContent = `${(summary.distance / 1000).toFixed(1)} km`;
    el.routeDuration.textContent = formatDuration(summary.duration);
    el.routeEta.textContent = etaDate.toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit" });

    if (state.weather) {
      const rainOnTrip = getRainProbabilityForWindow(state.weather, now, summary.duration);
      el.routeRain.textContent = rainOnTrip !== null ? `${rainOnTrip}%` : "s/d";
    } else {
      el.routeRain.textContent = "s/d";
    }

    el.routeResult.classList.remove("hidden");

    stopVoiceNavigation();
    state.navSteps = extractRouteSteps(geojson);
    state.navIndex = 0;
    if ("speechSynthesis" in window) {
      el.voiceNotSupported.classList.add("hidden");
      el.voiceNavControls.classList.remove("hidden");
    } else {
      el.voiceNavControls.classList.add("hidden");
      el.voiceNotSupported.classList.remove("hidden");
    }
  } catch (e) {
    setStatus(`No se pudo calcular la ruta: ${e.message}`, "error");
  } finally {
    el.btnCalcRoute.disabled = false;
    el.btnCalcRoute.textContent = "Calcular ruta";
  }
}

// --- Navegacion por voz (turn-by-turn con GPS real) ---
const NAV_TRIGGER_RADIUS_METERS = 35;

async function requestWakeLock() {
  try {
    if ("wakeLock" in navigator) state.wakeLock = await navigator.wakeLock.request("screen");
  } catch {
    state.wakeLock = null; // no critico: si falla, la navegacion sigue funcionando igual
  }
}

function releaseWakeLock() {
  state.wakeLock?.release?.().catch(() => {});
  state.wakeLock = null;
}

function updateNavDisplay() {
  const next = state.navSteps[state.navIndex];
  el.voiceNextInstruction.textContent = next ? next.instruction : "Llegaste a tu destino 🎉";
  el.voiceNextDistance.textContent = "";
}

function announceStep(index) {
  const step = state.navSteps[index];
  if (step) speak(step.instruction);
}

function finishNavigation() {
  speak("Llegaste a tu destino");
  stopVoiceNavigation();
}

function onNavPosition(pos) {
  if (state.navIndex >= state.navSteps.length) {
    finishNavigation();
    return;
  }
  const step = state.navSteps[state.navIndex];
  const d = haversineMeters(pos.coords.latitude, pos.coords.longitude, step.lat, step.lon);
  el.voiceNextDistance.textContent = `en ${Math.round(d)} m`;

  if (d < NAV_TRIGGER_RADIUS_METERS) {
    announceStep(state.navIndex);
    state.navIndex++;
    if (state.navIndex >= state.navSteps.length) {
      finishNavigation();
    } else {
      updateNavDisplay();
    }
  }
}

function startVoiceNavigation() {
  if (!state.navSteps.length || !navigator.geolocation) return;

  state.isNavigating = true;
  el.voiceNavControls.classList.add("hidden");
  el.voiceNavActive.classList.remove("hidden");
  requestWakeLock();

  announceStep(0);
  state.navIndex = 1;
  updateNavDisplay();

  state.navWatchId = navigator.geolocation.watchPosition(onNavPosition, () => {}, {
    enableHighAccuracy: true,
    maximumAge: 5000,
  });
}

function stopVoiceNavigation() {
  if (state.navWatchId !== null) navigator.geolocation.clearWatch(state.navWatchId);
  state.navWatchId = null;
  state.isNavigating = false;
  releaseWakeLock();
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  el.voiceNavActive.classList.add("hidden");
  if (state.navSteps.length) el.voiceNavControls.classList.remove("hidden");
}

el.btnStartNav.addEventListener("click", startVoiceNavigation);
el.btnStopNav.addEventListener("click", stopVoiceNavigation);

// --- Selector de vehiculo ---
el.vehicleBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    el.vehicleBtns.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.vehicle = btn.dataset.vehicle;
    renderWeather();
  });
});

// --- Settings (API key de OpenRouteService) ---
function openSettings() {
  el.orsKeyInput.value = getOrsKey();
  el.keyStatus.textContent = "";
  el.settingsSheet.classList.remove("hidden");
}
el.btnSettings.addEventListener("click", openSettings);
el.btnCloseSettings.addEventListener("click", () => el.settingsSheet.classList.add("hidden"));
el.btnSaveKey.addEventListener("click", () => {
  const key = el.orsKeyInput.value.trim();
  if (key) {
    localStorage.setItem(ORS_KEY_STORAGE, key);
    el.keyStatus.textContent = "Guardada ✓ — ya podés calcular rutas";
    el.routeNoKey.classList.add("hidden");
  } else {
    localStorage.removeItem(ORS_KEY_STORAGE);
    el.keyStatus.textContent = "Se borró la key guardada";
  }
});

el.btnLocate.addEventListener("click", requestGeolocation);
el.btnCalcRoute.addEventListener("click", calculateRoute);

document.addEventListener("click", (e) => {
  if (!e.target.closest(".route-field")) el.destSuggestions.classList.add("hidden");
});

if (!getOrsKey()) el.routeNoKey.classList.remove("hidden");

requestGeolocation();
