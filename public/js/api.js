/** Thin fetch wrapper around the server API, plus the live-update stream. */

async function request(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
  }
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

export const api = {
  state: (babyId = 'all', days = 7) => request(`/api/state?babyId=${encodeURIComponent(babyId)}&days=${days}`),
  saveConfig: (config) => request('/api/config', { method: 'PUT', body: config }),

  addEvent: (event) => request('/api/events', { method: 'POST', body: event }),
  editEvent: (id, patch) => request(`/api/events/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }),
  deleteEvent: (id) => request(`/api/events/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  events: (params = {}) => request(`/api/events?${new URLSearchParams(params)}`),

  startTimer: (timer) => request('/api/timers', { method: 'POST', body: timer }),
  stopTimer: (id, extra = {}) => request(`/api/timers/${encodeURIComponent(id)}/stop`, { method: 'POST', body: extra }),
  cancelTimer: (id) => request(`/api/timers/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  verifyPin: (userId, pin) => request(`/api/users/${encodeURIComponent(userId)}/verify`, { method: 'POST', body: { pin } }),
  setPin: (userId, pin, currentPin) => request(`/api/users/${encodeURIComponent(userId)}/pin`, { method: 'POST', body: { pin, currentPin } }),

  /** Send the picked file straight through; `dryRun` only reports what is in it. */
  restore: async (file, { dryRun = false } = {}) => {
    const res = await fetch(`/api/restore${dryRun ? '?dryRun=1' : ''}`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: file,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    return data;
  },

  snoozeAlarm: (key, minutes) => request(`/api/alarms/${encodeURIComponent(key)}/snooze`, { method: 'POST', body: { minutes } }),
  dismissAlarm: (key, dueAt) => request(`/api/alarms/${encodeURIComponent(key)}/dismiss`, { method: 'POST', body: { dueAt } }),
  armAlarm: (key) => request(`/api/alarms/${encodeURIComponent(key)}/arm`, { method: 'POST', body: {} }),
};

/**
 * Unattended backups, performed by the server this page is served from.
 *
 * The work happens in lib/autobackup.js; this is the remote control for it. A
 * browser has nowhere of its own to write, which is why the schedule, the
 * destination and the retention all live on the server side and this file only
 * asks it questions.
 *
 * `canPickFolder` is false because there is no picker to open: the destination
 * is `data/backups/`, or wherever `BT_BACKUP_DIR` points. The field exists so
 * the Setup card can branch on whether a picker is available rather than on
 * which build it is running in.
 */
export const autoBackup = {
  available: true,
  canPickFolder: false,
  status: () => request('/api/backup/auto'),
  now: () => request('/api/backup/auto/run', { method: 'POST', body: {} }),
  pickFolder: () => false,
  clearFolder: () => request('/api/backup/auto'),
};

/**
 * Subscribe to server changes. Uses SSE when available and falls back to
 * polling; `onStatus` reports connectivity so the UI can show an offline bar.
 */
export function subscribe({ onChange, onStatus, pollSeconds = 20 }) {
  let source = null;
  let poll = null;
  let lastRev = -1;

  const startPolling = () => {
    if (poll) return;
    poll = setInterval(onChange, Math.max(5, pollSeconds) * 1000);
  };

  try {
    source = new EventSource('/api/stream');
    source.addEventListener('change', (ev) => {
      onStatus?.(true);
      let rev = null;
      try { rev = JSON.parse(ev.data).rev; } catch { /* treat as generic ping */ }
      if (rev !== null && rev === lastRev) return;
      lastRev = rev;
      onChange();
    });
    source.addEventListener('open', () => onStatus?.(true));
    source.addEventListener('error', () => {
      onStatus?.(false);
      startPolling(); // EventSource retries on its own; polling covers the gap
    });
  } catch {
    startPolling();
  }

  // Belt and braces: a slow refresh keeps relative times ("2h ago") honest.
  setInterval(onChange, Math.max(30, pollSeconds * 3) * 1000);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) onChange();
  });
  window.addEventListener('online', () => { onStatus?.(true); onChange(); });
  window.addEventListener('offline', () => onStatus?.(false));
}
