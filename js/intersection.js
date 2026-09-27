// ---------------------------------------------------------------------------
// Busqueda de CRUCES DE CALLES ("Julio César y 26 de Marzo").
//
// 0) Indice propio (data/esquinas.json): TODAS las esquinas de Montevideo
//    calculadas de OpenStreetMap con tools/build_esquinas.py. Instantaneo,
//    completo, entiende nombres viejos ("Propios") y anda sin señal.
// 1) Si la calle no esta en el indice (calle nueva, fuera de Montevideo):
//    Nominatim trae los tramos de cada calle y calculamos donde se cortan.
// 2) En paralelo, como respaldo: Overpass (varios servidores a la vez).
// ---------------------------------------------------------------------------

// "A y B", "A esq. B", "A esquina B", "A con B", "A & B", "A / B", "A e Isla de Flores"
const INTERSECTION_SEPARATOR = /\s+(?:y|esq\.?|esquina(?:\s+con)?|con|&|\/|e(?=\s+h?i))\s+/i;

const OVERPASS_SERVERS = [
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const MVD_BBOX = "-34.95,-56.42,-34.70,-55.95"; // sur,oeste,norte,este (Overpass)

// Todas las formas posibles de partir el texto en dos calles. Hace falta
// porque hay calles con "y" en el nombre ("Batlle y Ordóñez y 8 de Octubre").
function parseIntersectionCandidates(text) {
  const re = new RegExp(INTERSECTION_SEPARATOR.source, "gi");
  const pairs = [];
  let m;
  while ((m = re.exec(text))) {
    const a = text.slice(0, m.index).trim();
    const b = text.slice(m.index + m[0].length).trim();
    if (a.length >= 1 && b.length >= 1) pairs.push([a, b]);
  }
  return pairs;
}

function parseIntersectionQuery(text) {
  return parseIntersectionCandidates(text)[0] || null;
}

// Esquina escrita como texto libre: prueba cada forma de partirlo.
async function findCornersFromText(text, near) {
  for (const [a, b] of parseIntersectionCandidates(text).slice(0, 3)) {
    const found = await findStreetIntersections(a, b, near).catch(() => []);
    if (found.length) return found;
  }
  return [];
}

// --- Nombres de calles ---------------------------------------------------

// Abreviaturas comunes en Montevideo.
const STREET_ABBREVIATIONS = [
  [/^(av|avda)\.?\s+/i, "Avenida "],
  [/^(bv|bvar|blvr)\.?\s+/i, "Bulevar "],
  [/^gral\.?\s+/i, "General "],
  [/^dr\.?\s+/i, "Doctor "],
  [/^ing\.?\s+/i, "Ingeniero "],
  [/^pte\.?\s+/i, "Presidente "],
  [/^cno\.?\s+/i, "Camino "],
  [/^rbla\.?\s+/i, "Rambla "],
  [/^cnel\.?\s+/i, "Coronel "],
  [/^mcal\.?\s+/i, "Mariscal "],
  [/^sta\.?\s+/i, "Santa "],
  [/^sto\.?\s+/i, "Santo "],
];

function expandStreetName(name) {
  let s = name.trim().replace(/^calle\s+/i, "");
  for (const [re, full] of STREET_ABBREVIATIONS) s = s.replace(re, full);
  return s;
}

function stripAccents(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Palabras "de relleno" que la gente pone o saca: "Av. Gral. Rivera" = "Rivera".
const GENERIC_WORDS = new Set([
  "avenida", "bulevar", "calle", "camino", "rambla", "pasaje", "doctor", "dr", "general", "gral",
  "ingeniero", "presidente", "coronel", "mariscal", "de", "del", "la", "las", "los", "el", "y", "e",
]);

// Todas las palabras del nombre, sin acentos ni mayusculas.
function allWords(name) {
  return stripAccents(expandStreetName(name)).toLowerCase().replace(/[.,]/g, " ").split(/\s+/).filter(Boolean);
}

// Palabras significativas del nombre (sin "Avenida", "General", "de"...).
function keyWords(name) {
  const words = allWords(name);
  const key = words.filter((w) => !GENERIC_WORDS.has(w));
  // "Rambla" sola: si no queda nada, usamos lo que haya.
  return key.length ? key : words;
}

// Lo escrito es solo una palabra generica ("Rambla", "Bulevar")?
function isGenericQuery(name) {
  return allWords(name).every((w) => GENERIC_WORDS.has(w));
}

// Regex que tolera acentos (Overpass no los ignora): "fernandez" -> "f[eé]rn[aá]nd[eé]z".
function accentTolerant(word) {
  const map = { a: "[aáà]", e: "[eéè]", i: "[iíì]", o: "[oóò]", u: "[uúüù]", n: "[nñ]" };
  return word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[aeioun]/g, (c) => map[c]);
}

// Todas las palabras clave, en orden, cada una al inicio de una palabra.
function streetNameRegexSource(name) {
  return keyWords(name)
    .map((w) => `(^| )${accentTolerant(w)}`)
    .join(".*");
}

// Que tan bien coincide un nombre de OSM con lo que escribio el usuario (0..1).
// Sirve para preferir "Avenida General Rivera" sobre "Rivera Indarte".
function nameScore(osmName, query) {
  if (!osmName) return 0;
  const q = keyWords(query);
  const n = keyWords(osmName);
  const hits = q.filter((w) => n.includes(w)).length;
  return hits / Math.max(n.length, q.length);
}

function namesMatch(osmName, queryName) {
  if (!osmName) return false;
  return new RegExp(streetNameRegexSource(queryName), "i").test(stripAccents(osmName));
}

// --- Geometria ------------------------------------------------------------

// Interseccion de dos segmentos [lon,lat]. Devuelve [lon,lat] o null.
function segmentIntersection(p1, p2, p3, p4) {
  const [x1, y1] = p1, [x2, y2] = p2, [x3, y3] = p3, [x4, y4] = p4;
  const d = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(d) < 1e-14) return null; // paralelas
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / d;
  const u = ((x1 - x3) * (y1 - y2) - (y1 - y3) * (x1 - x2)) / d;
  const eps = 1e-9; // tolera que las calles se toquen justo en un extremo
  if (t < -eps || t > 1 + eps || u < -eps || u > 1 + eps) return null;
  return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
}

