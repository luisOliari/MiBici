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
  airQuality: null,
  map: null,
  userMarker: null,
  destMarker: null,
  routeLayer: null,
  poiMarkers: [],
  cyclewaysLayer: null,
  cyclewaysVisible: false,
  activeSuggestionInput: null,
  addressSearchToken: 0,
  navSteps: [],
  navIndex: 0,
  routeVertices: null,
  routeCumDist: null,
  wakeLock: null,
  isNavigating: false,
  cardExpanded: false,
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
  weatherFeelsLike: document.getElementById("weatherFeelsLike"),
  weatherHumidity: document.getElementById("weatherHumidity"),
  weatherGusts: document.getElementById("weatherGusts"),
  weatherUv: document.getElementById("weatherUv"),
  weatherSunrise: document.getElementById("weatherSunrise"),
  weatherSunset: document.getElementById("weatherSunset"),
  weatherAqi: document.getElementById("weatherAqi"),
  daylightNote: document.getElementById("daylightNote"),
  originInput: document.getElementById("originInput"),
  destInput: document.getElementById("destInput"),
  destSuggestions: document.getElementById("destSuggestions"),
  btnCalcRoute: document.getElementById("btnCalcRoute"),
  routeResult: document.getElementById("routeResult"),
  routeDistance: document.getElementById("routeDistance"),
  routeDuration: document.getElementById("routeDuration"),
  routeEta: document.getElementById("routeEta"),
  routeRain: document.getElementById("routeRain"),
  routeWind: document.getElementById("routeWind"),
  routeElevation: document.getElementById("routeElevation"),
  routeNoKey: document.getElementById("routeNoKey"),
  btnToggleLanes: document.getElementById("btnToggleLanes"),
  gpsStatus: document.getElementById("gpsStatus"),
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

  // Estela del recorrido real (se va dibujando con tu posicion en vivo).
  state.trailLayer = L.polyline([], { color: "#1e293b", weight: 3, opacity: 0.55 }).addTo(state.map);
}

function placeUserMarker(lat, lon) {
  const icon = L.divIcon({ className: "", html: '<div class="user-dot"></div>', iconSize: [18, 18] });
  if (state.userMarker) state.userMarker.setLatLng([lat, lon]);
  else state.userMarker = L.marker([lat, lon], { icon, zIndexOffset: 1000 }).addTo(state.map);
}

