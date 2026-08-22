/**
 * Service Worker
 *
 * 讓 App 離線可用：小朋友在車上、房間收訊差的時候一樣能打卡。
 * 打卡資料本來就存在 localStorage，跟這裡的快取無關。
 *
 * 改版時記得把 CACHE 的版號 +1，舊快取才會被清掉。
 */
var CACHE = 'oakley-routine-v18';

var PRECACHE = [
  './',
  'index.html',
  'manifest.json',
  'css/styles.css',
  'js/zhuyin.js',
  'js/store.js',
  'js/quiz.js',
  'js/app.js',
  'js/sync.js',
  'js/firebase-config.js',
  'assets/skye.png',
  'assets/skye-cheer.webp',
  'assets/skye-fly.webp',
  'icons/icon-192.png',
  'icons/icon-512.png'
];

self.addEventListener('install', function (e) {
  // 這裡故意不呼叫 skipWaiting()：裝好之後先在旁邊等，
  // 由頁面跳出「有新版本」讓使用者自己決定何時切換。
  // 小朋友正在打卡打到一半時被整個換掉並重新載入不是好體驗。
  e.waitUntil(
    caches.open(CACHE).then(function (cache) { return cache.addAll(PRECACHE); })
  );
});

self.addEventListener('message', function (e) {
  if (!e.data) return;

  // 頁面按下「更新」時才真的接手
  if (e.data.type === 'SKIP_WAITING') self.skipWaiting();

  // 讓畫面顯示「現在到底是哪一版在服務我」。
  // 回報的是這支 SW 自己的版號，所以看到什麼就真的是什麼。
  if (e.data.type === 'GET_VERSION' && e.ports && e.ports[0]) {
    e.ports[0].postMessage({ version: CACHE });
  }
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (k) {
          return k === CACHE ? null : caches.delete(k);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);

  // Firebase SDK 放在 gstatic，第一次載到之後就快取起來，
  // 否則離線開 App 會卡在載 SDK。
  if (url.hostname === 'www.gstatic.com' && url.pathname.indexOf('/firebasejs/') === 0) {
    e.respondWith(
      caches.match(req).then(function (cached) {
        return cached || fetch(req).then(function (res) {
          if (res && res.ok) {
            var copy = res.clone();
            caches.open(CACHE).then(function (c) { c.put(req, copy); });
          }
          return res;
        });
      })
    );
    return;
  }

  // 其餘只管自己的檔案；Google Fonts 之類的交給瀏覽器自己處理
  if (url.origin !== self.location.origin) return;

  // 先給快取讓畫面秒開，同時背景抓新版留給下次
  e.respondWith(
    caches.match(req).then(function (cached) {
      var network = fetch(req).then(function (res) {
        if (res && res.status === 200) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        return cached || caches.match('index.html');
      });

      return cached || network;
    })
  );
});
