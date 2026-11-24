// The installed app's service worker. The studio runs on this machine, so the network comes
// first and is always right; the cache only keeps the shell, so a window opened while the
// studio is not running still shows the app and says how to start it, instead of an error page.
const CACHE = 'keyframe-shell-v13';
const SHELL = ['/', '/web/boot.js', '/web/app.js', '/web/store.js', '/web/ui.js', '/web/i18n.js', '/web/theme.js', '/web/chat.js', '/web/stage.js', '/web/reference.js',
  '/web/delivery.js', '/web/sync.js', '/web/views.js', '/web/projects.js', '/web/panels.js', '/web/lanes.js', '/web/timeline.js', '/web/link-text.js', '/web/stage-pick.js', '/web/chat-rules.js', '/web/chat-view.js', '/web/agent-rules.js', '/web/agent-slots.js', '/web/keyframe-player.js', '/web/draw.js', '/web/draw-model.js', '/web/draw-live.js', '/web/draw-conflict.js', '/web/draw-edit.js', '/web/draw-live-model.js', '/web/update.js', '/web/tokens.css', '/web/components.css', '/web/app.css', '/web/views.css',
  '/web/fonts/BricolageGrotesque-latin.woff2', '/web/fonts/BricolageGrotesque-latin-ext.woff2', '/web/fonts/InstrumentSans-latin.woff2',
  '/web/fonts/InstrumentSans-latin-ext.woff2', '/web/fonts/JetBrainsMono-latin.woff2', '/web/fonts/JetBrainsMono-latin-ext.woff2', '/web/manifest.webmanifest', '/web/icons/icon-192.png', '/web/icons/favicon.svg',
  '/src/engine/index.js', '/src/engine/model.js', '/src/engine/pose.js', '/src/engine/curve.js', '/src/engine/constraints.js',
  '/src/engine/draws.js', '/src/engine/atlas.js', '/src/engine/canvas.js', '/src/engine/keyframe-format.js', '/src/shared/errors.js',
  '/src/spine/curves/presets.js',
  '/locale/tr.json', '/locale/en.json', '/opening/mark_v2.json', '/opening/mark_v2.atlas', '/opening/mark.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin) return;
  // Live data is never served from the cache: a stale project state would be a lie.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/files/')) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok && SHELL.includes(url.pathname)) { const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(event.request, copy)); }
    return response;
  }).catch(() => caches.match(event.request).then(hit => hit || caches.match('/'))));
});
