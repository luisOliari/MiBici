// ---------------------------------------------------------------------------
// Puntos de interes cercanos al destino, via Overpass API (OpenStreetMap):
// https://overpass-api.de/api/interpreter — gratis, publico, sin API key.
// Datos reales cargados por la comunidad de OSM (pueden faltar lugares que
// no esten mapeados, pero no son inventados/simulados).
// ---------------------------------------------------------------------------

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
// El servidor publico de Overpass a veces devuelve 504 por sobrecarga; si
// falla, reintentamos una vez contra un espejo publico antes de rendirnos.
const OVERPASS_MIRROR_URL = "https://overpass.kumi.systems/api/interpreter";
const POI_RADIUS_METERS = 600;

const POI_CATEGORIES = {
  cafe: { icon: "☕", label: "cafés" },
  bicycle_parking: { icon: "🚲", label: "bicicleteros" },
  bicycle_shop: { icon: "🔧", label: "talleres de bici" },
  drinking_water: { icon: "🚰", label: "bebederos" },
  toilets: { icon: "🚻", label: "baños públicos" },
  attraction: { icon: "📍", label: "puntos de interés" },
};

// Cada categoria tiene su propio "out" con limite propio: si no, una zona con
// muchos cafes podia llenar el limite total y dejar afuera al resto (que
// suelen estar mapeados con menos frecuencia en OSM).
function overpassQuery(lat, lon) {
  const r = POI_RADIUS_METERS;
  return `[out:json][timeout:25];
    (node["amenity"="cafe"](around:${r},${lat},${lon}););out center 10;
    (node["amenity"="bicycle_parking"](around:${r},${lat},${lon}););out center 20;
    (node["shop"="bicycle"](around:${r},${lat},${lon}););out center 10;
    (node["amenity"="drinking_water"](around:${r},${lat},${lon}););out center 10;
    (node["amenity"="toilets"](around:${r},${lat},${lon}););out center 6;
    (node["tourism"="attraction"](around:${r},${lat},${lon}););out center 8;`;
}

function classifyElement(tags) {
  if (tags.amenity === "cafe") return "cafe";
  if (tags.amenity === "bicycle_parking") return "bicycle_parking";
  if (tags.shop === "bicycle") return "bicycle_shop";
  if (tags.amenity === "drinking_water") return "drinking_water";
  if (tags.amenity === "toilets") return "toilets";
  if (tags.tourism === "attraction") return "attraction";
  return null;
}

async function queryOverpass(query) {
  for (const base of [OVERPASS_URL, OVERPASS_MIRROR_URL]) {
    try {
      const res = await fetch(`${base}?data=${encodeURIComponent(query)}`);
      if (res.ok) return await res.json();
    } catch {
      /* probamos el siguiente servidor */
    }
  }
  throw new Error("Overpass no disponible (servidor principal y espejo fallaron)");
}

async function fetchNearbyPOIs(lat, lon) {
  const data = await queryOverpass(overpassQuery(lat, lon));

  return data.elements
    .map((el) => {
      const category = classifyElement(el.tags || {});
      if (!category) return null;
      return {
        category,
        name: el.tags.name || POI_CATEGORIES[category].label.replace(/s$/, ""),
        lat: el.lat,
        lon: el.lon,
      };
    })
    .filter(Boolean);
}
