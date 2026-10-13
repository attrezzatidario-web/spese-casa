/* Spese Casa — service worker: app utilizzabile anche offline */
const CACHE = 'spese-casa-27';
const SHELL = ['./', 'index.html', 'manifest.json', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'logo.svg', 'lib-supabase.js', 'ai.js', 'i18n.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => (k.startsWith('spese-casa-') && k !== CACHE)).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return; // i dati Google passano diretti
  // rete prima (aggiornamenti immediati), cache se offline
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' }).then(r => {
      const copy = r.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return r;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('index.html')))
  );
});

// notifiche dal server (promemoria)
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (er) { d = { title: 'Spese Casa', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Spese Casa', {
    body: d.body || '', icon: d.icon || 'icon-192.png', badge: d.badge || 'icon-192.png', tag: d.tag || 'spese-casa', renotify: true,
    data: { url: d.url || './' }
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    // prima una finestra già aperta sulla stessa pagina (app o pannello), poi una qualsiasi dell'app
    const pag = u => new URL(u).pathname.replace(/\/$/, '/index.html');
    const stessa = list.find(c => pag(c.url) === pag(url));
    if (stessa) { stessa.focus(); return stessa.navigate ? stessa.navigate(url) : null; }
    const pannello = /pannello\.html$/.test(pag(url));
    if (!pannello) for (const c of list) if (c.url.startsWith(self.registration.scope) && !/pannello\.html/.test(c.url)) { c.focus(); return c.navigate ? c.navigate(url) : null; }
    return clients.openWindow(url);
  }));
});