function placeDestMarker(lat, lon) {
  // El pin es un cuadrado rotado -45deg (truco clasico de "gota" con CSS).
  // La punta filosa, despues de rotar, NO queda en el borde inferior del
  // cuadrado original sino un poco mas abajo (geometria de la rotacion:
  // centro + la mitad de la diagonal). Si el iconAnchor no usa ese punto
  // exacto, el pin se ve corrido unos metros del lugar real — por eso el
  // destino "no agarraba" bien la esquina exacta.
  const icon = L.divIcon({ className: "", html: '<div class="dest-pin"></div>', iconSize: [26, 26], iconAnchor: [13, 31] });
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

// Seguimiento CONTINUO de posicion (como Waze): actualiza tu marcador, deja
// una estela de por donde pasaste, y si hay navegacion por voz activa hace
// avanzar las indicaciones y sigue tu posicion en el mapa.
//
// iOS Safari tiene una limitacion conocida: despues de un rato corta en
// silencio el watchPosition (sin disparar error), sobre todo si la app pasa
// a segundo plano o la pantalla se atenua. Por eso ademas de arrancarlo,
// hay un "vigia" que detecta cuando dejo de llegar posicion y lo reinicia solo.
const GPS_STALE_MS = 12000; // si no llega una posicion nueva en este tiempo, se considera "cortado"
const GPS_ANNOUNCE_STALE_MS = 20000; // recien a partir de aca avisamos por voz

function startLiveTracking() {
  if (state.liveWatchId !== null || !navigator.geolocation) return;

  state.liveWatchId = navigator.geolocation.watchPosition(
    (pos) => onLiveLocation(pos.coords.latitude, pos.coords.longitude),
    (err) => {
      console.warn("Live tracking error:", err.code, err.message);
      // Solo molestamos una vez por permiso bloqueado; los timeouts pasajeros
      // en movimiento (tunel, mala señal) no ameritan interrumpir el viaje.
      if (err.code === 1 && !state.permissionErrorShown) {
        state.permissionErrorShown = true;
        setStatus("Se perdió el permiso de ubicación en tiempo real — revisalo en Ajustes", "error");
      }
    },
    { enableHighAccuracy: true, maximumAge: 4000, timeout: 20000 }
  );
}

function restartLiveTracking() {
  if (state.liveWatchId !== null) {
    navigator.geolocation.clearWatch(state.liveWatchId);
    state.liveWatchId = null;
  }
  startLiveTracking();
  // Ademas de reiniciar el watch, pedimos una posicion puntual ya mismo: en
  // iOS a veces el watch reiniciado tarda en dar la primera señal, y esto
  // acorta esa espera.
  navigator.geolocation.getCurrentPosition(
    (pos) => onLiveLocation(pos.coords.latitude, pos.coords.longitude),
    () => {},
    { enableHighAccuracy: true, maximumAge: 4000, timeout: 15000 }
  );
}

function onLiveLocation(lat, lon) {
  state.userLocation = { lat, lon };
  state.lastFixAt = Date.now();
  state.gpsStaleAnnounced = false;
  updateGpsStatusBadge();
  placeUserMarker(lat, lon);

  if (!state.lastTrailPoint || haversineMeters(state.lastTrailPoint[0], state.lastTrailPoint[1], lat, lon) >= TRAIL_MIN_MOVE_METERS) {
    state.trailLayer?.addLatLng([lat, lon]);
    state.lastTrailPoint = [lat, lon];
  }

  if (state.isNavigating) {
    state.map.panTo([lat, lon], { animate: true });
    updateNavProgress(lat, lon);
  }
}

// Corre siempre en segundo plano revisando si el GPS "se corto". Si pasa
// demasiado tiempo sin una posicion nueva, reinicia el watch solo y, si
// estas navegando, te avisa por voz que esta buscando señal de nuevo.
function updateGpsStatusBadge() {
  if (!el.gpsStatus) return;
  if (!state.lastFixAt) {
    el.gpsStatus.textContent = "🛰️ Sin señal todavía";
    el.gpsStatus.className = "gps-status warn";
    return;
  }
  const secs = Math.round((Date.now() - state.lastFixAt) / 1000);
  const stale = Date.now() - state.lastFixAt > GPS_STALE_MS;
  el.gpsStatus.textContent = stale ? `🛰️ Sin señal hace ${secs}s` : `🛰️ En vivo (hace ${secs}s)`;
  el.gpsStatus.className = `gps-status ${stale ? "warn" : "ok"}`;
}

setInterval(() => {
  updateGpsStatusBadge();
  if (!state.lastFixAt) return;
  const staleFor = Date.now() - state.lastFixAt;

  if (staleFor > GPS_STALE_MS) {
    restartLiveTracking();
  }
  if (state.isNavigating && staleFor > GPS_ANNOUNCE_STALE_MS && !state.gpsStaleAnnounced) {
    state.gpsStaleAnnounced = true;
    speak("Buscando señal de GPS");
  }
}, 4000);

// Si el celular pasa a segundo plano y volves (cambiaste de app, se bloqueo
// la pantalla), Safari puede haber matado el watch sin avisar: lo reiniciamos.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") restartLiveTracking();
});

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
    // El texto ya no corresponde a la ubicacion elegida antes: la invalidamos
    // para que "Calcular ruta" vuelva a resolverla en vez de usar la vieja.
    if (inputEl === el.originInput) state.originLocation = null;
    else state.destLocation = null;

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

// Reintenta unas veces con espera creciente antes de darse por vencido: en
// bici es comun perder señal un instante (entre antenas, tunel, etc.) y
// antes esto fallaba en silencio, dando la sensacion de que los lugares
// "desaparecian" del mapa sin ningun aviso.
async function loadNearbyPOIs(lat, lon, attempt = 1) {
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
      const marker = L.marker([p.lat, p.lon], { icon })
        .bindTooltip(p.name, { direction: "top", offset: [0, -12] })
        .bindPopup(p.name);
      marker.addTo(state.map);
      state.poiMarkers.push(marker);
    });
  } catch (e) {
    console.warn(`No se pudieron cargar los puntos de interés (intento ${attempt}):`, e.message);
    if (attempt < 3) {
      setTimeout(() => loadNearbyPOIs(lat, lon, attempt + 1), 3000 * attempt);
    } else {
      setStatus("No se pudieron cargar los lugares cercanos (sin señal/conexión) — probá tocar 📍 para reintentar", "error");
    }
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
          { color: "#0ea5e9", weight: 4, opacity: 0.8, dashArray: "1 8", lineCap: "round" }
        )
      )
    ).addTo(state.map);
    state.cyclewaysVisible = true;
    el.btnToggleLanes.classList.add("active");
    el.btnToggleLanes.textContent = ways.length ? "🚴 Ciclovías" : "🚴 Sin datos acá";
  } catch {
    el.btnToggleLanes.textContent = "🚴 Ver ciclovías";
    setStatus("No se pudieron cargar las ciclovías ahora — probá de nuevo", "error");
  }
}
el.btnToggleLanes.addEventListener("click", toggleCycleways);

