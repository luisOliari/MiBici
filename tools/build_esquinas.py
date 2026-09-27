"""
Genera data/esquinas.json: TODAS las esquinas de Montevideo a partir de
OpenStreetMap, para que la busqueda "Calle y Calle" sea instantanea, completa
y funcione sin depender de servidores externos (ni de señal).

Como funciona: en OSM, dos calles que se cruzan comparten un nodo. Por cada
nodo usado por calles con nombres distintos, hay una esquina. Las avenidas
doble mano dan varios nodos a pocos metros: se juntan en un solo punto.

Uso (cada tanto, para actualizar con cambios del mapa):
    python tools/build_esquinas.py            # descarga de Overpass
    python tools/build_esquinas.py calles.json barrios.json  # usa descargas ya hechas

Datos (c) OpenStreetMap contributors, licencia ODbL.
"""

import json
import math
import sys
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import date

OVERPASS_SERVERS = [
    "https://overpass-api.de/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]

HIGHWAYS = (
    "motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|"
    "pedestrian|road|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link|"
    "service|track|cycleway"
)
QUERY = f"""[out:json][timeout:300];
area["name"="Montevideo"]["admin_level"="4"]->.mvd;
way["highway"~"^({HIGHWAYS})$"]["name"](area.mvd);
out body;>;out skel qt;"""

BARRIOS_QUERY = """[out:json][timeout:120];
area["name"="Montevideo"]["admin_level"="4"]->.mvd;
node["place"="suburb"](area.mvd);
out tags;"""

ALIAS_KEYS = ("old_name", "alt_name", "short_name", "official_name", "loc_name")
MERGE_METERS = 80  # puntos del mismo par de calles a menos de esto = misma esquina
TEE_METERS = 25  # un final de calle a menos de esto de otra calle = esquina en T
TEE_METERS_WIDE = 45  # idem contra ramblas y avenidas anchas (calzadas separadas)
WIDE_ROADS = {"motorway", "trunk", "primary", "secondary", "motorway_link", "trunk_link", "primary_link"}


def download(query):
    for url in OVERPASS_SERVERS:
        try:
            print(f"Descargando de {url} ...", file=sys.stderr)
            req = urllib.request.Request(
                url,
                data=urllib.parse.urlencode({"data": query}).encode(),
                headers={"User-Agent": "MiBici-build-esquinas/1.0"},
            )
            with urllib.request.urlopen(req, timeout=420) as res:
                return json.load(res)
        except Exception as e:  # probamos el siguiente servidor
            print(f"  fallo: {e}", file=sys.stderr)
    sys.exit("Ningun servidor de Overpass respondio")


def meters(lat1, lon1, lat2, lon2):
    kx = 111320 * math.cos(math.radians(lat1))
    return math.hypot((lat2 - lat1) * 110540, (lon2 - lon1) * kx)


def main():
    data = json.load(open(sys.argv[1], encoding="utf-8")) if len(sys.argv) > 1 else download(QUERY)
    places = json.load(open(sys.argv[2], encoding="utf-8")) if len(sys.argv) > 2 else download(BARRIOS_QUERY)
    # Barrio de cada esquina = el centro de barrio (place=suburb) mas cercano.
    suburbs = [e for e in places["elements"] if e["type"] == "node" and e["tags"].get("place") == "suburb"]
    barrios = sorted({e["tags"]["name"] for e in suburbs})
    barrio_pts = [(e["lat"], e["lon"], barrios.index(e["tags"]["name"])) for e in suburbs]

    def barrio_of(lat, lon):
        return min(barrio_pts, key=lambda b: meters(lat, lon, b[0], b[1]))[2]
    ways = [e for e in data["elements"] if e["type"] == "way"]
    coords = {e["id"]: (e["lat"], e["lon"]) for e in data["elements"] if e["type"] == "node"}

    names = sorted({w["tags"]["name"].strip() for w in ways})
    name_idx = {n: i for i, n in enumerate(names)}

    # Nombres viejos / alternativos -> nombre oficial ("Propios" -> Bv. Batlle y Ordóñez)
    aliases = set()
    for w in ways:
        official = name_idx[w["tags"]["name"].strip()]
        for k in ALIAS_KEYS:
            for alias in w["tags"].get(k, "").split(";"):
                alias = alias.strip()
                if alias and alias != names[official]:
                    aliases.add((alias, official))

    # Nodo -> calles que pasan por el
    node_streets = defaultdict(set)
    for w in ways:
        idx = name_idx[w["tags"]["name"].strip()]
        for nid in w["nodes"]:
            node_streets[nid].add(idx)

    # Par de calles -> puntos donde se tocan, agrupados por cercania
    pairs = defaultdict(list)  # (a,b) -> [[lat, lon, n], ...]
    for nid, streets in node_streets.items():
        if len(streets) < 2 or nid not in coords:
            continue
        lat, lon = coords[nid]
        streets = sorted(streets)
        for i in range(len(streets)):
            for j in range(i + 1, len(streets)):
                clusters = pairs[(streets[i], streets[j])]
                for c in clusters:
                    if meters(c[0], c[1], lat, lon) < MERGE_METERS:
                        c[2] += 1
                        c[0] += (lat - c[0]) / c[2]
                        c[1] += (lon - c[1]) / c[2]
                        break
                else:
                    clusters.append([lat, lon, 1])

    # Calles que terminan "contra" otra sin compartir nodo (llegan a una
    # plaza, a la rambla por un conector sin nombre, desfasaje de mapeo):
    # si un extremo queda a menos de TEE_METERS de otra calle, tambien es esquina.
    grid = defaultdict(list)  # celda ~110 m -> [(tramo, calle)]
    for w in ways:
        idx = name_idx[w["tags"]["name"].strip()]
        wide = w["tags"].get("highway") in WIDE_ROADS or w["tags"]["name"].startswith("Rambla")
        limit = TEE_METERS_WIDE if wide else TEE_METERS
        pts = [coords[n] for n in w["nodes"] if n in coords]
        for p1, p2 in zip(pts, pts[1:]):
            y0, y1 = sorted((int(p1[0] * 1000), int(p2[0] * 1000)))
            x0, x1 = sorted((int(p1[1] * 1000), int(p2[1] * 1000)))
            for gy in range(y0, y1 + 1):
                for gx in range(x0, x1 + 1):
                    grid[(gy, gx)].append((p1, p2, idx, limit))

    def closest_on_segment(lat, lon, p1, p2):
        kx = 111320 * math.cos(math.radians(lat))
        ax, ay = (p1[1] - lon) * kx, (p1[0] - lat) * 110540
        bx, by = (p2[1] - lon) * kx, (p2[0] - lat) * 110540
        dx, dy = bx - ax, by - ay
        l2 = dx * dx + dy * dy
        t = 0 if l2 == 0 else max(0, min(1, -(ax * dx + ay * dy) / l2))
        px, py = ax + t * dx, ay + t * dy
        return math.hypot(px, py), lat + py / 110540, lon + px / kx

    tees = 0
    for w in ways:
        idx = name_idx[w["tags"]["name"].strip()]
        for nid in (w["nodes"][0], w["nodes"][-1]):
            if nid not in coords:
                continue
            lat, lon = coords[nid]
            best = {}
            gy, gx = int(lat * 1000), int(lon * 1000)
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    for p1, p2, other, limit in grid.get((gy + dy, gx + dx), ()):
                        if other == idx:
                            continue
                        d, plat, plon = closest_on_segment(lat, lon, p1, p2)
                        if d < limit and d < best.get(other, (1e9,))[0]:
                            best[other] = (d, plat, plon)
            for other, (d, plat, plon) in best.items():
                key = (min(idx, other), max(idx, other))
                clusters = pairs[key]
                if any(meters(c[0], c[1], lat, lon) < MERGE_METERS for c in clusters):
                    continue
                clusters.append([plat, plon, 1])
                tees += 1
    print(f"{tees} esquinas en T agregadas", file=sys.stderr)

    flat = []
    for (a, b), clusters in sorted(pairs.items()):
        for lat, lon, _ in clusters:
            flat += [a, b, round(lat * 1e5), round(lon * 1e5), barrio_of(lat, lon)]

    out = {
        "version": 1,
        "generated": date.today().isoformat(),
        "source": "OpenStreetMap contributors (ODbL)",
        "names": names,
        "aliases": sorted([a, i] for a, i in aliases),
        "barrios": barrios,
        # Cada esquina ocupa 5 numeros: calleA, calleB, lat*1e5, lon*1e5, barrio
        "stride": 5,
        "corners": flat,
    }
    with open("data/esquinas.json", "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(names)} calles, {len(aliases)} alias, {len(flat) // 5} esquinas -> data/esquinas.json", file=sys.stderr)


if __name__ == "__main__":
    main()
