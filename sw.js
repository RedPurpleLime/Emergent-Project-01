const CACHE_NAME = 'content-autopilot-v1.0.0';
const STATIC_CACHE = 'static-v1.0.0';
const DYNAMIC_CACHE = 'dynamic-v1.0.0';

// Files to cache immediately
const STATIC_FILES = [
    '/',
    '/index.html',
    '/manifest.json',
    '/css/styles.css',
    '/js/app.js',
    '/js/db-manager.js',
    '/js/api-manager.js',
    '/js/content-generator.js',
    '/js/wp-connector.js',
    '/js/scheduler.js',
    '/assets/icons/icon-192.png',
    '/assets/icons/icon-512.png'
];

// API endpoints to cache dynamically
const API_CACHE_PATTERNS = [
    /\/api\//,
    /api\.search\.brave\.com/,
    /api-inference\.huggingface\.co/
];

// Install event - cache static files
self.addEventListener('install', event => {
    console.log('Service Worker: Installing...');
    
    event.waitUntil(
        caches.open(STATIC_CACHE)
            .then(cache => {
                console.log('Service Worker: Caching static files');
                return cache.addAll(STATIC_FILES);
            })
            .then(() => {
                console.log('Service Worker: Installed');
                return self.skipWaiting();
            })
            .catch(error => {
                console.error('Service Worker: Installation failed', error);
            })
    );
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
    console.log('Service Worker: Activating...');
    
    event.waitUntil(
        caches.keys()
            .then(cacheNames => {
                return Promise.all(
                    cacheNames.map(cacheName => {
                        if (cacheName !== STATIC_CACHE && cacheName !== DYNAMIC_CACHE) {
                            console.log('Service Worker: Deleting old cache:', cacheName);
                            return caches.delete(cacheName);
                        }
                    })
                );
            })
            .then(() => {
                console.log('Service Worker: Activated');
                return self.clients.claim();
            })
    );
});

// Fetch event - serve from cache or network
self.addEventListener('fetch', event => {
    const { request } = event;
    const url = new URL(request.url);

    // Skip non-GET requests
    if (request.method !== 'GET') {
        return;
    }

    // Handle different types of requests
    if (isStaticFile(request.url)) {
        // Static files - cache first
        event.respondWith(cacheFirst(request, STATIC_CACHE));
    } else if (isAPIRequest(request.url)) {
        // API requests - network first with cache fallback
        event.respondWith(networkFirstWithCache(request, DYNAMIC_CACHE));
    } else {
        // Other requests - network first
        event.respondWith(networkFirst(request));
    }
});

// Background sync for offline actions
self.addEventListener('sync', event => {
    console.log('Service Worker: Background sync triggered:', event.tag);
    
    if (event.tag === 'background-publish') {
        event.waitUntil(handleBackgroundPublish());
    } else if (event.tag === 'background-generate') {
        event.waitUntil(handleBackgroundGenerate());
    }
});

// Push notifications for scheduled tasks
self.addEventListener('push', event => {
    console.log('Service Worker: Push received');
    
    const options = {
        body: event.data ? event.data.text() : 'Contenuto pronto per la pubblicazione',
        icon: '/assets/icons/icon-192.png',
        badge: '/assets/icons/icon-96.png',
        tag: 'content-autopilot',
        renotify: true,
        requireInteraction: true,
        actions: [
            {
                action: 'view',
                title: 'Visualizza',
                icon: '/assets/icons/icon-72.png'
            },
            {
                action: 'dismiss',
                title: 'Ignora'
            }
        ]
    };

    event.waitUntil(
        self.registration.showNotification('Content Autopilot', options)
    );
});

// Notification click handler
self.addEventListener('notificationclick', event => {
    console.log('Service Worker: Notification clicked:', event.action);
    
    event.notification.close();

    if (event.action === 'view') {
        event.waitUntil(
            clients.openWindow('/')
        );
    }
});