// --- Ruteo (OpenRouteService) ---
function formatDuration(seconds) {
  const min = Math.round(seconds / 60);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)}h ${min % 60}min`;
}

// Si el usuario escribio una direccion/esquina pero no toco ninguna sugerencia
// de la lista, igual intentamos resolverla al tocar "Calcular ruta" (evita el
// error confuso de "elegi un destino" cuando el texto ya alcanza para ubicarlo).
async function resolveAddressText(text) {
  const parts = parseIntersectionQuery(text);
  if (parts) {
    const point = await findStreetIntersection(parts[0], parts[1]).catch(() => null);
    if (point) return point;
  }
  try {
    const url = `${NOMINATIM_URL}?format=json&limit=1&countrycodes=uy&viewbox=${MONTEVIDEO_VIEWBOX}&bounded=1&q=${encodeURIComponent(`${text}, Montevideo, Uruguay`)}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (res.ok) {
      const data = await res.json();
      if (data[0]) return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
    }
  } catch {
    /* sin resultado */
  }
  return null;
}

async function calculateRoute() {
  const key = getOrsKey();
  if (!key) {
    el.routeNoKey.classList.remove("hidden");
    el.routeResult.classList.add("hidden");
    return;
  }
  const origin = state.originLocation || state.userLocation;
  if (!origin) {
    setStatus("No pude determinar tu ubicación de origen", "error");
    return;
  }

  if (!state.destLocation) {
    const typed = el.destInput.value.trim();
    if (!typed) {
      setStatus("Escribí a dónde vas antes de calcular la ruta", "error");
      return;
    }
    setStatus("Buscando esa dirección…");
    const resolved = await resolveAddressText(typed);
    if (!resolved) {
      setStatus("No encontré esa dirección — probá elegir una de las sugerencias de la lista", "error");
      return;
    }
    state.destLocation = resolved;
    placeDestMarker(resolved.lat, resolved.lon);
    loadNearbyPOIs(resolved.lat, resolved.lon);
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
        elevation: true,
        language: "es", // sin esto, las instrucciones de voz vienen en ingles
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

    // Arranca una estela nueva y limpia para este viaje — si no, la de un
    // viaje anterior (ej. la ida) quedaba superpuesta y confundia como si
    // hubiera "varios recorridos" a la vez.
    state.trailLayer?.setLatLngs([]);
    state.lastTrailPoint = null;

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
    updateDaylightNote(etaDate);

    if (state.weather?.windDirection != null) {
      const bearing = bearingDegrees(origin.lat, origin.lon, state.destLocation.lat, state.destLocation.lon);
      const wind = classifyWindRelative(state.weather.windDirection, bearing);
      el.routeWind.textContent = wind.text;
      el.routeWind.className = `route-stat-value wind-${wind.level}`;
    } else {
      el.routeWind.textContent = "s/d";
    }

    const elevationCoords = geojson.features[0].geometry.coordinates;
    if (elevationCoords[0]?.length === 3) {
      let ascent = 0;
      for (let i = 1; i < elevationCoords.length; i++) {
        const diff = elevationCoords[i][2] - elevationCoords[i - 1][2];
        if (diff > 0) ascent += diff;
      }
      el.routeElevation.textContent = `+${Math.round(ascent)} m`;
    } else {
      el.routeElevation.textContent = "s/d";
    }

    el.routeResult.classList.remove("hidden");

    stopVoiceNavigation();
    state.navSteps = extractRouteSteps(geojson);
    state.navIndex = 0;

    // Distancia acumulada a lo largo de la ruta, punto a punto. La usamos
    // para saber "cuanto llevas recorrido" comparando tu posicion contra el
    // vertice mas cercano, en vez de exigir que pises un radio exacto (eso
    // se podia trabar para siempre si el GPS no coincidia justo ahi).
    state.routeVertices = geojson.features[0].geometry.coordinates.map((c) => [c[1], c[0]]);
    state.routeCumDist = [0];
    for (let i = 1; i < state.routeVertices.length; i++) {
      const [lat1, lon1] = state.routeVertices[i - 1];
      const [lat2, lon2] = state.routeVertices[i];
      state.routeCumDist.push(state.routeCumDist[i - 1] + haversineMeters(lat1, lon1, lat2, lon2));
    }
    state.navSteps.forEach((s) => {
      s.cumDist = state.routeCumDist[s.vertexIndex] ?? 0;
      s.leadAnnounced = false;
    });

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
// En vez de exigir pisar un radio exacto alrededor del punto de giro (lo que
// se podia trabar para siempre si el GPS pasaba de largo), medimos cuanto
// llevas recorrido a lo largo de la ruta y avisamos con anticipacion.
const NAV_LEAD_METERS = 120; // avisa "en N metros, doblar..." con esta anticipacion
const NAV_ARRIVE_METERS = 20; // a partir de aca se da por hecha la maniobra

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
}

function announceStep(index) {
  const step = state.navSteps[index];
  if (step) speak(step.instruction);
}

function finishNavigation() {
  // El ultimo paso de ORS ya es la instruccion de llegada y se anuncio recien
  // en el loop de updateNavProgress; aca solo cerramos el modo navegacion.
  stopVoiceNavigation();
}

// Busca el vertice de la ruta mas cercano a tu posicion actual (recorriendo
// TODA la ruta, no solo el proximo paso) para no quedar trabado si el GPS
// dio un salto o cortaste camino: siempre se re-ubica sobre el progreso real.
function nearestRouteVertexIndex(lat, lon) {
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < state.routeVertices.length; i++) {
    const [vlat, vlon] = state.routeVertices[i];
    const d = haversineMeters(lat, lon, vlat, vlon);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function updateNavProgress(lat, lon) {
  if (!state.routeVertices?.length) return;

  const traveled = state.routeCumDist[nearestRouteVertexIndex(lat, lon)];

  while (state.navIndex < state.navSteps.length) {
    const step = state.navSteps[state.navIndex];
    const remaining = step.cumDist - traveled;

    if (remaining <= NAV_ARRIVE_METERS) {
      announceStep(state.navIndex);
      state.navIndex++;
      continue;
    }
    if (!step.leadAnnounced && remaining <= NAV_LEAD_METERS) {
      speak(`En ${Math.round(remaining / 10) * 10} metros, ${step.instruction}`);
      step.leadAnnounced = true;
    }
    break;
  }

  if (state.navIndex >= state.navSteps.length) {
    finishNavigation();
    return;
  }

  updateNavDisplay();
  const remainingToNext = Math.max(0, Math.round(state.navSteps[state.navIndex].cumDist - traveled));
  el.voiceNextDistance.textContent = `en ${remainingToNext} m`;
}

function startVoiceNavigation() {
  if (!state.navSteps.length) {
    setStatus("Primero calculá una ruta para poder navegar por voz", "error");
    return;
  }
  if (!("speechSynthesis" in window)) {
    setStatus("Tu navegador no soporta indicaciones por voz", "error");
    return;
  }

  state.isNavigating = true;
  el.voiceNavControls.classList.add("hidden");
  el.voiceNavActive.classList.remove("hidden");
  requestWakeLock();
  startLiveTracking(); // por si todavia no habia arrancado (ej. veniamos del fallback)

  state.navSteps.forEach((s) => (s.leadAnnounced = false));
  announceStep(0);
  state.navIndex = 1;
  updateNavDisplay();
  el.voiceNextDistance.textContent = "";
}

function stopVoiceNavigation() {
  // El seguimiento en vivo (marcador + estela) sigue corriendo siempre; solo
  // apagamos el modo navegacion (anuncios de voz + camara siguiendote).
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

el.btnLocate.addEventListener("click", () => {
  requestGeolocation();
  if (state.destLocation) loadNearbyPOIs(state.destLocation.lat, state.destLocation.lon);
});
el.btnCalcRoute.addEventListener("click", calculateRoute);

document.addEventListener("click", (e) => {
  if (!e.target.closest(".route-field")) el.destSuggestions.classList.add("hidden");
});

if (!getOrsKey()) el.routeNoKey.classList.remove("hidden");

// Los cortes de señal andando en bici son el motivo mas comun de que el
// clima, el mapa, los lugares cercanos o la ruta parezcan "fallar" sin
// explicacion — avisamos claramente cuando pasa, en vez de fallar en silencio.
window.addEventListener("offline", () => setStatus("📶 Sin conexión — el mapa, el clima y las rutas necesitan internet", "error"));
window.addEventListener("online", () => {
  setStatus(null);
  if (state.destLocation) loadNearbyPOIs(state.destLocation.lat, state.destLocation.lon);
});

requestGeolocation();
