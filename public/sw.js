const CACHE = 'pinease-complete-v2'
const ROOT = new URL('./', self.location).href
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll([ROOT, new URL('icon.svg', ROOT).href, new URL('manifest.webmanifest', ROOT).href])))
  self.skipWaiting()
})
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('pinease-complete-') && key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()))
})
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).then((response) => {
      if (response.ok) { const copy = response.clone(); void caches.open(CACHE).then((cache) => cache.put(ROOT, copy)) }
      return response
    }).catch(() => caches.match(ROOT)))
    return
  }
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
    if (response.ok && ['script', 'style', 'font', 'image', ''].includes(event.request.destination)) {
      const copy = response.clone()
      void caches.open(CACHE).then((cache) => cache.put(event.request, copy))
    }
    return response
  })))
})

