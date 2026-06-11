// ═══════════════════════════════════════════════════════════════════════════════
// Service Worker — El Serrucho GO PWA
// Strategy: Offline-First App Shell + Network-First Data
// ═══════════════════════════════════════════════════════════════════════════════

const CACHE_VERSION = 'v4';
const STATIC_CACHE  = `serrucho-static-${CACHE_VERSION}`;
const DATA_CACHE    = `serrucho-data-${CACHE_VERSION}`;
const FONT_CACHE    = `serrucho-fonts-${CACHE_VERSION}`;

// ── Pre-cache: critical app shell assets ────────────────────────────────────
// These are cached on install so the app always has a baseline to load from.
const PRECACHE_ASSETS = [
  '/',                          // index.html (SPA entry)
  '/manifest.webmanifest',
  '/elserruchogo512x512.png',
  '/apple-touch-icon.png',
];

// ── Helpers ─────────────────────────────────────────────────────────────────

function isNavigationRequest(request) {
  return (
    request.mode === 'navigate' ||
    (request.method === 'GET' &&
      request.headers.get('accept') &&
      request.headers.get('accept').includes('text/html'))
  );
}

function isSupabaseRequest(url) {
  return url.hostname.includes('supabase.co') || url.hostname.includes('supabase.in');
}

function isApiRequest(url) {
  return isSupabaseRequest(url) || url.pathname.startsWith('/api/');
}

function isStaticAsset(url) {
  return (
    url.pathname.startsWith('/_expo/') ||
    url.pathname.startsWith('/assets/') ||
    /\.(js|css|woff2?|ttf|otf|eot)$/i.test(url.pathname)
  );
}

function isFontRequest(url) {
  return (
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com') ||
    /\.(woff2?|ttf|otf|eot)$/i.test(url.pathname)
  );
}

function isImageRequest(url) {
  return /\.(png|jpg|jpeg|gif|svg|webp|ico)$/i.test(url.pathname);
}

// ── Install ─────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  console.log('[SW] Installing...');
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => {
        console.log('[SW] Pre-caching app shell...');
        return Promise.allSettled(
          PRECACHE_ASSETS.map((asset) =>
            cache.add(asset).catch((err) =>
              console.warn(`[SW] Failed to pre-cache ${asset}:`, err)
            )
          )
        );
      })
      .then(() => {
        console.log('[SW] Pre-cache complete');
        return self.skipWaiting();
      })
  );
});

// ── Activate ────────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  const keepCaches = [STATIC_CACHE, DATA_CACHE, FONT_CACHE];
  event.waitUntil(
    caches.keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => !keepCaches.includes(name))
            .map((name) => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        )
      )
      .then(() => self.clients.claim())
  );
});

// ── Fetch ───────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Skip non-http(s) schemes (chrome-extension, etc.)
  if (!url.protocol.startsWith('http')) return;

  // ─── STRATEGY 1: Supabase / API → Network-first, cache fallback ─────────
  // We try the network for fresh data. If offline, serve cached response.
  // Supabase auth tokens are in localStorage so getSession() works offline.
  if (isApiRequest(url)) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(DATA_CACHE).then((cache) => {
              cache.put(event.request, clone);
            });
          }
          return response;
        })
        .catch(() => {
          // Offline → serve cached API response if available
          return caches.match(event.request).then((cached) => {
            if (cached) return cached;
            // Return an empty but valid JSON response so the app doesn't crash
            return new Response(JSON.stringify({ data: null, error: 'offline' }), {
              status: 503,
              headers: { 'Content-Type': 'application/json' },
            });
          });
        })
    );
    return;
  }

  // ─── STRATEGY 2: Fonts → Cache-first, network fallback ──────────────────
  // Fonts never change, cache indefinitely.
  if (isFontRequest(url)) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(FONT_CACHE).then((cache) => {
              cache.put(event.request, clone);
            });
          }
          return response;
        }).catch(() => {
          // Font not available offline — return empty response
          return new Response('', { status: 503 });
        });
      })
    );
    return;
  }

  // ─── STRATEGY 3: Navigation (HTML) → Network-first, cache fallback ──────
  // Always try fresh HTML first (to pick up new deploys), but serve cached
  // if offline. The SPA entry '/' is our universal fallback.
  if (isNavigationRequest(event.request)) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(STATIC_CACHE).then((cache) => {
              cache.put(event.request, clone);
              // Also update the '/' cache so the root SPA entry stays fresh
              if (url.pathname !== '/') {
                cache.put(new Request('/'), clone.clone());
              }
            });
          }
          return response;
        })
        .catch(() => {
          // Offline → serve exact cached page or fallback to '/'
          return caches.match(event.request).then((cached) => {
            return cached || caches.match('/');
          });
        })
    );
    return;
  }

  // ─── STRATEGY 4: Static assets (JS/CSS/images) → Cache-first ───────────
  // Expo bundles are hashed (_expo/static/...), so once cached they're valid
  // forever. Images and other assets are also cached on first load.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      return fetch(event.request)
        .then((response) => {
          if (!response || response.status !== 200) return response;
          // Only cache same-origin and cdn responses
          if (response.type !== 'basic' && response.type !== 'cors') return response;

          const clone = response.clone();
          const cacheName = isImageRequest(url) ? STATIC_CACHE : STATIC_CACHE;
          caches.open(cacheName).then((cache) => {
            cache.put(event.request, clone);
          });

          return response;
        })
        .catch(() => {
          // Asset not available offline
          // For images, return nothing (UI will handle missing images)
          if (isImageRequest(url)) {
            return new Response('', { status: 503 });
          }
          return new Response('', { status: 503 });
        });
    })
  );
});

// ── Background Sync (future-proof) ──────────────────────────────────────────
// If we ever need to queue mutations while offline.
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
});

// ── Web Push ────────────────────────────────────────────────────────────────
// Recibe el push del servidor (Edge Function send-push) y muestra la notificación
// AUNQUE la app esté cerrada o en segundo plano.
self.addEventListener('push', (event) => {
  let data = { title: 'El Serrucho GO', body: '', url: '/' };
  try {
    if (event.data) data = Object.assign(data, event.data.json());
  } catch (e) {
    if (event.data) data.body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/elserruchogo512x512.png',
      badge: '/elserruchogo512x512.png',
      data: { url: data.url || '/' },
      vibrate: [200, 100, 200],
      tag: 'serrucho-' + (data.url || 'notif'),
      renotify: true,
    })
  );
});

// Al tocar la notificación: enfocar la app (o abrirla) en la pantalla correspondiente.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          if ('navigate' in client) { try { client.navigate(targetUrl); } catch (e) {} }
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
