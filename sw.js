/* Disposable test service worker: cache app shell, handle push, record verifiable delivery events. */
const CACHE = 'pwa-test-v2';
const SHELL = ['./','./index.html','./app.js','./config.js','./share.html','./share.js','./manifest.webmanifest',
               './icons/icon-192.png','./icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request, {ignoreSearch:true}).then(hit => hit || fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy)).catch(()=>{});
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});

function recordEvent(type, payload) {
  return new Promise(res => {
    const r = indexedDB.open('pwa-test', 1);
    r.onupgradeneeded = () => { const d=r.result;
      if(!d.objectStoreNames.contains('items')) d.createObjectStore('items',{keyPath:'id'});
      if(!d.objectStoreNames.contains('events')) d.createObjectStore('events',{keyPath:'id'}); };
    r.onsuccess = () => { const d=r.result;
      const t=d.transaction('events','readwrite');
      t.objectStore('events').put({id:type+'-'+Date.now(), type, at:new Date().toISOString(), payload});
      t.oncomplete=()=>res(true); t.onerror=()=>res(false); };
    r.onerror = () => res(false);
  });
}
self.addEventListener('push', e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch(_) { data = {text: e.data ? e.data.text() : ''}; }
  e.waitUntil((async () => {
    // VERIFIABLE event: the service worker on the device actually received the push
    await recordEvent('push-received', data);
    await self.registration.showNotification(data.title || 'PWA test reminder', {
      body: data.body || 'Synthetic test notification',
      data, tag: data.tag || 'pwa-test', renotify: false
    });
  })());
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil((async () => {
    await recordEvent('notification-clicked', e.notification.data || {});
    const list = await self.clients.matchAll({type:'window'});
    if (list.length) return list[0].focus();
    return self.clients.openWindow('./index.html');
  })());
});
