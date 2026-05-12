// Nombres de caché con control de versiones
const CACHE_NAME = 'serrucho-static-v1';
const DATA_CACHE_NAME = 'serrucho-data-v1';

// App Shell básico para pre-caché
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.ico',
  '/icon.png',
];

// Instalación: Pre-caché del App Shell y salto de espera
self.addEventListener('install', (event) => {
  console.log('SW: Instalando...');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('SW: Pre-cacheando assets...');
      // Intentamos cachear cada uno por separado para que si uno falla el resto siga
      return Promise.allSettled(
        PRECACHE_ASSETS.map(asset => 
          cache.add(asset).catch(err => console.error(`SW: Error cacheando ${asset}:`, err))
        )
      );
    }).then(() => {
      console.log('SW: Pre-caché finalizado');
      return self.skipWaiting();
    })
  );
});

// Activación: Limpieza de versiones de caché antiguas
self.addEventListener('activate', (event) => {
  const currentCaches = [CACHE_NAME, DATA_CACHE_NAME];
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (!currentCaches.includes(cacheName)) {
            console.log('SW: Eliminando caché antigua:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Interceptor de peticiones Fetch
self.addEventListener('fetch', (event) => {
  // Solo interceptamos peticiones GET
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // ESTRATEGIA: Network First para Datos (Supabase / API)
  // Intentamos obtener datos frescos, si falla (offline), usamos el caché.
  if (url.hostname.includes('supabase.co') || url.pathname.includes('/api/')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Si la respuesta es válida, la guardamos en el caché de datos
          if (response && response.status === 200) {
            const responseClone = response.clone();
            caches.open(DATA_CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return response;
        })
        .catch(() => {
          // Si no hay red, buscamos en el caché de datos
          return caches.match(event.request);
        })
    );
    return;
  }

  // ESTRATEGIA: Cache First para Assets Estáticos (JS, CSS, Imágenes, Fuentes)
  // Servimos desde el caché para velocidad, y actualizamos en segundo plano si es necesario.
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      // Si no está en caché, vamos a la red
      return fetch(event.request).then((response) => {
        // Ignorar esquemas no soportados (como chrome-extension://) y respuestas no exitosas
        const isSupportedScheme = event.request.url.startsWith('http');
        
        if (!isSupportedScheme || !response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }

        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });

        return response;
      }).catch(() => {
        // Si falla la red y es una navegación, devolvemos el index.html (App Shell)
        if (event.request.mode === 'navigate') {
          return caches.match('/');
        }
      });
    })
  );
});
