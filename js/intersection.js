// ---------------------------------------------------------------------------
// Busqueda de CRUCES DE CALLES ("18 de Julio y Fernandez Crespo") — Nominatim
// no resuelve bien este tipo de consulta, asi que la armamos con datos reales
// de calles de OpenStreetMap (Overpass) + geometria (interseccion de segmentos).
// ---------------------------------------------------------------------------

const INTERSECTION_SEPARATOR = /\s+(?:y|esq\.?|esquina|con|&)\s+/i;

function parseIntersectionQuery(text) {
  const parts = text.split(INTERSECTION_SEPARATOR);
  if (parts.length !== 2) return null;
  const [a, b] = parts.map((p) => p.trim());
  if (a.length < 3 || b.length < 3) return null;
  return [a, b];
}

function normalizeStreetName(s) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // saca acentos
    .toLowerCase()
    .replace(/^(av\.?|avenida|bv\.?|bulevar|calle)\s+/, "")
    .trim();
}

function namesMatch(osmName, queryName) {
  if (!osmName) return false;
  const a = normalizeStreetName(osmName);
  const b = normalizeStreetName(queryName);
  return a === b || a.includes(b) || b.includes(a);
}

// Interseccion de dos segmentos [lon,lat]. Devuelve [lon,lat] o null.
function segmentIntersection(p1, p2, p3, p4) {
  const [x1, y1] = p1, [x2, y2] = p2, [x3, y3] = p3, [x4, y4] = p4;
  const d = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(d) < 1e-12) return null; // paralelas
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / d;
  const u = ((x1 - x3) * (y1 - y2) - (y1 - y3) * (x1 - x2)) / d;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
}

async function fetchWaysNear(lat, lon, radiusMeters) {
  const query = `[out:json][timeout:20];way["highway"](around:${radiusMeters},${lat},${lon});out geom;`;
  const data = await queryOverpass(query); // reutiliza el fallback a espejo definido en poi.js
  return data.elements.filter((el) => el.tags?.name && el.geometry?.length > 1);
}

async function geocodeStreet(name) {
  const url = `${NOMINATIM_URL}?format=json&limit=1&countrycodes=uy&viewbox=${MONTEVIDEO_VIEWBOX}&bounded=1&q=${encodeURIComponent(`${name}, Montevideo, Uruguay`)}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  const data = await res.json();
  return data[0] ? { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) } : null;
}

// Busca el punto real donde se cruzan dos calles. Devuelve {lat, lon} o null.
async function findStreetIntersection(streetA, streetB) {
  const anchor = (await geocodeStreet(streetB)) || (await geocodeStreet(streetA));
  if (!anchor) return null;

  const ways = await fetchWaysNear(anchor.lat, anchor.lon, 900);
  const waysA = ways.filter((w) => namesMatch(w.tags.name, streetA));
  const waysB = ways.filter((w) => namesMatch(w.tags.name, streetB));
  if (!waysA.length || !waysB.length) return null;

  const candidates = [];

  // 1) Interseccion geometrica exacta entre segmentos de A y de B.
  for (const wa of waysA) {
    const coordsA = wa.geometry.map((p) => [p.lon, p.lat]);
    for (const wb of waysB) {
      const coordsB = wb.geometry.map((p) => [p.lon, p.lat]);
      for (let i = 0; i < coordsA.length - 1; i++) {
        for (let j = 0; j < coordsB.length - 1; j++) {
          const hit = segmentIntersection(coordsA[i], coordsA[i + 1], coordsB[j], coordsB[j + 1]);
          if (hit) candidates.push({ lon: hit[0], lat: hit[1] });
        }
      }
    }
  }

  // 2) Si no cruzan exactamente en los datos de OSM, el nodo mas cercano entre
  // ambas calles (por si hay un pequeno desfasaje en el mapeo).
  if (!candidates.length) {
    let best = null;
    for (const wa of waysA) {
      for (const pa of wa.geometry) {
        for (const wb of waysB) {
          for (const pb of wb.geometry) {
            const d = haversineMeters(pa.lat, pa.lon, pb.lat, pb.lon);
            if (d < 50 && (!best || d < best.d)) {
              best = { d, lat: (pa.lat + pb.lat) / 2, lon: (pa.lon + pb.lon) / 2 };
            }
          }
        }
      }
    }
    if (best) candidates.push(best);
  }

  if (!candidates.length) return null;

  // Si hay varias, la mas cercana al punto ancla (evita cruces homonimos lejanos).
  candidates.sort((a, b) => haversineMeters(anchor.lat, anchor.lon, a.lat, a.lon) - haversineMeters(anchor.lat, anchor.lon, b.lat, b.lon));
  return { lat: candidates[0].lat, lon: candidates[0].lon };
}
