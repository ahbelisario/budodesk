/* BudoDesk · service worker: recibe las notificaciones push y abre la pantalla correcta al tocarlas.
   No guarda nada en caché: la app siempre se carga del servidor. */
const ICON = '/icons/icon-192.png';
const BADGE = '/icons/badge-96.png';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { body: event.data ? event.data.text() : '' }; }
  const title = data.title || 'BudoDesk';
  // Safari exige mostrar algo siempre que llega un push
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    icon: ICON,
    badge: BADGE,
    tag: data.tag || undefined,
    data: { url: data.url || '/notifications' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Si la app ya está abierta, se usa esa ventana
    for (const c of all) {
      if (new URL(c.url).origin === self.location.origin) {
        await c.focus();
        if ('navigate' in c) { try { await c.navigate(url); } catch (e) { /* algunas no lo permiten */ } }
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