// Utility functions
function isStaticFile(url) {
    return STATIC_FILES.some(file => url.endsWith(file)) || 
           url.includes('/css/') || 
           url.includes('/js/') || 
           url.includes('/assets/');
}

function isAPIRequest(url) {
    return API_CACHE_PATTERNS.some(pattern => pattern.test(url));
}

// Cache strategies
async function cacheFirst(request, cacheName) {
    try {
        const cache = await caches.open(cacheName);
        const cachedResponse = await cache.match(request);
        
        if (cachedResponse) {
            console.log('Service Worker: Serving from cache:', request.url);
            return cachedResponse;
        }

        console.log('Service Worker: Fetching from network:', request.url);
        const networkResponse = await fetch(request);
        
        if (networkResponse.ok) {
            cache.put(request, networkResponse.clone());
        }
        
        return networkResponse;
    } catch (error) {
        console.error('Service Worker: Cache first failed:', error);
        return new Response('Offline', { status: 503 });
    }
}

async function networkFirstWithCache(request, cacheName) {
    try {
        console.log('Service Worker: Attempting network request:', request.url);
        const networkResponse = await fetch(request);
        
        if (networkResponse.ok) {
            const cache = await caches.open(cacheName);
            cache.put(request, networkResponse.clone());
            console.log('Service Worker: Cached API response:', request.url);
        }
        
        return networkResponse;
    } catch (error) {
        console.log('Service Worker: Network failed, trying cache:', request.url);
        const cache = await caches.open(cacheName);
        const cachedResponse = await cache.match(request);
        
        if (cachedResponse) {
            console.log('Service Worker: Serving API from cache:', request.url);
            return cachedResponse;
        }
        
        console.error('Service Worker: Network and cache failed:', error);
        return new Response(JSON.stringify({ 
            error: 'Offline', 
            message: 'Richiesta non disponibile offline' 
        }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

async function networkFirst(request) {
    try {
        return await fetch(request);
    } catch (error) {
        console.error('Service Worker: Network request failed:', error);
        return new Response('Offline', { status: 503 });
    }
}

// Background sync handlers
async function handleBackgroundPublish() {
    try {
        console.log('Service Worker: Handling background publish');
        
        // Get pending publications from IndexedDB
        const db = await openDB();
        const pendingPubs = await getAllFromStore(db, 'pendingPublications');
        
        for (const pub of pendingPubs) {
            try {
                await publishToWordPress(pub);
                await removeFromStore(db, 'pendingPublications', pub.id);
                console.log('Service Worker: Published:', pub.title);
            } catch (error) {
                console.error('Service Worker: Publish failed:', pub.title, error);
            }
        }
    } catch (error) {
        console.error('Service Worker: Background publish failed:', error);
    }
}

async function handleBackgroundGenerate() {
    try {
        console.log('Service Worker: Handling background generate');
        
        // Get pending generations from IndexedDB
        const db = await openDB();
        const pendingGens = await getAllFromStore(db, 'pendingGenerations');
        
        for (const gen of pendingGens) {
            try {
                await generateContent(gen);
                await removeFromStore(db, 'pendingGenerations', gen.id);
                console.log('Service Worker: Generated:', gen.topic);
            } catch (error) {
                console.error('Service Worker: Generation failed:', gen.topic, error);
            }
        }
    } catch (error) {
        console.error('Service Worker: Background generation failed:', error);
    }
}

// IndexedDB helpers for service worker
function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('ContentAutopilotDB', 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
    });
}

function getAllFromStore(db, storeName) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([storeName], 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.getAll();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
    });
}

function removeFromStore(db, storeName, id) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.delete(id);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
    });
}

// Placeholder functions for actual implementations
async function publishToWordPress(publication) {
    // Implementation will be in wp-connector.js
    console.log('Service Worker: Publishing to WordPress:', publication.title);
}

async function generateContent(generation) {
    // Implementation will be in content-generator.js
    console.log('Service Worker: Generating content for:', generation.topic);
}