// Service Worker for マイドキュメント保管庫 (v3.0)
// 最小限のPWA対応：起動高速化のみ、オフライン機能は入れない
// （常にネットワーク優先で最新版を取得）

const CACHE_NAME = 'my-document-vault-v3';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      );
    }).then(() => self.clients.claim())
  );
});

// ネットワーク優先。エラーだった場合のみキャッシュから返す（最小フォールバック）
self.addEventListener('fetch', (event) => {
  // API/認証系はキャッシュしない
  const url = event.request.url;
  if (url.includes('googleapis.com') || 
      url.includes('firebaseio.com') || 
      url.includes('firestore.googleapis.com') ||
      url.includes('accounts.google.com') ||
      url.includes('firebase') ||
      url.includes('gstatic.com')) {
    return;
  }
  
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // 成功したらキャッシュに保存
        if (response && response.status === 200 && event.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
