/**
 * BurgerRank — Service Worker
 *
 * Estrategia:
 * - Cache-first  → assets estáticos (HTML, CSS, JS, iconos, manifest)
 * - Network-first → llamadas a Google APIs (datos siempre frescos si hay red)
 * - Offline fallback → último caché disponible con banner en la UI
 *
 * IMPORTANTE sobre rutas:
 * Usamos rutas RELATIVAS (sin / inicial) para que funcione tanto en
 * localhost como en GitHub Pages con subfolder (/burger-rank/).
 * self.location.pathname nos da la base correcta en ambos casos.
 */

const CACHE_VERSION = 'burgerrank-v3';

// Base path del SW (e.g., '/burger-rank/' en GitHub Pages, '/' en localhost)
const BASE = self.location.pathname.replace('sw.js', '');

const STATIC_ASSETS = [
  BASE,
  BASE + 'index.html',
  BASE + 'share.html',
  BASE + 'manifest.json',
  BASE + 'css/styles.css',
  BASE + 'js/app.js',
  BASE + 'js/auth.js',
  BASE + 'js/sheets.js',
  BASE + 'js/maps.js',
  BASE + 'js/home.js',
  BASE + 'js/degustacion.js',
  BASE + 'js/share.js',
  BASE + 'config.js',
];

// Orígenes que deben ir siempre por red (datos dinámicos, nunca cache-first)
const API_ORIGINS = [
  'https://sheets.googleapis.com',
  'https://www.googleapis.com',
  'https://places.googleapis.com',   // New Places API (Text Search, Place Details, Photos)
  'https://maps.googleapis.com',
];

// ── Install: pre-cachear assets estáticos ──────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      // Promise.allSettled: si un asset falla (404, red), los demás igual se cachean
      Promise.allSettled(STATIC_ASSETS.map((url) => cache.add(url).catch(() => null)))
    ).then(() => self.skipWaiting())
  );
});

// ── Activate: limpiar caches de versiones anteriores ──────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch: estrategia según origen ────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Solo interceptar GET; POST/PUT/DELETE van directo a la red (Sheets writes, etc.)
  if (request.method !== 'GET') return;

  // Ignorar extensiones de Chrome y protocolos no-http
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return;

  // Google Accounts (OAuth, GSI) → siempre red, nunca cachear tokens/auth
  if (url.hostname.includes('accounts.google.com')) return;

  // Google APIs → Network-first (datos siempre frescos cuando hay red)
  if (API_ORIGINS.some((origin) => request.url.startsWith(origin))) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Assets propios de la app → Cache-first
  event.respondWith(cacheFirst(request));
});

// ── Estrategia Cache-first ─────────────────────────────────────────────────
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_VERSION);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Sin red y sin caché para este asset específico.
    // Intentar el index.html como fallback (SPA shell).
    const fallback = await caches.match(BASE + 'index.html')
                  || await caches.match(BASE);
    if (fallback) return fallback;

    // Si ni el index.html está cacheado (primera visita sin red), devolver 503 válido.
    // Retornar undefined aquí causaría "Failed to convert value to 'Response'".
    return new Response('Sin conexión. Abrí la app con conexión al menos una vez.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

// ── Estrategia Network-first ───────────────────────────────────────────────
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_VERSION);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Sin red → servir desde caché si existe
    const cached = await caches.match(request);
    if (cached) return cached;

    // Sin caché tampoco → 503 válido (la app lo maneja como "offline")
    return new Response(JSON.stringify({ error: 'offline' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// ── Mensajes desde la app ──────────────────────────────────────────────────
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
