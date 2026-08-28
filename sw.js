// Service Worker minimo: hace que "Agregar a pantalla de inicio" instale la
// app de verdad en Android (Chrome exige un SW con "fetch" para eso) y deja
// el cascaron de la app disponible aunque se pierda la conexion un instante.
// Los datos en vivo (clima, rutas, POIs) siguen necesitando internet.

const CACHE_NAME = "mibici-shell-v1";
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
  if (url.origin !== self.location.origin) return; // dejar pasar las APIs externas tal cual

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
