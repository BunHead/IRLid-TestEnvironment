// IRLid Test Environment Service Worker
// v5.7.1a — Tier 1 of PROTOCOL.md §16 Offline-Capable Operation
//
// Caches the OrgCheckin.html shell + its static dependencies so the staff
// dashboard loads from cold even with zero connectivity, provided the
// page has been visited at least once. This is Window A of §16.8 in the
// implementation phasing — Tier 1 only. Write-queue (Tier 2), cached org
// snapshot (Tier 3), and multi-device mesh (Tier 4) are forward work.

// v5.7.1e — Bumped to v2 so the new SW activates and purges the v1 cache
// that was serving stale v5.7.1b OrgCheckin.html. Going forward, bump
// this any time HTML/JS changes need to be guaranteed-fresh on phones.
// Also: switched HTML strategy to network-first below so this manual
// bump is the *backstop*, not the only path to a fresh shell.
const CACHE_VERSION = 'irlid-shell-v2';

// Static shell assets — pre-cached on first install. Same-origin only.
const SHELL_ASSETS = [
  './OrgCheckin.html',
  './org-entry.html',
  './js/orgapi.js',
  './js/qr-fullscreen.js',
  './js/sign.js',
  './js/vendor/jsqr.min.js',
  './favicon.ico',
  './manifest.json',
];

// Vendor CDN scripts — cached on first hit (cache-first), not pre-cached
// because cross-origin pre-caching can fail under CORS restrictions.
const VENDOR_CDN_PATTERNS = [
  /^https:\/\/cdnjs\.cloudflare\.com\//,
  /^https:\/\/cdn\.jsdelivr\.net\//,
];

// Worker API origin — NEVER serve cached responses for this domain.
// Staff actions must always reach the live Worker (or fail clean for
// the Tier 2 write-queue to handle when it lands).
const WORKER_API_ORIGIN = 'https://irlid-api-test.irlid-bunhead.workers.dev';

self.addEventListener('install', (event) => {
  // Pre-cache the shell on first install. skipWaiting activates the new
  // SW immediately rather than waiting for all tabs to close.
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
      .catch((err) => {
        // Pre-cache failure is non-fatal — the SW will still serve any
        // assets it can fetch on demand later.
        console.warn('[sw] pre-cache failed:', err);
        return self.skipWaiting();
      })
  );
});

self.addEventListener('activate', (event) => {
  // Purge any old cache versions so we don't accumulate stale shells.
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith('irlid-shell-') && k !== CACHE_VERSION)
            .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Worker API: pass through, never cache. (Tier 2 will queue these
  // when offline and replay on reconnect.)
  if (url.origin === WORKER_API_ORIGIN) return;

  // Non-GETs: pass through. (POSTs for settings save etc. bypass cache.)
  if (req.method !== 'GET') return;

  // Same-origin requests:
  // v5.7.1e — HTML / navigation requests use NETWORK-FIRST so updates
  // propagate the moment the user reloads. Asset requests (.js, .css,
  // .png, .ico, .json) use cache-first for speed. Hard offline still
  // serves cached shell for navigation. This avoids the v5.7.1a-era
  // "stuck on stale shell" trap where Captain's phone was serving a
  // cached v5.7.1b OrgCheckin.html days after v5.7.1c+ deploys.
  if (url.origin === self.location.origin) {
    const isHtmlOrNav = req.mode === 'navigate' || /\.html(\?|$)/.test(url.pathname) || url.pathname.endsWith('/');
    if (isHtmlOrNav) {
      // Network-first
      event.respondWith(
        fetch(req)
          .then((response) => {
            if (response && response.ok && response.type === 'basic') {
              const responseClone = response.clone();
              caches.open(CACHE_VERSION).then((cache) => cache.put(req, responseClone));
            }
            return response;
          })
          .catch(() => {
            // Network failed (offline). Serve cached shell.
            return caches.match(req).then((cached) => cached || caches.match('./OrgCheckin.html'));
          })
      );
      return;
    }
    // Static assets: cache-first.
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req)
          .then((response) => {
            if (response && response.ok && response.type === 'basic') {
              const responseClone = response.clone();
              caches.open(CACHE_VERSION).then((cache) => cache.put(req, responseClone));
            }
            return response;
          })
          .catch(() => { throw new Error('offline'); });
      })
    );
    return;
  }

  // Vendor CDN scripts (qrcodejs, html5-qrcode, iro.js): cache-first.
  if (VENDOR_CDN_PATTERNS.some((p) => p.test(req.url))) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((response) => {
          if (response && response.ok) {
            const responseClone = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(req, responseClone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Anything else cross-origin: pass through normally.
});
