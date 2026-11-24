// Service worker: offline app shell, background push reminders, notification buttons.
const CACHE = "daybook-v2";
const SHELL = [
  "./", "./index.html", "./styles.css", "./app.js", "./recurrence.js", "./firebase-config.js",
  "./native.js", "./vendor/capacitor-core.js", "./vendor/firebase.js", "./manifest.json", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/badge-96.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network first (so updates show up), fall back to cache when offline.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match("./index.html")))
  );
});

// Push from the Cloud Function (reminder while the app is closed / phone locked).
self.addEventListener("push", (e) => {
  let payload = {};
  try { payload = e.data ? e.data.json() : {}; } catch {}
  const d = payload.data || payload;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const visible = wins.find((w) => w.visibilityState === "visible");
    if (visible) {
      // App is on screen → let it ring the in-app alarm + popup instead.
      visible.postMessage({ type: "REMOTE_ALARM", taskId: d.taskId });
      return;
    }
    await self.registration.showNotification(d.title || "⏰ Reminder", {
      body: d.body || "",
      tag: d.taskId || "reminder",
      renotify: true,
      requireInteraction: true,
      silent: d.sound === "0" && d.vibrate === "0", // "silent" would also block vibration
      vibrate: d.vibrate === "1" ? [500, 200, 500, 200, 1000] : undefined,
      icon: "./icons/icon-192.png",
      badge: "./icons/badge-96.png",
      data: { taskId: d.taskId },
      actions: [{ action: "done", title: "✓ Done" }, { action: "snooze", title: "Snooze 10 min" }],
    });
  })());
});

// Tapping the notification or its buttons.
self.addEventListener("notificationclick", (e) => {
  const taskId = e.notification.data?.taskId;
  const action = e.action || "open";
  e.notification.close();
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (wins.length) {
      const w = wins[0];
      try { await w.focus(); } catch {}
      w.postMessage({ type: "NOTIF_ACTION", action, taskId });
      return;
    }
    const url = new URL("./", self.registration.scope);
    if (taskId) { url.searchParams.set("task", taskId); url.searchParams.set("action", action); }
    await self.clients.openWindow(url.href);
  })());
});
