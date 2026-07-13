// Minimal service worker — its only real job is to make the listener page
// installable as a PWA. It does NOT cache or intercept the WebSocket
// signaling or WebRTC media traffic, only the static app shell, so the
// page always tries the network first for everything that matters.

const CACHE = "mic-stream-shell-v2";
const SHELL_FILES = [
  "app.html",
  "manifest.json",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  // Network-first for the shell files, falling back to cache if offline.
  // Never intervene on non-GET requests or cross-origin (e.g. websocket).
  if (event.request.method !== "GET") return;

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});

// Handles taps on the persistent "Mic Stream" status notification, including
// its "Stop" action button. Focuses an existing window if one is open,
// otherwise opens a new one, and tells the page what happened.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const isStop = event.action === "stop";

  event.waitUntil(
    (async () => {
      const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });

      if (isStop) {
        for (const client of clientsList) {
          client.postMessage({ type: "notification-stop" });
        }
        return;
      }

      if (clientsList.length > 0) {
        await clientsList[0].focus();
      } else {
        await self.clients.openWindow("listener.html");
      }
    })()
  );
});
