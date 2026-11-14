/* Offline-first Service Worker for Training Aid static PWA */
"use strict";

{
  const CACHE_PREFIX = "training-aid-pwa-";
  const CACHE_VERSION = "v1";
  const CACHE_NAME = CACHE_PREFIX + CACHE_VERSION;
  const REVISIONS_KEY = "./__sw_revisions__";
  const APP_SHELL_ASSETS = ["./", "./index.html"];
  const APP_SHELL_REVISIONS = {};

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

  function buildReloadRequest(assetUrl, revToken) {
    const resolved = new URL(assetUrl, self.location.href);
    if (revToken) resolved.searchParams.set("v", revToken);
    const url = resolved.toString();
    return new Request(url, { cache: "reload" });
  }

  function buildRevalidateRequest(targetUrl, revToken) {
    const resolved = new URL(targetUrl, self.location.href);
    if (revToken) resolved.searchParams.set("v", revToken);
    return new Request(resolved.toString(), { cache: "no-cache" });
  }

  async function findPriorShellCache() {
    const keys = await caches.keys();
    for (let i = keys.length - 1; i >= 0; i -= 1) {
      const key = keys[i];
      if (key !== CACHE_NAME && key.startsWith(CACHE_PREFIX)) {
        const priorCache = await caches.open(key);
        const revResp = await priorCache.match(REVISIONS_KEY);
        if (revResp) {
          try {
            const priorRevs = await revResp.json();
            if (priorRevs && typeof priorRevs === "object") {
              return { priorCache, priorRevs };
            }
          } catch {
            // Fall through to network fetch if revision metadata is unreadable.
          }
        }
      }
    }
    return { priorCache: null, priorRevs: {} };
  }

  async function precacheAppShell() {
    const [targetCache, { priorCache, priorRevs }] = await Promise.all([
      caches.open(CACHE_NAME),
      findPriorShellCache(),
    ]);

    await Promise.all(
      APP_SHELL_ASSETS.map(async (assetUrl) => {
        const expectedRev = APP_SHELL_REVISIONS[assetUrl] || "";
        if (priorCache && expectedRev && priorRevs[assetUrl] === expectedRev) {
          const reused = await priorCache.match(assetUrl);
          if (reused) {
            await targetCache.put(assetUrl, reused.clone());
            return;
          }
        }
        const freshResp = await fetch(
          buildReloadRequest(assetUrl, expectedRev || CACHE_VERSION)
        );
        if (!freshResp || !freshResp.ok) {
          throw new Error(
            `Failed to precache ${assetUrl} (${freshResp ? freshResp.status : "network"})`
          );
        }
        await targetCache.put(assetUrl, freshResp);
      })
    );

    await targetCache.put(
      REVISIONS_KEY,
      new Response(JSON.stringify(APP_SHELL_REVISIONS), {
        headers: { "content-type": "application/json" },
      })
    );

    if (!(self.registration && self.registration.active)) {
      await self.skipWaiting();
    }
  }

  self.addEventListener("install", (event) => {
    event.waitUntil(precacheAppShell());
  });

  self.addEventListener("message", (event) => {
    if (event && event.data && event.data.type === "SKIP_WAITING") {
      self.skipWaiting();
    }
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
    if (url.pathname.endsWith("/__sw_revisions__")) return;

    if (request.mode === "navigate") {
      event.respondWith(
        caches
          .match("./index.html", { ignoreSearch: true })
          .then((cachedShell) => cachedShell || caches.match("./", { ignoreSearch: true }))
          .then((cached) => {
            if (cached) return cached;
            const rev = APP_SHELL_REVISIONS["./index.html"] || CACHE_VERSION;
            return fetch(buildRevalidateRequest("./index.html", rev)).then((networkResp) => {
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
          const cacheable = isRuntimeCacheable(url.pathname);
          const upstreamReq = cacheable
            ? buildRevalidateRequest(url.origin + url.pathname, CACHE_VERSION)
            : new Request(request, { cache: "no-cache" });
          return fetch(upstreamReq).then((networkResp) => {
            if (networkResp && networkResp.status === 200 && cacheable) {
              const responseClone = networkResp.clone();
              caches
                .open(CACHE_NAME)
                .then((cache) => cache.put(url.origin + url.pathname, responseClone));
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
