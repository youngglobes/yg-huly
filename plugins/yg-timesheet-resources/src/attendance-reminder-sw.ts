//
// YoungGlobes: punch-reminder service worker. The page (AttendanceReminder.svelte) shows the
// notification via registration.showNotification with action buttons; this worker handles the click:
// focus/open the portal and relay the chosen action to the page, which performs the punch/snooze.
// No push, no DOM, no app imports - worker context only.
//
// Types are declared locally rather than pulling in the WebWorker lib: this package is type-checked
// with the shared UI/DOM tsconfig, and the DOM + WebWorker libs conflict. For the same reason the
// worker global is reached through `globalThis` instead of `declare const self` - the DOM lib
// already declares `self` as a Window, so redeclaring it is an error here (unlike
// plugins/notification/src/serviceWorker.ts, which is built with the non-DOM tsconfig profile).
//
const worker = globalThis as any

interface WindowClientLike {
  url: string
  focus: () => Promise<unknown>
  postMessage: (message: unknown) => void
}

interface ExtendableEventLike extends Event {
  waitUntil: (promise: Promise<unknown>) => void
}

interface NotificationClickEvent extends ExtendableEventLike {
  action: string
  notification: { close: () => void }
}

worker.addEventListener('install', () => {
  void worker.skipWaiting()
})
worker.addEventListener('activate', (event: ExtendableEventLike) => {
  event.waitUntil(worker.clients.claim())
})

worker.addEventListener('notificationclick', (event: NotificationClickEvent) => {
  event.notification.close()
  // 'punch' when a button is clicked; '' (body click) is treated as focus + punch too. 'snooze' snoozes.
  const action = event.action === 'snooze' ? 'snooze' : 'punch'
  event.waitUntil(
    (async () => {
      const all: WindowClientLike[] = await worker.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const client = all.find((c) => c.url.includes('/workbench/')) ?? all[0]
      if (client !== undefined) {
        await client.focus()
        client.postMessage({ type: 'yg-punch-reminder-action', action })
      } else if (worker.clients.openWindow !== undefined) {
        await worker.clients.openWindow('/')
      }
    })()
  )
})
