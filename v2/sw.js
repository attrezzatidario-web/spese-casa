/* Spese Casa si è spostata all'indirizzo principale: questo service worker si spegne da solo */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  try { const s = await self.registration.pushManager.getSubscription(); if (s) await s.unsubscribe(); } catch (er) {}
  await self.registration.unregister();
  const dest = new URL('../', self.registration.scope).href;
  (await clients.matchAll({ type: 'window' })).forEach(c => { try { c.navigate(dest); } catch (er) {} });
})()));
self.addEventListener('fetch', () => {});
