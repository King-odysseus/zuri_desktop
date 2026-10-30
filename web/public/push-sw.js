self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data?.json() ?? {};
  } catch {
    payload = { body: event.data?.text() ?? '' };
  }
  const title = typeof payload.title === 'string' && payload.title !== '' ? payload.title : 'Zuri notification';
  const body = typeof payload.body === 'string' ? payload.body : '';
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: '/zuri-logo.png',
    badge: '/zuri-logo.png',
    data: { kind: payload.kind ?? 'info' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    const existing = clients.find((client) => 'focus' in client);
    return existing ? existing.focus() : self.clients.openWindow('/');
  }));
});
