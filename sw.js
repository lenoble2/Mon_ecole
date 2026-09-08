const CACHE_NAME = 'monecole-v1';
const assetsToCache = [
  './index.html',
  ./login.html',
  './accueil.html'
  // Ajoutez vos autres fichiers essentiels ici
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(assetsToCache);
    })
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});
