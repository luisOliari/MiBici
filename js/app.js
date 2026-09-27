// Centro de Montevideo (Plaza Independencia) como fallback si no hay permiso de ubicacion.
const FALLBACK_LOCATION = { lat: -34.9058, lon: -56.1913 };
const MONTEVIDEO_VIEWBOX = "-56.42,-34.70,-55.95,-34.95"; // left,top,right,bottom
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const NOMINATIM_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse";
const ORS_KEY_STORAGE = "mibici_ors_key";

// Perfil de ruteo de OpenRouteService: no existe un perfil especifico de
// "monopatin", asi que usamos el mismo perfil ciclista (prioriza ciclovias
// y calles tranquilas) para bici y monopatin.
const ORS_PROFILE = "cycling-regular";

// Colores de la linea de ruta (ver DESIGN.md: route / route-casing / route-done)
const ROUTE_COLOR = "#16a34a";
const ROUTE_CASING = "#0b5d2a";
const ROUTE_DONE = "#9ca3af";

const state = {
  userLocation: null,
  userAccuracy: null,
  originLocation: null, // si el usuario elige un origen distinto al GPS
  destLocation: null,
  destLabel: "",
  destMode: "address", // "address" | "corner"
  vehicle: "bici",
  weather: null,
  airQuality: null,
  map: null,
  userMarker: null,
  destMarker: null,
  routeLayers: null, // { casing, line, done, turns }
  poiMarkers: [],
  cyclewaysLayer: null,
  cyclewaysVisible: false,
  activeSuggestionInput: null,
  addressSearchToken: 0,
  route: null, // { vertices, cumDist, total, duration, steps }
  nav: null, // estado de la navegacion en curso (ver startNavigation)
  wakeLock: null,
  isNavigating: false,
  cardExpanded: false,
  sheetMode: "collapsed",
  liveWatchId: null,
  trailLayer: null,
  lastTrailPoint: null,
  permissionErrorShown: false,
  lastFixAt: null,
  gpsStaleAnnounced: false,
};

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const $ = (id) => document.getElementById(id);
const el = {
  app: $("app"),
  statusBanner: $("statusBanner"),
  weatherCard: $("weatherCard"),
  cardHandle: $("cardHandle"),
  btnLocate: $("btnLocate"),
  btnSettings: $("btnSettings"),
  vehicleBtns: document.querySelectorAll(".vehicle-btn"),
  modeBtns: document.querySelectorAll(".mode-btn"),
  weatherIcon: $("weatherIcon"),
  weatherTemp: $("weatherTemp"),
  weatherVerdict: $("weatherVerdict"),
  verdictLabel: $("verdictLabel"),
  verdictVehicle: $("verdictVehicle"),
  weatherWind: $("weatherWind"),
  weatherRain: $("weatherRain"),
  weatherFeelsLike: $("weatherFeelsLike"),
  weatherHumidity: $("weatherHumidity"),
  weatherGusts: $("weatherGusts"),
  weatherUv: $("weatherUv"),
  weatherSunrise: $("weatherSunrise"),
  weatherSunset: $("weatherSunset"),
  weatherAqi: $("weatherAqi"),
  daylightNote: $("daylightNote"),
  originInput: $("originInput"),
  destInput: $("destInput"),
  btnClearDest: $("btnClearDest"),
  addressMode: $("addressMode"),
  cornerMode: $("cornerMode"),
  cornerStreetA: $("cornerStreetA"),
  cornerStreetB: $("cornerStreetB"),
  destSuggestions: $("destSuggestions"),
  btnCalcRoute: $("btnCalcRoute"),
  routeResult: $("routeResult"),
  routeDistance: $("routeDistance"),
  routeDuration: $("routeDuration"),
  routeEta: $("routeEta"),
  routeVia: $("routeVia"),
  routeRain: $("routeRain"),
  routeWind: $("routeWind"),
  routeElevation: $("routeElevation"),
  stepList: $("stepList"),
  routeOptions: $("routeOptions"),
  routeNoKey: $("routeNoKey"),
  btnToggleLanes: $("btnToggleLanes"),
  gpsStatus: $("gpsStatus"),
  voiceNavControls: $("voiceNavControls"),
  btnStartNav: $("btnStartNav"),
  voiceNotSupported: $("voiceNotSupported"),
  navBanner: $("navBanner"),
  navArrow: $("navArrow"),
  navDistance: $("navDistance"),
  navInstruction: $("navInstruction"),
  navThen: $("navThen"),
  navFooter: $("navFooter"),
  navEta: $("navEta"),
  navRemainingTime: $("navRemainingTime"),
  navRemainingDist: $("navRemainingDist"),
  btnMute: $("btnMute"),
  btnStopNav: $("btnStopNav"),
  settingsSheet: $("settingsSheet"),
  btnCloseSettings: $("btnCloseSettings"),
  orsKeyInput: $("orsKeyInput"),
  btnSaveKey: $("btnSaveKey"),
  keyStatus: $("keyStatus"),
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

let statusTimer = null;
function setStatus(message, kind, { autoHideMs } = {}) {
  clearTimeout(statusTimer);
  if (!message) {
    el.statusBanner.classList.add("hidden");
    return;
  }
  el.statusBanner.classList.remove("hidden");
  el.statusBanner.textContent = message;
  el.statusBanner.classList.toggle("error", kind === "error");
  if (autoHideMs) statusTimer = setTimeout(() => setStatus(null), autoHideMs);
}

function getOrsKey() {
  return localStorage.getItem(ORS_KEY_STORAGE) || "";
}

// --- Tarjeta plegable (bottom sheet) con 3 alturas ---
// collapsed: solo el buscador · preview: resumen de la ruta + "Iniciar"
// (el mapa muestra el trayecto) · expanded: todo (formulario, pasos, clima).
function setSheetMode(mode) {
  if (state.sheetMode === mode) return;
  state.sheetMode = mode;
  state.cardExpanded = mode === "expanded";
  el.weatherCard.classList.toggle("collapsed", mode === "collapsed");
  el.weatherCard.classList.toggle("preview", mode === "preview");
  // Leaflet cachea el tamaño de su contenedor: hay que avisarle cuando cambia.
  setTimeout(() => state.map?.invalidateSize(), 300);
}
function setCardExpanded(expanded) {
  setSheetMode(expanded ? "expanded" : state.route ? "preview" : "collapsed");
}
el.cardHandle.addEventListener("click", (e) => {
  e.stopPropagation();
  setCardExpanded(!state.cardExpanded);
});
el.weatherCard.addEventListener("focusin", (e) => {
  if (e.target.matches("input")) setCardExpanded(true);
});

// --- Mapa ---
function initMap(lat, lon) {
  state.map = L.map("map", { zoomControl: false }).setView([lat, lon], 15);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
    maxZoom: 19,
  }).addTo(state.map);

  // Estela del recorrido real (se va dibujando con tu posicion en vivo).
  state.trailLayer = L.polyline([], { color: "#1a73e8", weight: 3, opacity: 0.45, dashArray: "2 6" }).addTo(state.map);

  // Mantener apretado (o clic derecho en PC) = elegir ese punto como destino.
  state.map.on("contextmenu", (e) => {
    if (state.isNavigating) return;
    setDestinationFromMap(e.latlng.lat, e.latlng.lng);
  });

  // Si movés el mapa con el dedo durante la navegacion, dejamos de seguirte
  // un rato (como Waze) para que puedas mirar; ◎ vuelve a centrar.
  state.map.on("dragstart", () => {
    if (state.nav) state.nav.followPausedUntil = Date.now() + 12000;
  });
}

