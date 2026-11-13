/* Offline-first Service Worker for Training Aid static PWA */
(function () {
  "use strict";

  var CACHE_PREFIX = "training-aid-pwa-";
  var CACHE_VERSION = "v1";
  var CACHE_NAME = CACHE_PREFIX + CACHE_VERSION;

  var APP_SHELL_ASSETS = [
    "./",
    "./index.html",
    "./manifest.webmanifest",
    "./icon.svg",
    "./static/style.css",
    "./static/motion.js",
    "./static/sound-presets.js",
    "./static/sound-pattern.js",
    "./static/sound-synth.js",
    "./static/sound.js",
    "./domain.js",
    "./recommender.js",
    "./codec.js",
    "./store.js",
    "./qr.js",
    "./dom.js",
    "./views/setup.js",
    "./views/plan.js",
    "./views/quick.js",
    "./views/edit.js",
    "./views/workout.js",
    "./views/progress.js",
    "./app.js",
    "./data/catalog.json",
  ];

  self.addEventListener("install", function (event) {
    event.waitUntil(
      caches
        .open(CACHE_NAME)
        .then(function (cache) {
          return cache.addAll(APP_SHELL_ASSETS);
        })
        .then(function () {
          return self.skipWaiting();
        })
    );
  });

  self.addEventListener("activate", function (event) {
    event.waitUntil(
      caches
        .keys()
        .then(function (keys) {
          return Promise.all(
            keys.map(function (key) {
              if (key !== CACHE_NAME && key.indexOf(CACHE_PREFIX) === 0) {
                return caches.delete(key);
              }
              return Promise.resolve(false);
            })
          );
        })
        .then(function () {
          return self.clients.claim();
        })
    );
  });

  function isRuntimeCacheable(pathname) {
    return (
      pathname.indexOf("/svgs/thumbs/") !== -1 ||
      pathname.endsWith(".svg") ||
      pathname.endsWith(".css") ||
      pathname.endsWith(".js") ||
      pathname.endsWith(".json") ||
      pathname.endsWith(".webmanifest")
    );
  }

  self.addEventListener("fetch", function (event) {
    var request = event.request;
    if (!request || request.method !== "GET") {
      return;
    }

    var url;
    try {
      url = new URL(request.url);
    } catch (e) {
      return;
    }

    if (url.origin !== self.location.origin) {
      return;
    }

    if (request.mode === "navigate") {
      event.respondWith(
        caches
          .match("./index.html", { ignoreSearch: true })
          .then(function (cachedShell) {
            if (cachedShell) {
              return cachedShell;
            }
            return caches.match("./", { ignoreSearch: true });
          })
          .then(function (cached) {
            if (cached) {
              return cached;
            }
            return fetch(request).then(function (networkResp) {
              if (networkResp && networkResp.status === 200) {
                var clone = networkResp.clone();
                caches.open(CACHE_NAME).then(function (cache) {
                  cache.put("./index.html", clone);
                });
              }
              return networkResp;
            });
          })
      );
      return;
    }

    event.respondWith(
      caches
        .match(request, { ignoreSearch: true })
        .then(function (cachedResp) {
          if (cachedResp) {
            return cachedResp;
          }
          return fetch(request).then(function (networkResp) {
            if (
              networkResp &&
              networkResp.status === 200 &&
              isRuntimeCacheable(url.pathname)
            ) {
              var responseClone = networkResp.clone();
              caches.open(CACHE_NAME).then(function (cache) {
                cache.put(request, responseClone);
              });
            }
            return networkResp;
          });
        })
        .catch(function () {
          if (url.pathname.endsWith(".svg")) {
            return caches.match("./icon.svg");
          }
          return Response.error();
        })
    );
  });
})();
