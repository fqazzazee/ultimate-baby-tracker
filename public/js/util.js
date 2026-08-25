/** Small shared helpers: escaping, time formatting, storage. */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Escape untrusted text before it goes into innerHTML. */
export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export function uid(prefix = 'x') {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export const store = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(`bt.${key}`);
      return raw === null ? fallback : JSON.parse(raw);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(`bt.${key}`, JSON.stringify(value)); } catch { /* private mode */ }
  },
};

/* ------------------------------------------------------------------ time */

let use24h = false;
export function setTimeFormat(fmt) { use24h = fmt === '24h'; }

export function fmtTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: !use24h });
}

export function fmtDate(iso) {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date(Date.now() - 86400000);
  const same = (a, b) => a.toDateString() === b.toDateString();
  if (same(d, today)) return 'Today';
  if (same(d, yest)) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

export function dayKey(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** "2h 14m" from a millisecond span. */
export function fmtSpan(ms) {
  const abs = Math.abs(ms);
  const mins = Math.floor(abs / 60000);
  if (mins < 1) return 'less than a minute';
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h < 24) return m ? `${h}h ${m}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

export function fmtAgo(iso) {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60000) return 'just now';
  return `${fmtSpan(ms)} ago`;
}

/** HH:MM:SS clock for running timers. */
export function fmtClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** Minutes as "1h 20m". */
export function fmtMinutes(min) {
  const n = Number(min) || 0;
  if (n < 60) return `${n}m`;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** A newborn-friendly age: days, then weeks, then months. */
export function babyAge(birthDate) {
  if (!birthDate) return '';
  const born = new Date(`${birthDate}T00:00:00`);
  if (Number.isNaN(born.getTime())) return '';
  const days = Math.floor((Date.now() - born.getTime()) / 86400000);
  if (days < 0) return 'not born yet';
  if (days === 0) return 'born today';
  if (days === 1) return '1 day old';
  if (days < 14) return `${days} days old`;
  if (days < 61) {
    const w = Math.floor(days / 7);
    const d = days % 7;
    return d ? `${w}w ${d}d old` : `${w} weeks old`;
  }
  const months = Math.floor(days / 30.44);
  if (months < 24) return `${months} months old`;
  return `${Math.floor(months / 12)}y ${months % 12}m old`;
}

/** Value for an <input type="datetime-local"> in local time. */
export function toLocalInput(iso) {
  const d = iso ? new Date(iso) : new Date();
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}

export function fromLocalInput(value) {
  return value ? new Date(value).toISOString() : new Date().toISOString();
}

/** Is `date` inside an HH:MM..HH:MM window that may wrap past midnight? */
export function inQuietHours(quiet, date = new Date()) {
  if (!quiet || !quiet.from || !quiet.to) return false;
  const toMin = (s) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(s);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const from = toMin(quiet.from);
  const to = toMin(quiet.to);
  if (from === null || to === null) return false;
  const now = date.getHours() * 60 + date.getMinutes();
  return from <= to ? now >= from && now < to : now >= from || now < to;
}

/**
 * Decide whether an alarm instance should be ringing right now. The server
 * computes `dueAt`; this runs client-side every second so a ring is never
 * delayed by the polling interval.
 */
export function ringState(inst, now = Date.now()) {
  const due = inst?.dueAt ? new Date(inst.dueAt).getTime() : null;
  const snoozedUntil = inst?.snoozedUntil ? new Date(inst.snoozedUntil).getTime() : 0;
  const base = { due, ringing: false, snoozed: snoozedUntil > now, quiet: false };
  if (due === null) return base;
  if (base.snoozed) return { ...base, target: snoozedUntil };
  if (now < due) return { ...base, target: due };
  if (inst.dismissedForDueAt && inst.dismissedForDueAt === inst.dueAt) return { ...base, target: due, dismissed: true };
  if (inQuietHours(inst.quietHours)) return { ...base, target: due, quiet: true };
  return { ...base, target: due, ringing: true };
}
