// Service Worker minimo: hace que "Agregar a pantalla de inicio" instale la
// app de verdad en Android (Chrome exige un SW con "fetch" para eso) y deja
// el cascaron de la app disponible aunque se pierda la conexion un instante.
// Los datos en vivo (clima, rutas, POIs) siguen necesitando internet.

const CACHE_NAME = "mibici-shell-v3";
const TILE_CACHE_NAME = "mibici-tiles-v1";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/weather.js",
  "./js/poi.js",
  "./js/bikelanes.js",
  "./js/intersection.js",
  "./js/voice.js",
  "./js/app.js",
  "./vendor/leaflet.css",
  "./vendor/leaflet.js",
  "./manifest.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// Network-first para el shell: si hay internet, siempre trae la version mas
// nueva (y la deja en cache); si falla, usa lo cacheado. Las llamadas a APIs
// externas (open-meteo, nominatim, overpass, openrouteservice) no se tocan.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Mosaicos del mapa (OpenStreetMap): cache-first para que el mapa no se
  // vea gris si se corta la señal un instante mientras vas en bici. Se
  // actualiza en segundo plano cuando hay conexion.
  if (/tile\.openstreetmap\.org$/.test(url.hostname)) {
    event.respondWith(
      caches.open(TILE_CACHE_NAME).then((cache) =>
        cache.match(event.request).then((cached) => {
          const network = fetch(event.request)
            .then((res) => {
              cache.put(event.request, res.clone());
              return res;
            })
            .catch(() => cached);
          return cached || network;
        })
      )
    );
    return;
  }

  if (url.origin !== self.location.origin) return; // dejar pasar el resto de APIs externas tal cual

  // OJO: fetch(event.request) por si solo puede resolverse desde el cache
  // HTTP normal del navegador (no el de este Service Worker) si el servidor
  // no manda headers agresivos anti-cache — GitHub Pages cachea varios
  // minutos. Eso hacia que "network-first" en realidad sirviera una version
  // vieja sin que nos dieramos cuenta. Con cache:"no-store" forzamos que
  // esto SIEMPRE vaya a buscar la version real y actual al servidor.
  const freshRequest = new Request(event.request.url, { cache: "no-store" });

  event.respondWith(
    fetch(freshRequest)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
