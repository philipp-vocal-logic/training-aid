/* Offline-first Service Worker for Training Aid static PWA */
"use strict";

{
  const CACHE_PREFIX = "training-aid-pwa-";
  const CACHE_VERSION = "v1";
  const CACHE_NAME = CACHE_PREFIX + CACHE_VERSION;
  const APP_SHELL_ASSETS = ["./", "./index.html"];

  function isRuntimeCacheable(pathname) {
    return (
      pathname.includes("/svgs/thumbs/") ||
      pathname.endsWith(".svg") ||
      pathname.endsWith(".png") ||
      pathname.endsWith(".css") ||
      pathname.endsWith(".js") ||
      pathname.endsWith(".json") ||
      pathname.endsWith(".webmanifest")
    );
  }

  self.addEventListener("install", (event) => {
    event.waitUntil(
      caches
        .open(CACHE_NAME)
        .then((cache) =>
          cache.addAll(
            APP_SHELL_ASSETS.map((url) => new Request(url, { cache: "reload" }))
          )
        )
        .then(() => self.skipWaiting())
    );
  });

  self.addEventListener("activate", (event) => {
    event.waitUntil(
      caches
        .keys()
        .then((keys) =>
          Promise.all(
            keys.map((key) =>
              key !== CACHE_NAME && key.startsWith(CACHE_PREFIX)
                ? caches.delete(key)
                : Promise.resolve(false)
            )
          )
        )
        .then(() => self.clients.claim())
    );
  });

  self.addEventListener("fetch", (event) => {
    const request = event.request;
    if (!request || request.method !== "GET") return;

    let url;
    try {
      url = new URL(request.url);
    } catch {
      return;
    }

    if (url.origin !== self.location.origin) return;

    if (request.mode === "navigate") {
      event.respondWith(
        caches
          .match("./index.html", { ignoreSearch: true })
          .then((cachedShell) => cachedShell || caches.match("./", { ignoreSearch: true }))
          .then((cached) => {
            if (cached) return cached;
            return fetch(request).then((networkResp) => {
              if (networkResp && networkResp.status === 200) {
                const clone = networkResp.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put("./index.html", clone));
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
        .then((cachedResp) => {
          if (cachedResp) return cachedResp;
          return fetch(request).then((networkResp) => {
            if (networkResp && networkResp.status === 200 && isRuntimeCacheable(url.pathname)) {
              const responseClone = networkResp.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
            }
            return networkResp;
          });
        })
        .catch(() => {
          if (url.pathname.endsWith(".svg")) return caches.match("./icon.svg");
          return Response.error();
        })
    );
  });
}
