/**
 * Alarm notifications, and an honest account of when they cannot work.
 *
 * Two things stand between an alarm and the notification shade:
 *
 * - Browsers only grant notifications to a secure page: https://, or
 *   http://localhost on the machine itself. The usual way to reach this app -
 *   http://192.168.x.x from a phone on the home network - is not one, and no
 *   permission prompt will ever appear there.
 * - Chrome on Android throws on `new Notification()`. It shows one only through
 *   a service worker's registration, hence /sw.js. Desktop browsers accept
 *   either, so the worker is tried first and the constructor is the fallback.
 *
 * Neither fixes a phone suspending a background tab: the alarm countdown runs
 * in the page, and a suspended page cannot ring or notify. That needs push.
 */

import { esc } from './util.js';

/** Resolves to the active registration, or null when there is none. */
let ready = null;

/**
 * Register the worker, only where it can do anything. Outside a secure context
 * the browser would refuse it anyway, and notifications are refused with it.
 */
export function registerWorker() {
  if (!window.isSecureContext || !('serviceWorker' in navigator)) return;
  ready = navigator.serviceWorker.register('/sw.js')
    .then(() => navigator.serviceWorker.ready)
    .catch((err) => {
      console.warn('[notify] service worker not registered:', err.message);
      return null;
    });
}

/** 'insecure' | 'unsupported' | 'denied' | 'default' | 'granted'. */
export function notifyState() {
  if (!window.isSecureContext) return 'insecure';
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

/** Ask for permission when it can still be asked; returns the new state. */
export async function requestPermission() {
  if (notifyState() !== 'default') return notifyState();
  try {
    await Notification.requestPermission();
  } catch (err) {
    console.warn('[notify] permission request failed:', err.message);
  }
  return notifyState();
}

/** Wait for `promise`, but give up after `ms` with null. */
function within(promise, ms) {
  return Promise.race([promise, new Promise((r) => setTimeout(() => r(null), ms))]);
}

/**
 * Show one alarm. Resolves true when a notification was shown. Failures are
 * logged rather than swallowed: a notification that silently never appears is
 * exactly the bug this module was written to stop.
 */
export async function showAlarm(title, { body, tag }) {
  if (notifyState() !== 'granted') return false;
  const options = { body, tag, requireInteraction: true, icon: '/icon.svg' };

  const reg = ready ? await within(ready, 3000) : null;
  if (reg) {
    try {
      await reg.showNotification(title, options);
      return true;
    } catch (err) {
      console.warn('[notify] service worker could not show the alarm:', err.message);
    }
  }
  try {
    const n = new Notification(title, options);
    n.onclick = () => { window.focus(); n.close(); };
    return true;
  } catch (err) {
    console.warn('[notify] could not show the alarm notification:', err.message);
    return false;
  }
}

/** One plain sentence for a toast after asking, by the state that resulted. */
export function permissionText(state) {
  switch (state) {
    case 'granted': return 'Notifications on';
    case 'denied': return 'Notifications are blocked - allow them in the browser\'s site settings';
    case 'insecure': return 'Notifications need https:// - this page is plain http';
    case 'unsupported': return 'This browser has no notifications';
    default: return 'Notifications not enabled';
  }
}

/**
 * What the Alarms screen should say about notifications here, as HTML.
 * Empty when they are on; a button when they can still be asked for.
 */
export function notifyNotice() {
  const box = (html) => `<div class="card small" role="status" style="margin-top:12px">${html}</div>`;
  switch (notifyState()) {
    case 'granted':
      return '';
    case 'default':
      return '<button class="btn wide" data-act="ask-notify">🔔 Enable notifications</button>';
    case 'insecure':
      return box(`🔕 <b>Notifications can't work on this address.</b>
        Browsers allow them only on a secure page - https://, or http://localhost
        on the computer running the server - and this one is
        <b>${esc(location.origin)}</b>. Alarms still ring and show on screen while
        this tab is open.`);
    case 'denied':
      return box(`🔕 <b>Notifications are blocked for this site.</b>
        To be nudged while the app is in the background, allow them in the
        browser's site settings and reload. Alarms still ring while this tab is open.`);
    default:
      return box('🔕 <b>This browser has no notifications.</b> Alarms still ring while this tab is open.');
  }
}
