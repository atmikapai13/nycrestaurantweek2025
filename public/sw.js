const CACHE_NAME = 'nyc-restaurant-week-v1';
const DATA_CACHE_NAME = 'nyc-restaurant-data-v1';

// Define what to cache - handle dev vs prod paths
const urlsToCache = [
  '/',
  '/manifest.json',
  '/nyc.png',
  '/header.png',
  '/MichelinStar.svg.png',
  '/bibgourmand.png',
  '/nytimes.png',
  // Only cache actual assets that exist
];

// Install event - cache static resources
self.addEventListener('install', (event) => {
  console.log('[ServiceWorker] Install');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[ServiceWorker] Caching app shell');
        // Cache only valid URLs that exist
        return cache.addAll(urlsToCache.filter(url => 
          url.startsWith('/') || url.startsWith('http')
        ));
      })
      .catch((error) => {
        console.log('[ServiceWorker] Cache failed:', error);
        // Don't fail completely if some files can't be cached
      })
  );
  
  // Activate immediately
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[ServiceWorker] Activate');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME && cacheName !== DATA_CACHE_NAME) {
            console.log('[ServiceWorker] Removing old cache', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// Fetch event - serve cached content when offline
self.addEventListener('fetch', (event) => {
  // Skip non-http(s) requests entirely (chrome-extension, data:, blob:, etc.)
  if (!event.request.url.startsWith('http')) {
    return;
  }
  
  // Skip chrome extension and other browser-specific URLs
  if (event.request.url.includes('chrome-extension://') || 
      event.request.url.includes('moz-extension://') ||
      event.request.url.includes('extension://')) {
    return;
  }
  
  // Only log important fetches to reduce console noise
  if (event.request.url.includes('FinalData.json') || 
      event.request.url.includes('mapbox') ||
      event.request.destination === 'document') {
    console.log('[ServiceWorker] Fetch', event.request.url);
  }
  
  // Handle restaurant data API requests (both dev and prod paths)
  if (event.request.url.includes('FinalData.json') || 
      event.request.url.includes('/api/restaurants') ||
      event.request.url.includes('/data/restaurants')) {
    event.respondWith(
      caches.open(DATA_CACHE_NAME)
        .then((cache) => {
          // Try cache first, then network
          return cache.match(event.request.url)
            .then((cachedResponse) => {
              if (cachedResponse) {
                // Return cached version immediately
                return cachedResponse;
              }
              // If not in cache, try network
              return fetch(event.request)
                .then((response) => {
                  // If online, update cache and return response
                  if (response.status === 200) {
                    cache.put(event.request.url, response.clone());
                  }
                  return response;
                })
                .catch(() => {
                  // If network fails and no cache, return error
                  return new Response('Restaurant data not available offline', {
                    status: 503,
                    statusText: 'Service Unavailable'
                  });
                });
            });
        })
    );
    return;
  }

  // Handle Mapbox requests
  if (event.request.url.includes('mapbox')) {
    event.respondWith(
      caches.open(CACHE_NAME)
        .then((cache) => {
          return cache.match(event.request)
            .then((response) => {
              if (response) {
                // Return cached version if available
                return response;
              }
              // Try network first for map tiles
              return fetch(event.request)
                .then((response) => {
                  // Cache successful responses
                  if (response.status === 200) {
                    cache.put(event.request, response.clone());
                  }
                  return response;
                })
                .catch(() => {
                  // Return offline fallback for maps
                  return new Response('Offline', {
                    status: 503,
                    statusText: 'Service Unavailable'
                  });
                });
            });
        })
    );
    return;
  }

  // Handle OSM tile requests for offline fallback
  if (event.request.url.includes('tile.openstreetmap.org')) {
    event.respondWith(
      caches.open(CACHE_NAME)
        .then((cache) => {
          return cache.match(event.request)
            .then((response) => {
              if (response) {
                // Return cached OSM tile if available
                return response;
              }
              // Try to fetch OSM tile
              return fetch(event.request)
                .then((response) => {
                  // Cache successful OSM tile responses
                  if (response.status === 200) {
                    cache.put(event.request, response.clone());
                  }
                  return response;
                })
                .catch(() => {
                  // Return a placeholder tile or error
                  return new Response('Offline', {
                    status: 503,
                    statusText: 'Service Unavailable'
                  });
                });
            });
        })
    );
    return;
  }

  // Handle all other requests with cache-first strategy
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // Return cached version or fetch from network
        return response || fetch(event.request)
          .then((response) => {
            // Don't cache non-successful responses
            if (!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }

            // Clone the response
            const responseToCache = response.clone();

            caches.open(CACHE_NAME)
              .then((cache) => {
                cache.put(event.request, responseToCache);
              });

            return response;
          })
          .catch(() => {
            // Return offline fallback page if available
            if (event.request.destination === 'document') {
              return caches.match('/');
            }
            // Return a proper Response object for other failed requests
            return new Response('Offline', {
              status: 503,
              statusText: 'Service Unavailable'
            });
          });
      })
  );
});

// Handle push notifications (optional for future features)
self.addEventListener('push', (event) => {
  console.log('[ServiceWorker] Push Received.');
  
  const title = 'NYC Restaurant Week Update';
  const options = {
    body: event.data ? event.data.text() : 'New restaurants available!',
    icon: '/nyc.png',
    badge: '/nyc.png'
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  console.log('[ServiceWorker] Notification click received.');

  event.notification.close();

  event.waitUntil(
    clients.openWindow('/')
  );
});