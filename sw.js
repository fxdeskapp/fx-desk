/* Kodak Trade Community — Service Worker
   Amaç: "ana ekrana ekle" (PWA) + çevrimdışı kabuk + haber alarmı bildirimleri.
   Not: uygulama tek dosya (trade.html/index.html) + Supabase/canlı veri kullanır;
   bu yüzden veri istekleri DAİMA ağdan (network-first), yalnızca uygulama kabuğu cache'lenir. */
const CACHE = 'ktc-shell-v3';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Yalnızca kendi origin'imizdeki HTML/asset istekleri için cache dokunuşu.
  // Supabase, TradingView, ekonomik takvim, fontlar vb. hep ağdan geçsin.
  if (url.origin !== self.location.origin) return;

  // HTML gezinmeleri: ağ önce, offline'da cache'li kabuk
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).catch(() => caches.match('./index.html').then(r => r || caches.match('./')))
    );
    return;
  }
  // Statik asset: cache önce, yoksa ağ (ve cache'e ekle)
  e.respondWith(
    caches.match(req).then(cached => cached || fetch(req).then(res => {
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => cached))
  );
});

/* Haber alarmı bildirimleri — uygulama postMessage ile tetikler (sekme açıkken de,
   arka planda da OS bildirimi gösterir). */
self.addEventListener('message', e => {
  const d = e.data || {};
  if (d.type === 'notify' && self.registration.showNotification) {
    self.registration.showNotification(d.title || 'Kodak Trade', {
      body: d.body || '',
      icon: './icon-192.png',
      badge: './icon-192.png',
      tag: d.tag || 'ktc-news',
      renotify: true,
      vibrate: [120, 60, 120]
    });
  }
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) { if ('focus' in c) return c.focus(); }
      if (self.clients.openWindow) return self.clients.openWindow('./');
    })
  );
});
