// Service Worker：让页面可以“添加到主屏幕”。
// 一律优先走网络，保证看到的是最新的商品和订单；只有断网时才用缓存打开页面框架。
const CACHE = 'snack-shell-v1';
const SHELL = ['/', '/admin', '/css/app.css', '/css/customer.css', '/css/admin.css', '/js/lib.js', '/js/customer.js', '/js/admin.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // 接口数据永远直连服务器，不缓存
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok && SHELL.includes(url.pathname)) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match(url.pathname.startsWith('/admin') ? '/admin' : '/')))
  );
});
