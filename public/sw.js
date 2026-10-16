self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "iPhone Duo", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "iPhone Duo disponible !", {
      body: data.body || "",
      icon: "/logo.svg",
      badge: "/logo.svg",
      tag: data.tag,
      renotify: Boolean(data.tag),
      requireInteraction: true,
      data: { url: data.url || "/stock-iphone" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/stock-iphone", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const existing = windows.find((w) => w.url === url);
      return existing ? existing.focus() : self.clients.openWindow(url);
    }),
  );
});
