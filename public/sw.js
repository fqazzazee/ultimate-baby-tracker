/**
 * The smallest service worker that lets an alarm reach the notification shade.
 *
 * It exists for one reason: Chrome on Android refuses `new Notification()` from
 * a page and will only show one through ServiceWorkerRegistration.showNotification.
 * So it shows notifications and handles a tap on one - nothing else.
 *
 * There is deliberately no `fetch` handler and no cache. The app promises that
 * nothing is stored for offline use; every request still goes straight to the
 * server, exactly as it did before this file existed.
 *
 * It also cannot make an alarm fire on its own. The countdown runs in the page,
 * and a phone that suspends the tab suspends that too; waking a worker from
 * nothing would take server-side push, which this app does not have.
 */

self.addEventListener('install', () => {
  // Nothing to fetch or cache, so there is no reason to wait for old tabs.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

/** A tap on an alarm brings the app forward - the tab it came from if open. */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const tab = tabs.find((c) => new URL(c.url).origin === self.location.origin);
    if (tab) return tab.focus();
    return self.clients.openWindow('/');
  })());
});
