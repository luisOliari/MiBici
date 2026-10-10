// ---------------------------------------------------------------------------
// "Se me pincho la bici: ¿donde la arreglo?"
//
// data/talleres.json trae los talleres, estaciones de reparacion, gomerias y
// estaciones de servicio de Montevideo (de OpenStreetMap, generado con
// tools/build_talleres.py). Queda guardado en el celular: anda sin señal.
// OpenStreetMap no tiene TODOS los talleres de barrio, asi que ademas podes
// guardar los tuyos (mantener apretado el mapa -> "Guardar taller acá");
// esos quedan solo en tu celular.
// ---------------------------------------------------------------------------

const TALLER_TYPES = {
  taller: { icon: "🔧", label: "Taller de bicis", onMap: true },
  mio: { icon: "⭐", label: "Mi taller", onMap: true },
  estacion: { icon: "🛠️", label: "Estación de reparación (herramientas e inflador, gratis)", onMap: true },
  gomeria: { icon: "⚙️", label: "Gomería (consultá si arreglan bicis)", onMap: true },
  aire: { icon: "⛽", label: "Estación de servicio (aire)", onMap: false },
};
const MY_TALLERES_STORAGE = "mibici_mis_talleres";

const talleres = { places: [], layer: null, promise: null };

function loadMyTalleres() {
  try {
    return JSON.parse(localStorage.getItem(MY_TALLERES_STORAGE) || "[]");
  } catch {
    return [];
  }
}

function loadTalleres() {
  if (!talleres.promise) {
    talleres.promise = fetch("data/talleres.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => {
        talleres.places = data.places;
        return talleres.places;
      })
      .catch((e) => {
        talleres.promise = null; // reintentar la proxima vez
        throw e;
      });
  }
  return talleres.promise;
}

function allTalleres() {
  return loadMyTalleres().concat(talleres.places);
}

function tallerPopupHtml(p) {
  const type = TALLER_TYPES[p.t];
  const where = p.a || (p.c ? `cerca de ${p.c}` : "");
  const phone = p.p ? `<a class="popup-link" href="tel:${escapeHtml(p.p.split(/[\/;,]/)[0].replace(/[^\d+]/g, ""))}">📞 ${escapeHtml(p.p)}</a>` : "";
  return `<div class="taller-popup">
    <strong>${type.icon} ${escapeHtml(p.n)}</strong>
    <span>${escapeHtml(type.label)}</span>
    ${where ? `<span>${escapeHtml(where)}</span>` : ""}
    ${p.h ? `<span>🕒 ${escapeHtml(p.h)}</span>` : ""}
    ${phone}
    <button class="btn-primary popup-btn" data-go="${p.lat},${p.lon}">Ir acá</button>
    ${p.t === "mio" ? `<button class="btn-secondary popup-btn" data-remove="${p.lat},${p.lon}">Quitar</button>` : ""}
  </div>`;
}

// Dibuja (o redibuja) los talleres sobre el mapa. Siempre visibles: la idea
// es mirar el mapa y ver al toque donde hay uno cerca.
async function renderTalleresLayer(map) {
  await loadTalleres().catch(() => []);
  if (talleres.layer) map.removeLayer(talleres.layer);
  talleres.layer = L.layerGroup(
    allTalleres()
      .filter((p) => TALLER_TYPES[p.t].onMap)
      .map((p) =>
        L.marker([p.lat, p.lon], {
          icon: L.divIcon({
            className: "",
            html: `<div class="taller-marker taller-${p.t}">${TALLER_TYPES[p.t].icon}</div>`,
            iconSize: [30, 30],
            iconAnchor: [15, 15],
          }),
          zIndexOffset: p.t === "taller" || p.t === "mio" ? 500 : 300,
        }).bindPopup(() => tallerPopupHtml(p), { minWidth: 200 })
      )
  ).addTo(map);
}

function saveMyTaller(lat, lon, name) {
  const mine = loadMyTalleres();
  mine.push({ t: "mio", n: name || "Mi taller", lat: Number(lat.toFixed(5)), lon: Number(lon.toFixed(5)) });
  localStorage.setItem(MY_TALLERES_STORAGE, JSON.stringify(mine));
}

function removeMyTaller(lat, lon) {
  const mine = loadMyTalleres().filter((p) => !(p.lat === lat && p.lon === lon));
  localStorage.setItem(MY_TALLERES_STORAGE, JSON.stringify(mine));
}

// Los lugares mas cercanos a un punto, por tipo. Devuelve [{...lugar, dist}]
function nearestTalleres(lat, lon, types, limit) {
  return allTalleres()
    .filter((p) => types.includes(p.t))
    .map((p) => ({ ...p, dist: haversineMeters(lat, lon, p.lat, p.lon) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, limit);
}

// Rumbo a un lugar en palabras ("al noreste"), para ubicarse mirando alrededor.
function compassWord(lat1, lon1, lat2, lon2) {
  const dy = lat2 - lat1;
  const dx = (lon2 - lon1) * Math.cos((lat1 * Math.PI) / 180);
  const deg = (Math.atan2(dx, dy) * 180) / Math.PI;
  const words = ["al norte", "al noreste", "al este", "al sureste", "al sur", "al suroeste", "al oeste", "al noroeste"];
  return words[Math.round(((deg + 360) % 360) / 45) % 8];
}
