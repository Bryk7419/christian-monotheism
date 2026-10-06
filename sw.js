// Работа сайта без интернета. Страницы берутся из сети, а если сети нет, из сохранённой копии.
// Записи статей (assets/audio/*.mp3) не сохраняются: они большие и идут напрямую из сети.
// Оформление и скрипты берутся из сети, а без сети из сохранённой копии; шрифты и картинки обновляются в фоне.
// При изменении этого файла увеличьте номер версии: старые копии будут удалены.
const VERSION = 'v3';
const PAGES = `pages-${VERSION}`;
const ASSETS = `assets-${VERSION}`;
const CORE = [
  './', 'index.html', 'articles/index.html', 'search/index.html', 'new/index.html',
  'assets/css/site.css', 'assets/js/site.js', 'assets/js/bible.js', 'assets/js/refscan.js',
  'assets/js/listen.js', 'assets/js/speech-text.js', 'assets/js/verses.js',
  'assets/js/catalog.js', 'assets/js/search-core.js', 'assets/js/stem-ru.js', 'assets/search-index.json',
  'assets/fonts/literata-cyrillic-400-normal.woff2', 'assets/fonts/literata-cyrillic-600-normal.woff2',
  'assets/fonts/literata-cyrillic-400-italic.woff2', 'assets/fonts/old-standard-tt-cyrillic-700-normal.woff2',
  'assets/img/logo-64.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(ASSETS).then((c) => c.addAll(CORE.map((p) => new Request(p, { cache: 'reload' })))).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => !k.endsWith(VERSION)).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function networkFirst(request) {
  const cache = await caches.open(PAGES);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch {
    return (await cache.match(request, { ignoreSearch: true })) || (await caches.match(request, { ignoreSearch: true }))
      || new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        + '<title>Нет связи</title><body style="font:18px/1.6 Georgia,serif;max-width:32rem;margin:15vh auto;padding:0 1rem">'
        + '<h1>Нет подключения к интернету</h1><p>Эта страница ещё не сохранена на устройстве. '
        + 'Страницы, которые вы уже открывали, доступны и без сети.</p><p><a href="./">На главную</a></p>',
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(ASSETS);
  const cached = await cache.match(request);
  const fresh = fetch(request).then((res) => { if (res.ok) cache.put(request, res.clone()); return res; }).catch(() => cached);
  return cached || fresh;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(new URL('./', self.location).pathname)) return;
  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(networkFirst(request));
  } else if (/\.(css|js|json)$/.test(url.pathname)) {
    // скрипты и данные: всегда свежие, если есть сеть, чтобы не разойтись с новой версией страниц
    event.respondWith(networkFirst(request));
  } else if (/\.(woff2|png|jpg|webp|svg)$/.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});
