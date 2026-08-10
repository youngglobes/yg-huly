//
// YoungGlobes: punch-reminder service worker. The page (AttendanceReminder.svelte) shows the
// notification via registration.showNotification with action buttons; this worker handles the click:
// focus/open the portal and relay the chosen action to the page, which performs the punch/snooze.
// No DOM, no app imports - worker context only.
//
// It ALSO owns web push. This worker registers at scope '/' and calls clients.claim(), so it becomes
// the controlling worker for the whole portal - which means Huly's push code (subscribePush in
// notification-resources) finds THIS registration via getRegistration() and binds the push
// subscription to it. Huly's own serviceWorker.js therefore never controls the page, so if this
// worker had no 'push' handler every delivered push was silently dropped (the exact "inbox works,
// no OS push" bug). The 'push' handler below mirrors plugins/notification/src/serviceWorker.ts, and
// notificationclick routes push notifications (which carry data.url) to Huly's navigate-to-message
// behaviour while keeping the punch/snooze behaviour for reminder notifications.
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

interface PushNotificationData {
  domain?: string
  url?: string
  notificationId?: string
}

interface NotificationClickEvent extends ExtendableEventLike {
  action: string
  notification: { close: () => void, data?: PushNotificationData }
}

interface PushEventLike extends ExtendableEventLike {
  data: { json: () => any } | null
}

worker.addEventListener('install', () => {
  void worker.skipWaiting()
})
worker.addEventListener('activate', (event: ExtendableEventLike) => {
  event.waitUntil(worker.clients.claim())
})

// Web push (mirrors plugins/notification/src/serviceWorker.ts). The payload is Huly's PushData;
// data.url/domain/notificationId are stashed on the notification so notificationclick can navigate.
worker.addEventListener('push', (event: PushEventLike) => {
  if (event.data == null) return
  let payload: any
  try {
    payload = event.data.json()
  } catch {
    return
  }
  if (payload?.title === undefined) return
  event.waitUntil(
    worker.registration.showNotification(payload.title, {
      body: payload.body,
      icon: payload.icon,
      tag: payload.tag,
      data: {
        domain: payload.domain,
        url: payload.url,
        notificationId: payload.tag
      }
    })
  )
})

worker.addEventListener('notificationclick', (event: NotificationClickEvent) => {
  event.notification.close()
  const data = event.notification.data
  // Push notifications carry a target url (reminders do not) - navigate to the message, like Huly does.
  if (data?.url !== undefined && data.domain !== undefined) {
    event.waitUntil(handlePushClick(data))
    return
  }
  // Punch reminder: 'punch' when a button is clicked; '' (body click) is focus + punch too. 'snooze' snoozes.
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

// Focus (or open) the tab showing the notified doc and relay the click to Huly's page listener,
// which performs the in-app navigation. Mirrors handleNotificationClick in notification/serviceWorker.ts.
async function handlePushClick (data: PushNotificationData): Promise<void> {
  const url = data.url
  const domain = data.domain
  if (url === undefined || domain === undefined) return
  const all: WindowClientLike[] = await worker.clients.matchAll({ type: 'window', includeUncontrolled: true })
  const target = new URL(url)
  for (const client of all) {
    const clientUrl = new URL(client.url, worker.location.href)
    if (decodeURI(clientUrl.pathname) === target.pathname) {
      client.postMessage({ type: 'notification-click', url, _id: data.notificationId })
      await client.focus()
      return
    }
  }
  for (const client of all) {
    if (typeof client.url === 'string' && client.url.startsWith(domain)) {
      client.postMessage({ type: 'notification-click', url, _id: data.notificationId })
      await client.focus()
      return
    }
  }
  if (worker.clients.openWindow !== undefined) {
    await worker.clients.openWindow(url)
  }
}