// lines: [{ street, barrio, coords: [[lon,lat],...] }]
function crossSegments(linesA, linesB) {
  const hits = [];
  for (const a of linesA) {
    for (const b of linesB) {
      for (let i = 0; i < a.coords.length - 1; i++) {
        for (let j = 0; j < b.coords.length - 1; j++) {
          const hit = segmentIntersection(a.coords[i], a.coords[i + 1], b.coords[j], b.coords[j + 1]);
          if (hit) hits.push({ lon: hit[0], lat: hit[1], a, b });
        }
      }
    }
  }
  // Si en los datos no se tocan exacto (desfasaje de mapeo, calle que termina
  // contra otra), el par de nodos mas cercano.
  if (!hits.length) {
    let best = null;
    for (const a of linesA) {
      for (const pa of a.coords) {
        for (const b of linesB) {
          for (const pb of b.coords) {
            const d = haversineMeters(pa[1], pa[0], pb[1], pb[0]);
            if (d < 30 && (!best || d < best.d)) best = { d, lon: (pa[0] + pb[0]) / 2, lat: (pa[1] + pb[1]) / 2, a, b };
          }
        }
      }
    }
    if (best) hits.push(best);
  }
  return hits;
}

// Junta los cruces que en realidad son la misma esquina (una avenida doble
// mano con dos calzadas da 2-4 puntos a pocos metros). Uno por esquina.
function clusterHits(hits, radiusMeters = 70) {
  const clusters = [];
  for (const h of hits) {
    const c = clusters.find((c) => haversineMeters(c.lat, c.lon, h.lat, h.lon) < radiusMeters);
    if (c) {
      c.n++;
      c.lat += (h.lat - c.lat) / c.n;
      c.lon += (h.lon - c.lon) / c.n;
    } else {
      clusters.push({ lat: h.lat, lon: h.lon, a: h.a, b: h.b, n: 1 });
    }
  }
  return clusters;
}

// --- Metodo 0: indice de esquinas precalculado -----------------------------

let cornerIndexPromise = null;

