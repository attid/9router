function scopedPath(path) {
  const scopePath = new URL(self.registration.scope).pathname.replace(/\/$/, '')
  return `${scopePath}${path}`
}

self.addEventListener('push', function (event) {
  if (event.data) {
    const data = event.data.json()
    const options = {
      body: data.body,
      icon: data.icon || scopedPath('/icons/icon-192.svg'),
      badge: scopedPath('/icons/icon-192.svg'),
      vibrate: [100, 50, 100],
      data: {
        dateOfArrival: Date.now(),
        primaryKey: '2',
      },
    }
    event.waitUntil(self.registration.showNotification(data.title, options))
  }
})

self.addEventListener('notificationclick', function (event) {
  console.log('Notification click received.')
  event.notification.close()
  event.waitUntil(clients.openWindow(scopedPath('/')))
})
