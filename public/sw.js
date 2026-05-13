/* ArchiveDistrict Service Worker — Push Notifications */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

/* ── Push received ── */
self.addEventListener("push", event => {
  if (!event.data) return;
  let payload;
  try { payload = event.data.json(); }
  catch { payload = { title: "ArchiveDistrict", body: event.data.text() }; }

  const { title, body, tag, url } = payload;

  event.waitUntil(
    self.registration.showNotification(title || "ArchiveDistrict", {
      body: body || "",
      tag: tag || "ad-notification",
      icon: "/icon.png",
      badge: "/icon.png",
      data: { url: url || "/" },
      requireInteraction: false,
      vibrate: [200, 100, 200],
    })
  );
});

/* ── Notification click — open app ── */
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then(clients => {
      const existing = clients.find(c => c.url.includes("archive-district") && "focus" in c);
      if (existing) return existing.focus();
      return self.clients.openWindow(url);
    })
  );
});

/* ── Sunday 6pm backup reminder ── */
self.addEventListener("periodicsync", event => {
  if (event.tag === "sunday-backup") {
    event.waitUntil(
      self.registration.showNotification("ArchiveDistrict", {
        body: "🔔 Weekly backup reminder — export your data",
        tag: "sunday-backup",
        icon: "/icon.png",
      })
    );
  }
});
