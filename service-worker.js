const CACHE_NAME = 'soundscape-v3'; // Incrementar versión para forzar actualización
const urlsToCache = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icons/icon-192.svg',
  './icons/icon-512.svg'
];

// Evento de Instalación: Cachear los archivos principales
self.addEventListener('install', event => {
  console.log('📦 Service Worker: Instalando...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('📦 Cache abierto, guardando archivos:', urlsToCache);
        return cache.addAll(urlsToCache);
      })
      .then(() => {
        console.log('✅ Service Worker: Todos los archivos cacheados');
        // Forzar la activación inmediata del nuevo Service Worker
        return self.skipWaiting();
      })
      .catch(err => {
        console.error('❌ Error al cachear archivos:', err);
      })
  );
});

// Evento de Activación: Limpiar caches antiguas
self.addEventListener('activate', event => {
  console.log('🔄 Service Worker: Activando...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          if (cache !== CACHE_NAME) {
            console.log('🗑️ Borrando cache antigua:', cache);
            return caches.delete(cache);
          }
        })
      );
    })
    .then(() => {
      console.log('✅ Service Worker: Activado y caches limpias');
      // Tomar control de todas las páginas abiertas inmediatamente
      return self.clients.claim();
    })
  );
});

// Evento de Fetch: Estrategia de cache mejorada
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Si está en caché, lo devuelve
        if (response) {
          console.log('📦 Sirviendo desde cache:', event.request.url);
          return response;
        }

        // Si no, intenta obtener de la red
        return fetch(event.request)
          .then(response => {
            // Si la respuesta es válida, cachearla para futuras visitas
            if (response && response.status === 200 && response.type === 'basic') {
              const responseToCache = response.clone();

              caches.open(CACHE_NAME)
                .then(cache => {
                  cache.put(event.request, responseToCache);
                });
            }

            return response;
          })
          .catch(err => {
            console.error('❌ Error en fetch:', err);

            // Si falla la red y es una página, mostrar página offline
            if (event.request.destination === 'document') {
              return new Response(`
                <!DOCTYPE html>
                <html>
                <head>
                  <title>SoundScape - Sin Conexión</title>
                  <meta name="viewport" content="width=device-width, initial-scale=1.0">
                  <style>
                    body {
                      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                      background: #121212; color: #f0f0f0;
                      text-align: center; padding: 2rem;
                      display: flex; flex-direction: column; justify-content: center; min-height: 100vh;
                    }
                    h1 { color: #1db954; margin-bottom: 1rem; }
                    p { margin-bottom: 1rem; }
                    button {
                      background: #1db954; color: white;
                      border: none; padding: 12px 24px;
                      border-radius: 8px; cursor: pointer;
                      font-size: 16px;
                    }
                  </style>
                </head>
                <body>
                  <h1>🎧 SoundScape</h1>
                  <p>No tienes conexión a internet</p>
                  <p>La app funcionará en modo offline una vez que cargues tus archivos de audio</p>
                  <button onclick="location.reload()">Reintentar</button>
                </body>
                </html>
              `, {
                headers: { 'Content-Type': 'text/html' }
              });
            }
          });
      })
  );
});