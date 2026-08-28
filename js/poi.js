// ---------------------------------------------------------------------------
// Puntos de interes cercanos al destino, via Overpass API (OpenStreetMap):
// https://overpass-api.de/api/interpreter — gratis, publico, sin API key.
// Datos reales cargados por la comunidad de OSM (pueden faltar lugares que
// no esten mapeados, pero no son inventados/simulados).
// ---------------------------------------------------------------------------

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const POI_RADIUS_METERS = 400;

const POI_CATEGORIES = {
  cafe: { icon: "☕", label: "cafés" },
  bicycle_parking: { icon: "🚲", label: "bicicleteros" },
  attraction: { icon: "📍", label: "puntos de interés" },
};

function overpassQuery(lat, lon) {
  return `[out:json][timeout:15];(
    node["amenity"="cafe"](around:${POI_RADIUS_METERS},${lat},${lon});
    node["amenity"="bicycle_parking"](around:${POI_RADIUS_METERS},${lat},${lon});
    node["tourism"="attraction"](around:${POI_RADIUS_METERS},${lat},${lon});
  );out center 20;`;
}

function classifyElement(tags) {
  if (tags.amenity === "cafe") return "cafe";
  if (tags.amenity === "bicycle_parking") return "bicycle_parking";
  if (tags.tourism === "attraction") return "attraction";
  return null;
}

async function fetchNearbyPOIs(lat, lon) {
  const url = `${OVERPASS_URL}?data=${encodeURIComponent(overpassQuery(lat, lon))}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Overpass error");
  const data = await res.json();

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
