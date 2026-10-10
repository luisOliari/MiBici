"""
Genera data/talleres.json: lugares de Montevideo donde resolver un problema
con la bici o el monopatin, sacados de OpenStreetMap. Queda guardado en la
app, asi "¿donde arreglo la bici?" funciona al instante y sin señal.

Tipos:
  taller   - bicicleterias / talleres de bici (shop=bicycle, craft=bicycle,
             o cualquier comercio con service:bicycle:repair=yes)
  estacion - estaciones publicas de autoreparacion (herramientas + inflador)
  gomeria  - gomerias de barrio (sin marca de autos): suelen arreglar pinchaduras
  aire     - estaciones de servicio (aire para inflar)

Uso (cada tanto, para actualizar):
    python tools/build_talleres.py            # descarga de Overpass
    python tools/build_talleres.py datos.json # usa una descarga ya hecha

Datos (c) OpenStreetMap contributors, licencia ODbL.
"""

import json
import sys
import urllib.parse
import urllib.request
from datetime import date

OVERPASS_SERVERS = [
    "https://overpass-api.de/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]
BBOX = "-34.95,-56.45,-34.68,-56.0"  # Montevideo (sur,oeste,norte,este)
QUERY = f"""[out:json][timeout:120];
(
  nwr["shop"="bicycle"]({BBOX});
  nwr["craft"="bicycle"]({BBOX});
  nwr["service:bicycle:repair"="yes"]({BBOX});
  nwr["amenity"="bicycle_repair_station"]({BBOX});
  nwr["shop"="tyres"]({BBOX});
  nwr["amenity"="fuel"]({BBOX});
);
out tags center;"""

CAR_TYRE_WORDS = (
    "toyo", "pirelli", "bridgestone", "firestone", "michelin", "goodyear", "petinsa", "rasa", "grip",
    "neum", "tire", "tyre", "continental", "dunlop", "hankook", "car center", "automotor", "camion",
)

DEFAULT_NAMES = {
    "taller": "Taller de bicicletas",
    "estacion": "Estación de reparación",
    "gomeria": "Gomería",
    "aire": "Estación de servicio",
}


def download():
    for url in OVERPASS_SERVERS:
        try:
            print(f"Descargando de {url} ...", file=sys.stderr)
            req = urllib.request.Request(
                url,
                data=urllib.parse.urlencode({"data": QUERY}).encode(),
                headers={"User-Agent": "MiBici-build-talleres/1.0"},
            )
            with urllib.request.urlopen(req, timeout=180) as res:
                return json.load(res)
        except Exception as e:  # probamos el siguiente servidor
            print(f"  fallo: {e}", file=sys.stderr)
    sys.exit("Ningun servidor de Overpass respondio")


def classify(t):
    if t.get("amenity") == "bicycle_repair_station":
        return "estacion"
    if t.get("shop") == "bicycle" or t.get("craft") == "bicycle" or t.get("service:bicycle:repair") == "yes":
        # Un local que solo vende (sin taller) no sirve para una pinchadura.
        return None if t.get("service:bicycle:repair") == "no" else "taller"
    if t.get("shop") == "tyres":
        # Las cadenas de neumaticos de auto (Pirelli, Bridgestone...) no arreglan bicis.
        name = (t.get("name", "") + " " + t.get("operator", "")).lower()
        car = any(w in name for w in CAR_TYRE_WORDS)
        return None if t.get("brand") or car else "gomeria"
    if t.get("amenity") == "fuel":
        return "aire"
    return None


def main():
    data = json.load(open(sys.argv[1], encoding="utf-8")) if len(sys.argv) > 1 else download()
    places = []
    for e in data["elements"]:
        t = e.get("tags", {})
        kind = classify(t)
        lat = e.get("lat") or e.get("center", {}).get("lat")
        lon = e.get("lon") or e.get("center", {}).get("lon")
        if not kind or lat is None:
            continue
        place = {"t": kind, "n": t.get("name") or t.get("brand") or DEFAULT_NAMES[kind], "lat": round(lat, 5), "lon": round(lon, 5)}
        address = " ".join(x for x in (t.get("addr:street"), t.get("addr:housenumber")) if x)
        if address:
            place["a"] = address
        for key, tag in (("p", "phone"), ("p", "contact:phone"), ("h", "opening_hours"), ("w", "website")):
            if t.get(tag) and key not in place:
                place[key] = t[tag]
        places.append(place)

    # Esquina mas cercana (del indice de esquinas), para ubicarse rapido:
    # muchos lugares no tienen direccion cargada en el mapa.
    try:
        esq = json.load(open("data/esquinas.json", encoding="utf-8"))
        c, st = esq["corners"], esq.get("stride", 4)
        corners = [(c[i + 2] / 1e5, c[i + 3] / 1e5, c[i], c[i + 1]) for i in range(0, len(c), st)]
        for p in places:
            lat, lon, a, b = min(corners, key=lambda k: (k[0] - p["lat"]) ** 2 + ((k[1] - p["lon"]) * 0.82) ** 2)
            p["c"] = f'{esq["names"][a]} y {esq["names"][b]}'
    except FileNotFoundError:
        print("  (sin data/esquinas.json: no se agrega la esquina cercana)", file=sys.stderr)

    places.sort(key=lambda p: (p["t"], p["n"], p["lat"]))
    out = {
        "version": 1,
        "generated": date.today().isoformat(),
        "source": "OpenStreetMap contributors (ODbL)",
        "places": places,
    }
    with open("data/talleres.json", "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    counts = {k: sum(1 for p in places if p["t"] == k) for k in DEFAULT_NAMES}
    print(f"{len(places)} lugares {counts} -> data/talleres.json", file=sys.stderr)


if __name__ == "__main__":
    main()