function loadCornerIndex() {
  if (!cornerIndexPromise) {
    cornerIndexPromise = fetch("data/esquinas.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(buildCornerIndex)
      .catch((e) => {
        cornerIndexPromise = null; // reintentar la proxima vez
        throw e;
      });
  }
  return cornerIndexPromise;
}

function buildCornerIndex(data) {
  const entries = []; // { idx, words } — una por nombre oficial y por alias
  data.names.forEach((n, idx) => entries.push({ idx, words: keyWords(n), all: allWords(n) }));
  data.aliases.forEach(([alias, idx]) => entries.push({ idx, words: keyWords(alias), all: allWords(alias), alias }));
  const byPair = new Map();
  const c = data.corners;
  const stride = data.stride || 4;
  for (let i = 0; i < c.length; i += stride) {
    const key = `${c[i]}|${c[i + 1]}`;
    if (!byPair.has(key)) byPair.set(key, []);
    byPair.get(key).push({ lat: c[i + 2] / 1e5, lon: c[i + 3] / 1e5, barrio: data.barrios?.[c[i + 4]] || "" });
  }
  return { names: data.names, entries, byPair };
}

// Que tan bien coinciden las palabras escritas con las de un nombre (0..1).
// Todas las palabras escritas tienen que estar (exactas o como comienzo de
// palabra, para tolerar "Scoser" o nombres a medio escribir).
function wordsScore(queryWords, nameWords) {
  let total = 0;
  for (const q of queryWords) {
    let best = 0;
    for (const w of nameWords) {
      if (w === q) best = 1;
      else if (best < 0.8 && q.length >= 3 && w.startsWith(q)) best = 0.8;
    }
    if (!best) return 0;
    total += best;
  }
  // Penaliza palabras de mas: "Rivera" prefiere "Av. Gral. Rivera" a "Rivera Indarte".
  return total / Math.max(queryWords.length, nameWords.length);
}

// Calles del indice que coinciden con lo escrito: [{ idx, score }]
function matchStreetNames(index, query) {
  const q = keyWords(query);
  const generic = isGenericQuery(query); // "Rambla" -> cualquier rambla
  const best = new Map();
  for (const e of index.entries) {
    const sc = generic ? (e.all.includes(q[0]) ? 0.5 : 0) : wordsScore(q, e.words);
    if (sc > (best.get(e.idx) || 0)) best.set(e.idx, sc);
  }
  return [...best.entries()]
    .map(([idx, score]) => ({ idx, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 60);
}

async function intersectViaIndex(streetA, streetB) {
  const index = await loadCornerIndex();
  const candA = matchStreetNames(index, streetA);
  const candB = matchStreetNames(index, streetB);
  const hits = [];
  for (const a of candA) {
    for (const b of candB) {
      if (a.idx === b.idx) continue;
      const key = a.idx < b.idx ? `${a.idx}|${b.idx}` : `${b.idx}|${a.idx}`;
      for (const p of index.byPair.get(key) || []) {
        hits.push({
          lat: p.lat,
          lon: p.lon,
          a: { street: index.names[a.idx], barrio: p.barrio },
          b: { street: index.names[b.idx], barrio: "" },
          score: a.score + b.score,
        });
      }
    }
  }
  return hits;
}

// --- Metodo 1: Nominatim ---------------------------------------------------

// Caja (viewbox de Nominatim) que envuelve unas lineas, con margen.
function viewboxAround(lines, pad = 0.004) {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  lines.forEach((l) =>
    l.coords.forEach(([lon, lat]) => {
      minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
      minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
    })
  );
  return `${minLon - pad},${maxLat + pad},${maxLon + pad},${minLat - pad}`;
}

const NOMINATIM_PAGE = 40; // maximo que devuelve Nominatim por consulta

// Una pagina de tramos de una calle. `exclude` = place_ids ya traidos (paginado).
async function fetchSegmentsPage(query, viewbox, exclude) {
  const params = new URLSearchParams({
    format: "json",
    limit: String(NOMINATIM_PAGE),
    dedupe: "0",
    polygon_geojson: "1",
    namedetails: "1",
    countrycodes: "uy",
    viewbox,
    bounded: "1",
    q: `${query}, Montevideo`,
  });
  if (exclude?.length) params.set("exclude_place_ids", exclude.join(","));
  const res = await fetch(`${NOMINATIM_URL}?${params}`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  return res.json();
}

function resultToLines(r) {
  const lines = r.geojson.type === "LineString" ? [r.geojson.coordinates] : r.geojson.coordinates;
  const parts = r.display_name.split(",").map((s) => s.trim());
  const barrio = parts[1] && parts[1] !== "Montevideo" ? parts[1] : "";
  const street = r.namedetails?.name || parts[0];
  return lines.map((coords) => ({ street, barrio, coords }));
}

// Coincide con lo escrito por nombre actual, viejo o alternativo ("Propios").
function resultMatches(r, query) {
  const names = Object.values(r.namedetails || {}).concat(r.display_name.split(",")[0]);
  return names.some((n) => namesMatch(n, query));
}

// Tramos de una calle. Si la primera pagina vino llena, sigue paginando
// (hasta maxPages). Devuelve { lines, complete, official }.
async function fetchStreetSegments(name, { viewbox = MONTEVIDEO_VIEWBOX, maxPages = 1, official } = {}) {
  const query = official || expandStreetName(name);
  const seen = [];
  const lines = [];
  const officialCount = new Map();
  let complete = false;
  for (let page = 0; page < maxPages; page++) {
    const data = await fetchSegmentsPage(query, viewbox, seen);
    data.forEach((r) => {
      seen.push(r.place_id);
      if (r.class !== "highway" || !r.geojson || !/LineString/.test(r.geojson.type)) return;
      const ok = official ? r.namedetails?.name === official : resultMatches(r, name);
      if (!ok) return;
      lines.push(...resultToLines(r));
      const n = r.namedetails?.name;
      if (n) officialCount.set(n, (officialCount.get(n) || 0) + 1);
    });
    if (data.length < NOMINATIM_PAGE) {
      complete = true;
      break;
    }
  }
  const top = [...officialCount.entries()].sort((a, b) => b[1] - a[1])[0];
  return { lines, complete, official: official || top?.[0] };
}

async function intersectViaNominatim(streetA, streetB) {
  // 1) Una pagina de cada una: resuelve la gran mayoria de las esquinas.
  let A = await fetchStreetSegments(streetA);
  if (!A.lines.length) return [];
  let B = await fetchStreetSegments(streetB);
  if (!B.lines.length) return [];
  let found = clusterHits(crossSegments(A.lines, B.lines));
  if (found.length) return found;

  // 2) Si una vino cortada (avenida larga), la traemos completa pero solo en
  //    la zona por donde pasa la otra. Buscamos por el nombre oficial, asi
  //    "Propios" trae tambien los tramos que no tienen cargado el nombre viejo.
  if (!A.complete && B.complete) {
    const moreA = await fetchStreetSegments(streetA, { viewbox: viewboxAround(B.lines), maxPages: 4, official: A.official });
    found = clusterHits(crossSegments(moreA.lines, B.lines));
    if (found.length) return found;
  }
  if (!B.complete && A.complete) {
    const moreB = await fetchStreetSegments(streetB, { viewbox: viewboxAround(A.lines), maxPages: 4, official: B.official });
    found = clusterHits(crossSegments(A.lines, moreB.lines));
    if (found.length) return found;
  }
  if (A.complete && B.complete) return []; // las tenemos enteras: de verdad no se cruzan

  // 3) Las dos largas (ej. Av. Italia y Bv. Artigas): traemos las dos
  //    completas por nombre oficial.
  const fullA = A.complete ? A : await fetchStreetSegments(streetA, { maxPages: 8, official: A.official });
  const fullB = B.complete ? B : await fetchStreetSegments(streetB, { maxPages: 8, official: B.official });
  return clusterHits(crossSegments(fullA.lines, fullB.lines));
}

// --- Metodo 2: Overpass (datos completos, nombres viejos/alternativos) -----

// Pide la misma consulta a varios servidores a la vez y se queda con el
// primero que responde bien (el principal seguido da 504 por sobrecarga).
async function queryOverpassFast(query, timeoutMs = 25000) {
  const controllers = [];
  const attempt = (url, delayMs) =>
    new Promise((resolve, reject) => {
      setTimeout(async () => {
        const ctrl = new AbortController();
        controllers.push(ctrl);
        const timer = setTimeout(() => ctrl.abort(), timeoutMs);
        try {
          const res = await fetch(url, {
            method: "POST",
            body: new URLSearchParams({ data: query }),
            signal: ctrl.signal,
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json = await res.json();
          if (json.remark && /error|timed out/i.test(json.remark) && !json.elements?.length) throw new Error(json.remark);
          resolve(json);
        } catch (e) {
          reject(e);
        } finally {
          clearTimeout(timer);
        }
      }, delayMs);
    });
  try {
    // Los dos primeros ya; los otros un poco despues por si esos fallan.
    return await Promise.any(OVERPASS_SERVERS.map((u, i) => attempt(u, i < 2 ? 0 : 2500)));
  } finally {
    controllers.forEach((c) => c.abort());
  }
}

function waysToLines(ways, fallbackName) {
  return ways.map((w) => ({
    street: w.tags?.name || fallbackName,
    barrio: "",
    tags: w.tags || {},
    coords: w.geometry.map((p) => [p.lon, p.lat]),
  }));
}

function escapeOverpassRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\"]/g, (c) => "\\" + c);
}

// Paso 1 (liviano): nombres OFICIALES de las calles que coinciden con lo
// escrito, buscando tambien en nombre viejo/alternativo. Asi "Propios" se
// convierte en "Bulevar José Batlle y Ordóñez" y despues traemos TODOS sus
// tramos (no solo los que tienen cargado el nombre viejo).
async function resolveOfficialNames(street) {
  const re = streetNameRegexSource(street).replace(/"/g, "");
  const keys = ["name", "old_name", "alt_name", "official_name", "short_name"];
  const query = `[out:json][timeout:20];
    (${keys.map((k) => `way["highway"]["${k}"~"${re}",i](${MVD_BBOX});`).join("")});
    out tags;`;
  const data = await queryOverpassFast(query);
  const names = new Map();
  data.elements.forEach((w) => {
    const n = w.tags?.name;
    if (n) names.set(n, (names.get(n) || 0) + 1);
  });
  // Las mas "parecidas" primero; limitamos para que la consulta siguiente sea chica.
  return [...names.keys()].sort((x, y) => nameScore(y, street) - nameScore(x, street)).slice(0, 8);
}

async function intersectViaOverpass(streetA, streetB) {
  const [namesA, namesB] = await Promise.all([resolveOfficialNames(streetA), resolveOfficialNames(streetB)]);
  if (!namesA.length || !namesB.length) return [];
  const exact = (names) => `^(${names.map(escapeOverpassRegex).join("|")})$`;
  // Paso 2: B en toda la ciudad; de A solo tramos a <25 m de B; de B solo los que tocan esos.
  const query = `[out:json][timeout:25];
    way["highway"]["name"~"${exact(namesB)}"](${MVD_BBOX})->.b;
    way["highway"]["name"~"${exact(namesA)}"](around.b:25)->.a;
    way.b(around.a:25)->.bb;
    (.a;.bb;);
    out geom;`;
  const data = await queryOverpassFast(query);
  const ways = data.elements.filter((e) => e.type === "way" && e.geometry?.length > 1);
  const setA = new Set(namesA);
  const setB = new Set(namesB);
  const linesA = waysToLines(ways.filter((w) => setA.has(w.tags?.name)), streetA);
  const linesB = waysToLines(ways.filter((w) => setB.has(w.tags?.name) && !setA.has(w.tags?.name)), streetB);
  return clusterHits(crossSegments(linesA, linesB));
}

// --- Punto de entrada ------------------------------------------------------

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);
}

// Todas las esquinas donde se cruzan las dos calles (puede haber mas de una:
// calles que se cruzan dos veces, o nombres parecidos en distintos barrios).
// Devuelve [{lat, lon, label, barrio}] — primero las que mejor coinciden con
// los nombres escritos y, a igualdad, las mas cercanas a `near`.
async function findStreetIntersections(streetA, streetB, near) {
  let found = await intersectViaIndex(streetA, streetB).catch(() => []);

  if (!found.length) {
    // Nominatim primero; si en 4 s no encontro nada (o fallo), Overpass arranca
    // en paralelo y gana el primero que encuentre la esquina.
    const nominatim = withTimeout(intersectViaNominatim(streetA, streetB), 25000).catch(() => []);
    const first = await Promise.race([nominatim, new Promise((r) => setTimeout(() => r(null), 4000))]);
    found = first || [];
    if (!found.length) {
      const overpass = intersectViaOverpass(streetA, streetB).catch(() => []);
      const nonEmpty = (p) => p.then((r) => (r.length ? r : Promise.reject(new Error("vacio"))));
      found = await Promise.any([nonEmpty(nominatim), nonEmpty(overpass)]).catch(() => []);
    }
    found.forEach((h) => (h.score = nameScore(h.a.street, streetA) + nameScore(h.b.street, streetB)));
  }

  const scored = found.map((h) => ({ ...h, dist: near ? haversineMeters(near.lat, near.lon, h.lat, h.lon) : 0 }));
  // Primero la mejor coincidencia de nombres; si es parecida, la mas cercana a vos.
  const bucket = (h) => Math.round(h.score * 3);
  scored.sort((x, y) => bucket(y) - bucket(x) || x.dist - y.dist);

  // Si hay una coincidencia claramente mejor, no mostramos las dudosas.
  const top = scored.length ? bucket(scored[0]) : 0;
  // Rotondas y cruces grandes dan el mismo par de calles a pocos metros: uno solo.
  const kept = [];
  for (const h of scored) {
    if (bucket(h) < top - 1) continue;
    const label = `${h.a.street} y ${h.b.street}`;
    if (kept.some((k) => k.label === label && haversineMeters(k.lat, k.lon, h.lat, h.lon) < 150)) continue;
    kept.push({ ...h, label });
  }
  return kept
    .slice(0, 5)
    .map((h) => ({
      lat: h.lat,
      lon: h.lon,
      barrio: h.a.barrio || h.b.barrio || "",
      distance: near ? h.dist : null,
      label: h.label,
    }));
}

// La esquina mas probable (o null).
async function findStreetIntersection(streetA, streetB, near) {
  const list = await findStreetIntersections(streetA, streetB, near);
  return list[0] || null;
}
