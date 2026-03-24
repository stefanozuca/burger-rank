/**
 * BurgerRank — Service Worker
 *
 * Estrategia:
 * - Cache-first → assets estáticos (HTML, CSS, JS, iconos, manifest)
 * - Network-first → llamadas a Sheets API (datos siempre frescos si hay red)
 * - Offline fallback → último caché disponible con banner en la UI
 */

const CACHE_NAME = 'burgerrank-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/share.html',
  '/manifest.json',
  '/css/styles.css',
  '/js/app.js',
  '/js/auth.js',
  '/js/sheets.js',
  '/js/maps.js',
  '/js/home.js',
  '/js/degustacion.js',
  '/js/share.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

const API_ORIGINS = [
  'https://sheets.googleapis.com',
  'https://www.googleapis.com',
];

// ── Install: pre-cachear assets estáticos ──────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // addAll falla si algún asset no existe; usamos add individual para resiliencia
      return Promise.allSettled(
        STATIC_ASSETS.map((url) => cache.add(url).catch(() => null))
      );
    }).then(() => self.skipWaiting())
  );
});

// ── Activate: limpiar caches viejos ───────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: estrategia según origen ────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignorar requests non-GET y extensiones de Chrome
  if (request.method !== 'GET' || url.protocol === 'chrome-extension:') return;

  // API calls → Network-first
  if (API_ORIGINS.some((origin) => request.url.startsWith(origin))) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Accounts Google (GSI) → siempre network, sin cachear
  if (url.hostname.includes('accounts.google.com')) return;

  // Assets estáticos → Cache-first
  event.respondWith(cacheFirst(request));
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Sin red y sin caché → fallback al index.html cacheado
    return caches.match('/index.html');
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Sin red → servir desde caché si existe
    const cached = await caches.match(request);
    if (cached) return cached;
    // Sin caché tampoco → retornar error que la app maneja como "offline"
    return new Response(JSON.stringify({ error: 'offline' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// Notificar a los clientes cuando el SW actualiza
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
