// Shows push notifications. No caching and no fetch handler on purpose: pages and data are never touched by this worker.

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {}
  const text = (value, fallback) => (typeof value === "string" && value ? value : fallback);

  // iOS drops the subscription if a push shows nothing, so something is always shown, even for a bad payload.
  event.waitUntil(
    self.registration.showNotification(text(data.title, "TFF"), {
      body: text(data.body, "Open TFF to see what needs a look."),
      tag: "till-reminders",
      renotify: true,
      icon: "/icon/192",
      data: { url: text(data.url, "/") },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  // Same-origin paths only: anything that resolves to another address becomes "/".
  let target = "/";
  try {
    const raw = event.notification.data && event.notification.data.url;
    const url = new URL(typeof raw === "string" ? raw : "/", self.location.origin);
    if (url.origin === self.location.origin) target = url.pathname + url.search;
  } catch {}

  event.waitUntil(
    (async () => {
      const windows = await clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (open) await open.focus();
      else await clients.openWindow(target);
    })(),
  );
});