function placeUserMarker(lat, lon) {
  const icon = L.divIcon({ className: "", html: '<div class="user-dot"></div>', iconSize: [20, 20] });
  if (state.userMarker) state.userMarker.setLatLng([lat, lon]);
  else state.userMarker = L.marker([lat, lon], { icon, zIndexOffset: 1000 }).addTo(state.map);
}

function placeDestMarker(lat, lon) {
  // El pin es un cuadrado rotado -45deg (truco clasico de "gota" con CSS).
  // La punta filosa, despues de rotar, queda en centro + media diagonal: ese
  // es el iconAnchor exacto para que el pin caiga justo en la esquina.
  const icon = L.divIcon({ className: "", html: '<div class="dest-pin"></div>', iconSize: [26, 26], iconAnchor: [13, 31] });
  if (state.destMarker) state.destMarker.setLatLng([lat, lon]);
  else state.destMarker = L.marker([lat, lon], { icon, zIndexOffset: 900 }).addTo(state.map);
}

function setDestination(loc, label) {
  state.destLocation = { lat: loc.lat, lon: loc.lon };
  state.destLabel = label || "";
  placeDestMarker(loc.lat, loc.lon);
  state.map.panTo([loc.lat, loc.lon]);
  loadNearbyPOIs(loc.lat, loc.lon);
  el.btnClearDest.classList.toggle("hidden", !el.destInput.value);
}

async function setDestinationFromMap(lat, lon) {
  setDestModeUI("address");
  el.destInput.value = "Punto elegido en el mapa";
  setDestination({ lat, lon }, "el punto elegido");
  setCardExpanded(true);
  const label = await reverseGeocode(lat, lon);
  if (label && state.destLocation?.lat === lat) {
    el.destInput.value = label;
    state.destLabel = label;
  }
}

async function reverseGeocode(lat, lon) {
  try {
    const res = await fetch(`${NOMINATIM_REVERSE_URL}?format=json&zoom=18&addressdetails=1&lat=${lat}&lon=${lon}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const a = (await res.json()).address || {};
    const street = [a.road, a.house_number].filter(Boolean).join(" ");
    return [street, a.suburb || a.neighbourhood].filter(Boolean).join(", ") || null;
  } catch {
    return null;
  }
}

// --- Clima ---
async function loadWeather(lat, lon) {
  el.weatherIcon.textContent = "⏳";
  el.verdictLabel.textContent = "Consultando clima…";
  el.weatherVerdict.className = "weather-verdict verdict-loading";
  try {
    state.weather = await fetchWeather(lat, lon);
    renderWeather();
  } catch {
    el.verdictLabel.textContent = "No se pudo obtener el clima";
    el.weatherVerdict.className = "weather-verdict verdict-warn";
  }

  try {
    state.airQuality = await fetchAirQuality(lat, lon);
    renderAirQuality();
  } catch {
    el.weatherAqi.textContent = "s/d";
  }
}

function renderAirQuality() {
  const aq = airQualityLabel(state.airQuality?.europeanAqi);
  el.weatherAqi.textContent = aq.text;
  el.weatherAqi.className = `weather-stat-value aqi-${aq.level}`;
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

  el.weatherFeelsLike.textContent = w.apparentTemperature != null ? `${Math.round(w.apparentTemperature)}°` : "—";
  el.weatherHumidity.textContent = w.humidity != null ? `${w.humidity}%` : "—";
  el.weatherGusts.textContent = w.windGusts != null ? `${Math.round(w.windGusts)} km/h` : "—";
  el.weatherUv.textContent = w.uvIndexMax != null ? w.uvIndexMax.toFixed(1) : "—";
  el.weatherSunrise.textContent = w.sunrise || "—";
  el.weatherSunset.textContent = w.sunset || "—";

  updateDaylightNote();
}

// Avisa si ahora mismo (o la llegada estimada de una ruta calculada) cae
// cerca o despues de la puesta de sol — relevante para andar seguro en bici.
function updateDaylightNote(tripEtaDate) {
  if (!state.weather?.sunsetDate) {
    el.daylightNote.classList.add("hidden");
    return;
  }
  const checkDate = tripEtaDate || new Date();
  const isDark = checkDate.getTime() >= state.weather.sunsetDate.getTime() - 20 * 60 * 1000;
  el.daylightNote.classList.toggle("hidden", !isDark);
}

// --- Geolocalizacion ---
const TRAIL_MIN_MOVE_METERS = 8; // no agregar puntos a la estela si estas practicamente quieto

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

  if (!fallback) startLiveTracking();
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
        1: "Permiso de ubicación bloqueado. Revisá los permisos del sitio en tu navegador y tocá ◎ de nuevo.",
        2: "No se pudo determinar tu posición (revisá que el Servicio de Ubicación esté activado).",
        3: "Tardó demasiado en responder. Tocá ◎ para reintentar.",
      };
      console.warn("Geolocation error:", err.code, err.message);
      if (!state.map) onLocationReady(FALLBACK_LOCATION.lat, FALLBACK_LOCATION.lon, { fallback: true });
      setStatus(messages[err.code] || "No se pudo acceder a tu ubicación", "error");
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
  );
}

// Seguimiento CONTINUO de posicion (como Waze). iOS Safari corta en silencio
// el watchPosition despues de un rato; hay un "vigia" que lo reinicia solo.
const GPS_STALE_MS = 12000; // si no llega una posicion nueva en este tiempo, se considera "cortado"
const GPS_ANNOUNCE_STALE_MS = 20000; // recien a partir de aca avisamos por voz

function startLiveTracking() {
  if (state.liveWatchId !== null || !navigator.geolocation) return;

  state.liveWatchId = navigator.geolocation.watchPosition(
    (pos) => onLiveLocation(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy),
    (err) => {
      console.warn("Live tracking error:", err.code, err.message);
      if (err.code === 1 && !state.permissionErrorShown) {
        state.permissionErrorShown = true;
        setStatus("Se perdió el permiso de ubicación en tiempo real — revisalo en Ajustes", "error");
      }
    },
    { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 }
  );
}

function restartLiveTracking() {
  if (state.liveWatchId !== null) {
    navigator.geolocation.clearWatch(state.liveWatchId);
    state.liveWatchId = null;
  }
  startLiveTracking();
  navigator.geolocation.getCurrentPosition(
    (pos) => onLiveLocation(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy),
    () => {},
    { enableHighAccuracy: true, maximumAge: 4000, timeout: 15000 }
  );
}

function onLiveLocation(lat, lon, accuracy) {
  state.userLocation = { lat, lon };
  state.userAccuracy = accuracy ?? null;
  state.lastFixAt = Date.now();
  state.gpsStaleAnnounced = false;
  updateGpsStatusBadge();
  if (!state.map) return;
  placeUserMarker(lat, lon);

  if (!state.lastTrailPoint || haversineMeters(state.lastTrailPoint[0], state.lastTrailPoint[1], lat, lon) >= TRAIL_MIN_MOVE_METERS) {
    state.trailLayer?.addLatLng([lat, lon]);
    state.lastTrailPoint = [lat, lon];
  }

  if (state.isNavigating) {
    if (Date.now() > (state.nav?.followPausedUntil || 0)) state.map.panTo([lat, lon], { animate: true });
    updateNavProgress(lat, lon);
  }
}

function updateGpsStatusBadge() {
  if (!el.gpsStatus) return;
  if (!state.lastFixAt) {
    el.gpsStatus.textContent = "Sin señal";
    el.gpsStatus.className = "floating-pill gps-status warn";
    return;
  }
  const secs = Math.round((Date.now() - state.lastFixAt) / 1000);
  const stale = Date.now() - state.lastFixAt > GPS_STALE_MS;
  el.gpsStatus.textContent = stale ? `Sin señal hace ${secs}s` : "GPS en vivo";
  el.gpsStatus.className = `floating-pill gps-status ${stale ? "warn" : "ok"}`;
}

setInterval(() => {
  updateGpsStatusBadge();
  if (!state.lastFixAt) return;
  const staleFor = Date.now() - state.lastFixAt;

  if (staleFor > GPS_STALE_MS) restartLiveTracking();
  if (state.isNavigating && staleFor > GPS_ANNOUNCE_STALE_MS && !state.gpsStaleAnnounced) {
    state.gpsStaleAnnounced = true;
    speak("Buscando señal de GPS");
  }
}, 4000);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    restartLiveTracking();
    if (state.isNavigating) requestWakeLock(); // el wake lock se suelta al salir de la app
  }
});

// ---------------------------------------------------------------------------
// Buscador de destino: direccion libre, "Calle y Calle", o modo Esquina con
// dos campos. Cada sugerencia es {icon, title, sub, lat, lon}.
// ---------------------------------------------------------------------------
function setDestModeUI(mode) {
  state.destMode = mode;
  el.modeBtns.forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
  el.addressMode.classList.toggle("hidden", mode !== "address");
  el.cornerMode.classList.toggle("hidden", mode !== "corner");
  hideSuggestions();
}
el.modeBtns.forEach((btn) =>
  btn.addEventListener("click", () => {
    setDestModeUI(btn.dataset.mode);
    state.destLocation = null;
    (btn.dataset.mode === "corner" ? el.cornerStreetA : el.destInput).focus();
  })
);

function hideSuggestions() {
  el.destSuggestions.classList.add("hidden");
  el.destSuggestions.innerHTML = "";
}

function renderSuggestions(items, targetInput, emptyMessage) {
  if (!items.length) {
    if (!emptyMessage) return hideSuggestions();
    el.destSuggestions.innerHTML = `<div class="suggestion-empty">${escapeHtml(emptyMessage)}</div>`;
    el.destSuggestions.classList.remove("hidden");
    return;
  }
  el.destSuggestions.classList.remove("hidden");
  el.destSuggestions.innerHTML = items
    .map(
      (r, i) => `<div class="suggestion-item" data-idx="${i}">
        <span class="suggestion-icon">${r.icon}</span>
        <div><div class="suggestion-title">${escapeHtml(r.title)}</div>${r.sub ? `<div class="suggestion-sub">${escapeHtml(r.sub)}</div>` : ""}</div>
      </div>`
    )
    .join("");

  el.destSuggestions.querySelectorAll(".suggestion-item").forEach((node) => {
    node.addEventListener("click", () => {
      const r = items[Number(node.dataset.idx)];
      const loc = { lat: r.lat, lon: r.lon };
      if (targetInput === el.originInput) {
        state.originLocation = loc;
        el.originInput.value = r.title;
      } else {
        if (targetInput === el.destInput) el.destInput.value = r.title;
        setDestination(loc, r.title);
      }
      hideSuggestions();
    });
  });
}

function nominatimToSuggestion(r) {
  const a = r.address || {};
  const street = [a.road, a.house_number].filter(Boolean).join(" ");
  const title = r.name && r.name !== a.road ? r.name : street || r.display_name.split(",")[0];
  const sub = [r.name && street && r.name !== a.road ? street : "", a.suburb || a.neighbourhood || a.city_district].filter(Boolean).join(" · ");
  return { icon: "📍", title, sub, lat: parseFloat(r.lat), lon: parseFloat(r.lon) };
}

function cornerToSuggestion(c) {
  const sub = ["Esquina", c.barrio, c.distance != null ? `a ${formatDistance(c.distance)} de vos` : ""].filter(Boolean).join(" · ");
  return { icon: "🔀", title: c.label, sub, lat: c.lat, lon: c.lon };
}

async function nominatimSearch(query, limit = 6) {
  const url = `${NOMINATIM_URL}?format=json&addressdetails=1&limit=${limit}&countrycodes=uy&viewbox=${MONTEVIDEO_VIEWBOX}&bounded=1&q=${encodeURIComponent(`${query}, Montevideo`)}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  return res.ok ? await res.json() : [];
}

async function searchAddress(rawQuery, targetInput) {
  const token = ++state.addressSearchToken;
  const results = [];
  const near = state.userLocation;

  // "Calle1 y Calle2": buscamos el punto exacto por geometria real de calles.
  const parts = parseIntersectionQuery(rawQuery);
  if (parts) {
    const corners = await findCornersFromText(rawQuery, near);
    results.push(...corners.map(cornerToSuggestion));
  }
  if (token !== state.addressSearchToken) return;

  try {
    const data = await nominatimSearch(rawQuery);
    results.push(...data.map(nominatimToSuggestion));
  } catch {
    /* la busqueda de direcciones puede fallar sin romper un cruce ya encontrado */
  }

  if (token !== state.addressSearchToken) return;
  renderSuggestions(results, targetInput, parts ? "No encontré ese cruce. Revisá los nombres de las calles." : "Sin resultados");
}

async function searchCorner() {
  const a = el.cornerStreetA.value.trim();
  const b = el.cornerStreetB.value.trim();
  state.destLocation = null;
  if (a.length < 2 || b.length < 2) return hideSuggestions();

  const token = ++state.addressSearchToken;
  renderSuggestions([], el.cornerStreetB, "Buscando la esquina…");
  const corners = await findStreetIntersections(a, b, state.userLocation).catch(() => []);
  if (token !== state.addressSearchToken) return;

  if (corners.length === 1) {
    // Una sola esquina posible: la elegimos directo, sin hacerte tocar nada.
    setDestination(corners[0], corners[0].label);
    renderSuggestions([cornerToSuggestion(corners[0])], el.cornerStreetB);
  } else {
    renderSuggestions(corners.map(cornerToSuggestion), el.cornerStreetB, `No encontré el cruce de "${a}" y "${b}". Revisá los nombres.`);
  }
}

let addressDebounce = null;
function wireAddressInput(inputEl) {
  inputEl.addEventListener("focus", () => (state.activeSuggestionInput = inputEl));
  inputEl.addEventListener("input", (e) => {
    state.activeSuggestionInput = inputEl;
    // El texto ya no corresponde a la ubicacion elegida antes: la invalidamos.
    if (inputEl === el.originInput) state.originLocation = null;
    else state.destLocation = null;
    if (inputEl === el.destInput) el.btnClearDest.classList.toggle("hidden", !inputEl.value);

    const q = e.target.value.trim();
    clearTimeout(addressDebounce);
    if (q.length < 3) return hideSuggestions();
    addressDebounce = setTimeout(() => searchAddress(q, inputEl), 450);
  });
}
wireAddressInput(el.originInput);
wireAddressInput(el.destInput);

[el.cornerStreetA, el.cornerStreetB].forEach((input) => {
  input.addEventListener("input", () => {
    clearTimeout(addressDebounce);
    addressDebounce = setTimeout(searchCorner, 600);
  });
});
el.cornerStreetA.addEventListener("keydown", (e) => {
  if (e.key === "Enter") el.cornerStreetB.focus();
});
[el.destInput, el.cornerStreetB].forEach((i) =>
  i.addEventListener("keydown", (e) => {
    if (e.key === "Enter") calculateRoute();
  })
);

el.btnClearDest.addEventListener("click", () => {
  el.destInput.value = "";
  state.destLocation = null;
  el.btnClearDest.classList.add("hidden");
  hideSuggestions();
  el.destInput.focus();
});

// --- Puntos de interes cerca del destino (Overpass / OpenStreetMap) ---
function clearPoiMarkers() {
  state.poiMarkers.forEach((m) => state.map.removeLayer(m));
  state.poiMarkers = [];
}

async function loadNearbyPOIs(lat, lon, attempt = 1) {
  clearPoiMarkers();

  try {
    const pois = await fetchNearbyPOIs(lat, lon);
    pois.forEach((p) => {
      const icon = L.divIcon({
        className: "",
        html: `<div class="poi-marker">${POI_CATEGORIES[p.category].icon}</div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });
      const marker = L.marker([p.lat, p.lon], { icon })
        .bindTooltip(p.name, { direction: "top", offset: [0, -12] })
        .bindPopup(p.name);
      marker.addTo(state.map);
      state.poiMarkers.push(marker);
    });
  } catch (e) {
    console.warn(`No se pudieron cargar los puntos de interés (intento ${attempt}):`, e.message);
    if (attempt < 3) setTimeout(() => loadNearbyPOIs(lat, lon, attempt + 1), 3000 * attempt);
  }
}

// --- Ciclovias reales sobre el mapa (bajo demanda, area visible) ---
async function toggleCycleways() {
  if (state.cyclewaysVisible) {
    if (state.cyclewaysLayer) state.map.removeLayer(state.cyclewaysLayer);
    state.cyclewaysLayer = null;
    state.cyclewaysVisible = false;
    el.btnToggleLanes.classList.remove("active");
    el.btnToggleLanes.textContent = "🚴 Ver ciclovías";
    return;
  }

  el.btnToggleLanes.textContent = "Cargando…";
  try {
    const ways = await fetchCycleways(state.map.getBounds());
    state.cyclewaysLayer = L.layerGroup(
      ways.map((w) =>
        L.polyline(
          w.geometry.map((p) => [p.lat, p.lon]),
          { color: "#1a73e8", weight: 4, opacity: 0.7, dashArray: "1 8", lineCap: "round" }
        )
      )
    ).addTo(state.map);
    state.cyclewaysVisible = true;
    el.btnToggleLanes.classList.add("active");
    el.btnToggleLanes.textContent = ways.length ? "🚴 Ciclovías" : "🚴 Sin datos acá";
  } catch {
    el.btnToggleLanes.textContent = "🚴 Ver ciclovías";
    setStatus("No se pudieron cargar las ciclovías ahora — probá de nuevo", "error", { autoHideMs: 5000 });
  }
}
el.btnToggleLanes.addEventListener("click", toggleCycleways);

// ---------------------------------------------------------------------------
// Ruteo (OpenRouteService)
// ---------------------------------------------------------------------------
function formatDuration(seconds) {
  const min = Math.max(1, Math.round(seconds / 60));
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
}
function formatDistance(m) {
  return m >= 1000 ? `${(m / 1000).toFixed(1).replace(".", ",")} km` : `${Math.round(m / 10) * 10} m`;
}
function formatClock(date) {
  return date.toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

// Si el usuario escribio algo pero no toco ninguna sugerencia, igual
// intentamos resolverlo al tocar "Calcular ruta".
async function resolveTypedDestination() {
  if (state.destMode === "corner") {
    const a = el.cornerStreetA.value.trim();
    const b = el.cornerStreetB.value.trim();
    if (!a || !b) return { error: "Completá las dos calles de la esquina" };
    const c = await findStreetIntersection(a, b, state.userLocation).catch(() => null);
    return c ? { loc: c, label: c.label } : { error: `No encontré la esquina de ${a} y ${b}` };
  }
  const text = el.destInput.value.trim();
  if (!text) return { error: "Escribí a dónde vas antes de calcular la ruta" };
  if (parseIntersectionQuery(text)) {
    const [c] = await findCornersFromText(text, state.userLocation);
    if (c) return { loc: c, label: c.label };
  }
  const data = await nominatimSearch(text, 1).catch(() => []);
  if (data[0]) {
    const s = nominatimToSuggestion(data[0]);
    return { loc: s, label: s.title };
  }
  return { error: "No encontré esa dirección — probá elegir una de las sugerencias" };
}

async function fetchOrsRoute(origin, dest, key, { alternatives = false } = {}) {
  const body = {
    coordinates: [
      [origin.lon, origin.lat],
      [dest.lon, dest.lat],
    ],
    elevation: true,
    language: "es", // sin esto, las instrucciones de voz vienen en ingles
    instructions: true,
    extra_info: ["waytype"], // por que tipo de calle va cada tramo (para estimar transito)
  };
  // Hasta 3 opciones distintas (que compartan como mucho 60% del recorrido y
  // no sean mas de 60% mas largas que la mejor).
  if (alternatives) body.alternative_routes = { target_count: 3, share_factor: 0.6, weight_factor: 1.6 };

  const res = await fetch(`https://api.openrouteservice.org/v2/directions/${ORS_PROFILE}/geojson`, {
    method: "POST",
    headers: { Authorization: key, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    // Las alternativas tienen limites (ej. viajes muy largos): si falla, pedimos una sola.
    if (alternatives) return fetchOrsRoute(origin, dest, key);
    throw new Error(errBody?.error?.message || `Error ${res.status}`);
  }
  return res.json();
}

// Tipos de calle de ORS (extra_info waytype): 1 ruta nacional, 2 avenida/calle
// principal, 3 calle comun, 4 sendero, 5 camino rural, 6 ciclovia, 7 peatonal...
const WAYTYPE_BUSY = new Set([1, 2]);
const WAYTYPE_CYCLEWAY = 6;

// No hay datos publicos de transito EN VIVO para Montevideo, asi que lo
// estimamos por el tipo de calle: cuanto del recorrido va por avenidas o
// rutas (mucho auto) vs calles comunes y ciclovias (tranquilo).
function trafficStats(feature) {
  const summary = feature.properties.extras?.waytypes?.summary || [];
  let busy = 0, cycleway = 0;
  summary.forEach((s) => {
    if (WAYTYPE_BUSY.has(s.value)) busy += s.amount;
    if (s.value === WAYTYPE_CYCLEWAY) cycleway += s.amount;
  });
  const busyShare = summary.length ? busy / 100 : null;
  const level = busyShare == null ? "sd" : busyShare < 0.15 ? "bajo" : busyShare < 0.4 ? "medio" : "alto";
  return { busyShare, cyclewayShare: cycleway / 100, level };
}

// Prepara la ruta para navegar: vertices, distancia acumulada y pasos.
function buildRouteModel(feature) {
  const vertices = feature.geometry.coordinates.map((c) => [c[1], c[0]]);
  const cumDist = [0];
  for (let i = 1; i < vertices.length; i++) {
    cumDist.push(cumDist[i - 1] + haversineMeters(vertices[i - 1][0], vertices[i - 1][1], vertices[i][0], vertices[i][1]));
  }
  const steps = extractRouteSteps(feature);
  steps.forEach((s) => (s.cumDist = cumDist[s.vertexIndex] ?? 0));
  const c = feature.geometry.coordinates;
  let ascent = null;
  if (c[0]?.length === 3) {
    ascent = 0;
    for (let i = 1; i < c.length; i++) ascent += Math.max(0, c[i][2] - c[i - 1][2]);
  }
  return {
    vertices,
    cumDist,
    total: cumDist[cumDist.length - 1],
    duration: feature.properties.summary.duration,
    steps,
    ascent,
    traffic: trafficStats(feature),
    tags: [],
  };
}

// Etiquetas de cada opcion y cual recomendamos: la que mejor combina tiempo
// y tranquilidad (cada 10% del recorrido por avenidas "cuesta" como 8% mas de tiempo).
function rankRoutes(routes) {
  const cost = (r) => r.duration * (1 + 0.8 * (r.traffic.busyShare ?? 0));
  const minBy = (f) => routes.reduce((best, r) => (f(r) < f(best) ? r : best), routes[0]);
  const recommended = minBy(cost);
  const fastest = minBy((r) => r.duration);
  const calmest = minBy((r) => r.traffic.busyShare ?? 1);
  const flattest = minBy((r) => r.ascent ?? 0);
  routes.forEach((r) => {
    r.tags = [];
    if (routes.length < 2) return;
    if (r === recommended) r.tags.push("Recomendada");
    if (r === fastest) r.tags.push("Más rápida");
    if (r === calmest && r.traffic.busyShare != null) r.tags.push("Menos tránsito");
    if (r === flattest && r.ascent != null && r !== fastest) r.tags.push("Menos subida");
  });
  return routes.indexOf(recommended);
}

// Linea de ruta estilo Waze: borde oscuro + linea verde encima, y lo ya
// recorrido se va pintando en gris. Circulitos con flecha en cada giro.
function drawRoute(route) {
  clearRouteLayers();
  // Las otras opciones en gris debajo; tocandolas se eligen.
  const alts = L.layerGroup(
    (state.routes || [])
      .filter((r) => r !== route && !state.isNavigating)
      .map((r) =>
        L.polyline(r.vertices, { color: "#8a8a8a", weight: 8, opacity: 0.75, lineCap: "round", lineJoin: "round" }).on("click", (e) => {
          L.DomEvent.stopPropagation(e);
          selectRoute(state.routes.indexOf(r));
        })
      )
  );
  alts.addTo(state.map);
  const latlngs = route.vertices;
  const casing = L.polyline(latlngs, { color: ROUTE_CASING, weight: 11, opacity: 0.95, lineCap: "round", lineJoin: "round" });
  const line = L.polyline(latlngs, { color: ROUTE_COLOR, weight: 7, opacity: 1, lineCap: "round", lineJoin: "round" });
  const done = L.polyline([], { color: ROUTE_DONE, weight: 7, opacity: 1, lineCap: "round", lineJoin: "round" });
  const turns = L.layerGroup(
    route.steps
      .filter((s) => s.type !== 11 && s.type !== 10 && s.type !== 6)
      .map((s) =>
        L.marker([s.lat, s.lon], {
          icon: L.divIcon({ className: "", html: `<div class="turn-marker">${maneuverOf(s).arrow}</div>`, iconSize: [20, 20] }),
          interactive: false,
        })
      )
  );
  state.routeLayers = { alts, casing, line, done, turns };
  [casing, line, done, turns].forEach((l) => l.addTo(state.map));
  state.userMarker?.setZIndexOffset(1000);
}

function clearRouteLayers() {
  if (!state.routeLayers) return;
  Object.values(state.routeLayers).forEach((l) => state.map.removeLayer(l));
  state.routeLayers = null;
}

// "Por Julio César, Av. Italia y Bv. Artigas" — las calles donde mas se anda.
function describeVia(steps) {
  const byStreet = new Map();
  steps.forEach((s, i) => {
    if (!s.streetName) return;
    const prev = byStreet.get(s.streetName) || { d: 0, first: i };
    prev.d += s.distanceMeters || 0;
    byStreet.set(s.streetName, prev);
  });
  const main = [...byStreet.entries()]
    .filter(([, v]) => v.d >= 150)
    .sort((a, b) => b[1].d - a[1].d)
    .slice(0, 4)
    .sort((a, b) => a[1].first - b[1].first)
    .map(([name]) => name);
  if (!main.length) return "";
  const list = main.length > 1 ? `${main.slice(0, -1).join(", ")} y ${main[main.length - 1]}` : main[0];
  return `Por ${list}`;
}

function renderStepList(steps, currentIndex = 0) {
  el.stepList.innerHTML = steps
    .map(
      (s, i) => `<li class="${i < currentIndex ? "done" : ""}">
        <span class="step-arrow">${maneuverOf(s).arrow}</span>
        <span class="step-text">${escapeHtml(s.instruction)}</span>
        ${s.distanceMeters > 0 && s.type !== 10 ? `<span class="step-dist">${formatDistance(s.distanceMeters)}</span>` : ""}
      </li>`
    )
    .join("");
}

async function calculateRoute({ fromHere = false, reroute = false } = {}) {
  const key = getOrsKey();
  if (!key) {
    el.routeNoKey.classList.remove("hidden");
    el.routeResult.classList.add("hidden");
    setCardExpanded(true);
    return false;
  }
  const origin = fromHere ? state.userLocation : state.originLocation || state.userLocation;
  if (!origin) {
    setStatus("No pude determinar tu ubicación de origen", "error");
    return false;
  }

  if (!state.destLocation) {
    setStatus("Buscando esa dirección…");
    const r = await resolveTypedDestination();
    if (r.error) {
      setStatus(r.error, "error", { autoHideMs: 6000 });
      return false;
    }
    setDestination(r.loc, r.label);
    setStatus(null);
  }

  if (!reroute) {
    el.btnCalcRoute.disabled = true;
    el.btnCalcRoute.textContent = "Calculando…";
  }
  el.routeNoKey.classList.add("hidden");
  hideSuggestions();

  try {
    const geojson = await fetchOrsRoute(origin, state.destLocation, key, { alternatives: !reroute });
    const routes = geojson.features.map(buildRouteModel);
    const best = rankRoutes(routes);
    state.routes = routes;
    state.routeOrigin = origin;

    if (reroute) {
      state.route = routes[0];
      drawRoute(routes[0]);
      return true; // en navegacion no tocamos la tarjeta ni la camara
    }

    // Arranca una estela nueva y limpia para este viaje.
    state.trailLayer?.setLatLngs([]);
    state.lastTrailPoint = null;

    stopNavigation({ silent: true });
    selectRoute(best);
    el.routeResult.classList.remove("hidden");

    const voiceOk = "speechSynthesis" in window;
    el.voiceNavControls.classList.toggle("hidden", !voiceOk);
    el.voiceNotSupported.classList.toggle("hidden", voiceOk);

    // Vista previa tipo Waze: el mapa muestra todas las opciones y abajo
    // quedan las tarjetas para elegir + "Iniciar".
    document.activeElement?.blur();
    setSheetMode("preview");
    setTimeout(() => {
      state.map.invalidateSize();
      const bounds = L.latLngBounds(routes.flatMap((r) => r.vertices));
      state.map.fitBounds(bounds, { padding: [40, 40] });
      el.weatherCard.scrollTop = 0;
    }, 320);
    return true;
  } catch (e) {
    if (!reroute) setStatus(`No se pudo calcular la ruta: ${e.message}`, "error", { autoHideMs: 8000 });
    return false;
  } finally {
    if (!reroute) {
      el.btnCalcRoute.disabled = false;
      el.btnCalcRoute.textContent = "Calcular ruta";
    }
  }
}

const TRAFFIC_LABEL = { bajo: "Tránsito bajo", medio: "Tránsito medio", alto: "Tránsito alto", sd: "Tránsito s/d" };

function renderRouteOptions() {
  const routes = state.routes || [];
  el.routeOptions.classList.toggle("hidden", routes.length < 2);
  el.routeResult.classList.toggle("multi", routes.length > 1);
  el.routeOptions.innerHTML = routes
    .map((r, i) => {
      const t = r.traffic;
      const bike = t.cyclewayShare >= 0.05 ? `<span class="opt-meta">🚴 ${Math.round(t.cyclewayShare * 100)}% ciclovía</span>` : "";
      return `<button class="route-option ${r === state.route ? "selected" : ""}" data-idx="${i}">
        <div class="opt-main">
          <span class="opt-time">${formatDuration(r.duration)}</span>
          <span class="opt-dist">${formatDistance(r.total)}${r.ascent != null ? ` · +${Math.round(r.ascent)} m` : ""}</span>
        </div>
        <div class="opt-side">
          <span class="traffic traffic-${t.level}">${TRAFFIC_LABEL[t.level]}</span>
          ${bike}
          ${r.tags.length ? `<span class="opt-tags">${r.tags.join(" · ")}</span>` : ""}
        </div>
      </button>`;
    })
    .join("");
  el.routeOptions.querySelectorAll(".route-option").forEach((b) => b.addEventListener("click", () => selectRoute(Number(b.dataset.idx))));
}

// Elegir una de las opciones: la dibuja arriba y actualiza resumen y pasos.
function selectRoute(i) {
  const route = state.routes?.[i];
  if (!route || state.isNavigating) return;
  state.route = route;
  drawRoute(route);
  renderRouteOptions();

  const origin = state.routeOrigin;
  const etaDate = new Date(Date.now() + route.duration * 1000);
  el.routeDistance.textContent = formatDistance(route.total);
  el.routeDuration.textContent = formatDuration(route.duration);
  el.routeEta.textContent = formatClock(etaDate);
  el.routeVia.textContent = describeVia(route.steps);

  const rain = state.weather ? getRainProbabilityForWindow(state.weather, new Date(), route.duration) : null;
  el.routeRain.textContent = rain != null ? `lluvia ${rain}%` : "lluvia s/d";
  updateDaylightNote(etaDate);

  if (state.weather?.windDirection != null && origin) {
    const bearing = bearingDegrees(origin.lat, origin.lon, state.destLocation.lat, state.destLocation.lon);
    const wind = classifyWindRelative(state.weather.windDirection, bearing);
    el.routeWind.textContent = wind.text;
    el.routeWind.className = `wind-${wind.level}`;
  } else {
    el.routeWind.textContent = "viento s/d";
  }

  el.routeElevation.textContent = route.ascent != null ? `+${Math.round(route.ascent)} m` : "s/d";
  renderStepList(route.steps);
}

// ---------------------------------------------------------------------------
// Navegacion por voz tipo Waze.
// - Te ubica SOBRE la ruta proyectando tu GPS en el tramo mas cercano
//   (buscando cerca de donde ibas, asi no "salta" si la ruta pasa dos veces
//   cerca del mismo lugar).
// - Avisa cada giro 3 veces: con anticipacion (~400 m), cerca (~120 m) y
//   "ahora". Despues de cada giro dice por donde seguir y cuanto.
// - Si pasa un rato sin decir nada, te recuerda por donde vas y lo que viene.
// - Si te salis de la ruta, avisa y recalcula solo desde donde estas.
// ---------------------------------------------------------------------------
const NAV_FAR_METERS = 400;
const NAV_NEAR_METERS = 120;
const NAV_NOW_METERS = 25;
const NAV_REMINDER_MS = 40000; // silencio maximo antes de un recordatorio
const OFF_ROUTE_METERS = 40;
const OFF_ROUTE_FIXES = 3; // posiciones seguidas fuera de ruta antes de recalcular
const REROUTE_COOLDOWN_MS = 15000;
const ARRIVE_METERS = 25;

async function requestWakeLock() {
  try {
    if ("wakeLock" in navigator) state.wakeLock = await navigator.wakeLock.request("screen");
  } catch {
    state.wakeLock = null; // no critico
  }
}
function releaseWakeLock() {
  state.wakeLock?.release?.().catch(() => {});
  state.wakeLock = null;
}

// Proyecta (lat,lon) sobre la ruta. Devuelve { seg, traveled, offset }.
function projectOnRoute(lat, lon, hintSeg) {
  const v = state.route.vertices;
  const cum = state.route.cumDist;
  const kx = 111320 * Math.cos((lat * Math.PI) / 180);
  const ky = 110540;

  const scan = (from, to) => {
    let best = null;
    for (let i = Math.max(0, from); i < Math.min(v.length - 1, to); i++) {
      const ax = (v[i][1] - lon) * kx, ay = (v[i][0] - lat) * ky;
      const bx = (v[i + 1][1] - lon) * kx, by = (v[i + 1][0] - lat) * ky;
      const dx = bx - ax, dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2)) : 0;
      const px = ax + t * dx, py = ay + t * dy;
      const d = Math.hypot(px, py);
      if (!best || d < best.offset) best = { seg: i, t, offset: d, traveled: cum[i] + t * (cum[i + 1] - cum[i]) };
    }
    return best;
  };

  // Primero cerca de donde ibas (un poco para atras y bastante para adelante).
  let best = hintSeg != null ? scan(hintSeg - 5, hintSeg + 120) : null;
  if (!best || best.offset > OFF_ROUTE_METERS) {
    const global = scan(0, v.length);
    if (!best || global.offset < best.offset) best = global;
  }
  return best;
}

function startNavigation() {
  if (!state.route?.steps.length) {
    setStatus("Primero calculá una ruta para poder navegar", "error", { autoHideMs: 5000 });
    return;
  }
  unlockSpeech();

  state.isNavigating = true;
  window.__mibiciNavigating = true;
  state.nav = {
    index: 1, // el paso 0 es "arrancá"; el siguiente es la primera maniobra
    seg: 0,
    traveled: 0,
    offRouteCount: 0,
    lastRerouteAt: 0,
    rerouting: false,
    followPausedUntil: 0,
  };
  resetStepFlags();

  el.app.classList.add("navigating");
  drawRoute(state.route); // en navegacion solo la ruta elegida (sin las grises)
  el.navBanner.classList.remove("hidden");
  el.navFooter.classList.remove("hidden");
  requestWakeLock();
  startLiveTracking();

  setTimeout(() => {
    state.map.invalidateSize();
    const here = state.userLocation || { lat: state.route.vertices[0][0], lon: state.route.vertices[0][1] };
    state.map.setView([here.lat, here.lon], 17);
  }, 50);

  const first = state.route.steps[0];
  const eta = formatClock(new Date(Date.now() + state.route.duration * 1000));
  speak(
    `Arrancamos. ${first.streetName ? `Salí por ${first.streetName}.` : first.instruction + "."} ` +
      `Son ${spokenDistance(state.route.total)}, llegás a las ${eta}`,
    "high"
  );
  if (state.userLocation) updateNavProgress(state.userLocation.lat, state.userLocation.lon);
  else renderNavBanner(state.route.steps[1]?.cumDist ?? 0);
}

function resetStepFlags() {
  state.route.steps.forEach((s) => {
    s.saidFar = s.saidNear = s.saidNow = false;
  });
}

function stopNavigation({ silent } = {}) {
  const wasNavigating = state.isNavigating;
  state.isNavigating = false;
  window.__mibiciNavigating = false;
  state.nav = null;
  releaseWakeLock();
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  el.app.classList.remove("navigating");
  el.navBanner.classList.add("hidden");
  el.navFooter.classList.add("hidden");
  if (wasNavigating && !silent) {
    if (state.route) drawRoute(state.route); // vuelven las opciones grises
    setSheetMode("preview");
    setTimeout(() => state.map.invalidateSize(), 50);
    if (state.route) renderStepList(state.route.steps);
  }
}

function renderNavBanner(distToNext) {
  const steps = state.route.steps;
  const next = steps[state.nav.index];
  if (!next) return;
  const m = maneuverOf(next);
  el.navArrow.textContent = m.arrow;
  el.navDistance.textContent = next.type === 10 ? formatDistance(distToNext) : formatDistance(distToNext);
  el.navInstruction.textContent = next.instruction;

  const after = steps[state.nav.index + 1];
  if (after && after.type !== 10 && after.cumDist - next.cumDist < 150) {
    el.navThen.textContent = `Enseguida: ${maneuverOf(after).arrow} ${after.instruction}`;
    el.navThen.classList.remove("hidden");
  } else {
    el.navThen.classList.add("hidden");
  }

  const remaining = Math.max(0, state.route.total - state.nav.traveled);
  const remainingSecs = state.route.duration * (remaining / state.route.total || 0);
  el.navRemainingDist.textContent = (remaining / 1000).toFixed(1).replace(".", ",");
  el.navRemainingTime.textContent = formatDuration(remainingSecs);
  el.navEta.textContent = formatClock(new Date(Date.now() + remainingSecs * 1000));
}

// Arma la frase para el proximo giro, encadenando el siguiente si viene pegado.
function maneuverPhrase(step) {
  let phrase = spokenManeuver(step);
  const steps = state.route.steps;
  const idx = steps.indexOf(step);
  const after = steps[idx + 1];
  if (after && after.type !== 10 && after.cumDist - step.cumDist < 60) {
    phrase += `, y enseguida ${spokenManeuver(after)}`;
  }
  return phrase;
}

function updateNavProgress(lat, lon) {
  const nav = state.nav;
  if (!nav || !state.route || nav.arrived) return;

  const p = projectOnRoute(lat, lon, nav.seg);
  const accuracyOk = state.userAccuracy == null || state.userAccuracy < 45;

  // --- Fuera de ruta -> recalcular ---
  if (p.offset > OFF_ROUTE_METERS && accuracyOk) {
    nav.offRouteCount++;
    if (nav.offRouteCount >= OFF_ROUTE_FIXES) rerouteFrom(lat, lon);
    return;
  }
  nav.offRouteCount = 0;

  // No dejamos que el progreso retroceda por ruido del GPS.
  nav.seg = p.seg;
  nav.traveled = Math.max(nav.traveled - 15, p.traveled);
  const traveled = nav.traveled;

  // Tramo ya recorrido en gris.
  const v = state.route.vertices;
  const doneLatLngs = v.slice(0, p.seg + 1);
  const a = v[p.seg], b = v[p.seg + 1] || a;
  doneLatLngs.push([a[0] + (b[0] - a[0]) * p.t, a[1] + (b[1] - a[1]) * p.t]);
  state.routeLayers?.done.setLatLngs(doneLatLngs);

  // --- Llegada ---
  if (state.route.total - traveled <= ARRIVE_METERS) {
    arrive();
    return;
  }

  const steps = state.route.steps;
  // Maniobras que ya quedaron atras (por si el GPS salteo alguna).
  while (nav.index < steps.length - 1 && steps[nav.index].cumDist - traveled < -NAV_NOW_METERS) {
    nav.index++;
    afterManeuver(steps[nav.index - 1]);
  }

  const next = steps[nav.index];
  const dist = next.cumDist - traveled;

  if (next.type === 10) {
    if (!next.saidNear && dist <= 150) {
      next.saidNear = true;
      speak(`Tu destino está a ${spokenDistance(dist)}${state.destLabel ? `, en ${state.destLabel}` : ""}`, "normal");
    }
  } else if (dist <= NAV_NOW_METERS) {
    if (!next.saidNow) {
      next.saidNow = next.saidNear = next.saidFar = true;
      speak(`Ahora, ${maneuverPhrase(next)}`, "high");
    }
    // Pasamos a la siguiente maniobra cuando ya la dejamos atras.
    if (dist < -5) {
      nav.index++;
      afterManeuver(next);
    }
  } else if (dist <= NAV_NEAR_METERS && !next.saidNear) {
    next.saidNear = next.saidFar = true;
    speak(`En ${spokenDistance(dist)}, ${maneuverPhrase(next)}`, "high");
  } else if (dist <= NAV_FAR_METERS && dist > NAV_NEAR_METERS + 80 && !next.saidFar) {
    next.saidFar = true;
    speak(`En ${spokenDistance(dist)}, ${maneuverPhrase(next)}`, "normal");
  } else if (Date.now() - voiceState.lastSpokeAt > NAV_REMINDER_MS) {
    // Recordatorio para que la voz te acompañe todo el viaje.
    const current = steps[nav.index - 1];
    const along = current?.streetName ? `Seguí por ${current.streetName}. ` : "Seguí derecho. ";
    speak(`${along}En ${spokenDistance(dist)}, ${spokenManeuver(next)}.`, "low");
  }

  renderNavBanner(Math.max(0, steps[nav.index].cumDist - traveled));
}

// Justo despues de un giro: "Seguí por Av. Italia 800 metros".
function afterManeuver(doneStep) {
  const steps = state.route.steps;
  const nextStep = steps[state.nav.index];
  if (!nextStep) return;
  const stretch = nextStep.cumDist - doneStep.cumDist;
  if (stretch > 250 && doneStep.streetName) {
    // Se encola detras del "Ahora, doblá..." (prioridad normal no lo corta).
    speak(`Seguí por ${doneStep.streetName} ${spokenDistance(stretch)}`, "normal");
    // Si el proximo giro esta cerca, el aviso "en 400 metros" seria repetido.
    if (stretch <= 600) nextStep.saidFar = true;
  }
  renderStepList(steps, state.nav.index);
}

async function rerouteFrom(lat, lon) {
  const nav = state.nav;
  if (nav.rerouting || Date.now() - nav.lastRerouteAt < REROUTE_COOLDOWN_MS) return;
  nav.rerouting = true;
  nav.lastRerouteAt = Date.now();
  speak("Te saliste de la ruta. Recalculando.", "high");
  el.navInstruction.textContent = "Recalculando ruta…";
  el.navDistance.textContent = "";
  el.navArrow.textContent = "⟲";

  state.userLocation = { lat, lon };
  const ok = await calculateRoute({ fromHere: true, reroute: true });
  if (!state.nav) return; // cancelaste mientras recalculaba
  nav.rerouting = false;
  nav.offRouteCount = 0;
  if (!ok) {
    speak("No pude recalcular, sin conexión. Sigo intentando.", "normal");
    return;
  }
  nav.index = 1;
  nav.seg = 0;
  nav.traveled = 0;
  resetStepFlags();
  renderStepList(state.route.steps, 1);
  const next = state.route.steps[1];
  const first = state.route.steps[0];
  speak(
    `Ruta nueva. ${first.streetName ? `Seguí por ${first.streetName}, ` : ""}` +
      (next ? `en ${spokenDistance(next.cumDist)}, ${spokenManeuver(next)}.` : ""),
    "normal"
  );
  updateNavProgress(lat, lon);
}

function arrive() {
  state.nav.arrived = true;
  speak(`Llegaste a tu destino${state.destLabel ? `: ${state.destLabel}` : ""}. ¡Buen viaje!`, "high");
  el.navArrow.textContent = "⚑";
  el.navDistance.textContent = "Llegaste";
  el.navInstruction.textContent = state.destLabel || "Tu destino";
  el.navThen.classList.add("hidden");
  state.routeLayers?.done.setLatLngs(state.route.vertices);
  state.nav.index = state.route.steps.length;
  const nav = state.nav;
  setTimeout(() => {
    if (state.nav === nav) stopNavigation();
  }, 8000);
}

el.btnStartNav.addEventListener("click", startNavigation);
el.btnStopNav.addEventListener("click", () => stopNavigation());
el.btnMute.addEventListener("click", () => {
  voiceState.muted = !voiceState.muted;
  el.btnMute.textContent = voiceState.muted ? "🔇" : "🔊";
  if (voiceState.muted) speechSynthesis.cancel();
});

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

el.btnLocate.addEventListener("click", () => {
  if (state.nav) state.nav.followPausedUntil = 0;
  if (state.userLocation && state.map) state.map.setView([state.userLocation.lat, state.userLocation.lon], state.isNavigating ? 17 : 16);
  if (!state.isNavigating) requestGeolocation();
});
el.btnCalcRoute.addEventListener("click", () => calculateRoute());

document.addEventListener("click", (e) => {
  if (!e.target.closest(".route-form")) hideSuggestions();
});

if (!getOrsKey()) el.routeNoKey.classList.remove("hidden");

window.addEventListener("offline", () => setStatus("📶 Sin conexión — el mapa, el clima y las rutas necesitan internet", "error"));
window.addEventListener("online", () => {
  setStatus(null);
  if (state.destLocation) loadNearbyPOIs(state.destLocation.lat, state.destLocation.lon);
});

requestGeolocation();
