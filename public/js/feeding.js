/**
 * Breastfeeding sessions that know about sides.
 *
 * A nursing session is not one number. Which breast, for how long each, and
 * which one to start on next time are the things a feeding parent actually
 * tracks — and the last of those is the one nobody can hold in their head at
 * 3 a.m., which is why it gets written on a scrap of paper or guessed at.
 *
 * WHERE THE SEGMENTS LIVE, AND WHY.
 *
 * Mid-feed bookkeeping is kept in this browser, keyed by baby and button, and
 * only becomes an event when the timer stops. It is deliberately not sent to
 * the backend on every switch:
 *
 *  - There is no API for it. `api.js` has three implementations — the server,
 *    the Kotlin bridge and the demo's memory store — and a fourth verb would
 *    have to be written into all of them, the Android one in Kotlin, behind an
 *    app-store release. A feature that costs a store review to ship is a
 *    feature that does not ship.
 *  - A switch has to be instant and work with no network. It is one tap by
 *    someone holding a baby with the other arm.
 *
 * What *is* sent is the side currently nursing, by re-issuing the timer with
 * its original `startedAt` — every backend replaces a running timer for the
 * same baby and button rather than stacking a second one, and every backend
 * honours a `startedAt` it is handed, so the elapsed total never resets. That
 * keeps the running-timer card honest on a second device without inventing a
 * verb for it.
 *
 * If this browser's record is missing when the timer stops — the feed was
 * started on a phone and stopped on a laptop — the entry falls back to exactly
 * what it recorded before per-side timing existed: a total duration and the
 * side it began on. Degrading to the old behaviour is the point.
 */

import { store } from './util.js';

/** The other breast. Also the whole of the alternation rule. */
export const OTHER = { Left: 'Right', Right: 'Left' };

/**
 * Whether this button times a feed that has sides.
 *
 * Read off the button's own definition rather than hard-coded to `breast`, so
 * a custom "Night nursing" button with the same Left/Right choice gets the
 * same treatment, and a bottle button with a `side` field for some other
 * reason does not — it has to be a timer to have anything to split.
 */
export function supportsSides(type) {
  if (!type || type.mode !== 'timer') return false;
  const field = (type.fields || []).find((f) => f.key === 'side');
  if (!field) return false;
  const names = (field.options || []).map((o) => (typeof o === 'string' ? o : o?.name));
  return names.includes('Left') && names.includes('Right');
}

/* ------------------------------------------------------------- the session */

/*
 * Keyed by baby and button, not by timer id: switching sides re-issues the
 * timer, which mints a new id, and a key that moved every time would strand
 * the segments it was holding. `startedAt` is carried inside the record and
 * checked on the way out, which is what makes a stale one detectable.
 */
const key = (timer) => `feed.${timer.babyId}.${timer.typeId}`;

/** The record for `timer`, or null when this browser has none for it. */
export function readSession(timer) {
  if (!timer) return null;
  const s = store.get(key(timer), null);
  // A record left behind by an earlier feed that was stopped elsewhere would
  // otherwise be applied to this one and invent minutes nobody nursed.
  if (!s || s.startedAt !== timer.startedAt) return null;
  return s;
}

export function writeSession(timer, session) {
  if (timer) store.set(key(timer), session);
}

export function clearSession(timer) {
  if (timer) store.set(key(timer), null);
}

/** Begin timing `side`, from the moment the timer itself began. */
export function startSession(timer, side) {
  const session = {
    startedAt: timer.startedAt,
    firstSide: side,
    side,
    sideStartedAt: timer.startedAt,
    leftMs: 0,
    rightMs: 0,
  };
  writeSession(timer, session);
  return session;
}

/**
 * Banked time plus whatever the side currently nursing has run up since.
 * Returns milliseconds, because rounding to minutes at every switch would let
 * a six-switch feed drift by three minutes against its own wall clock.
 */
export function elapsed(session, now = Date.now()) {
  const since = Math.max(0, now - new Date(session.sideStartedAt).getTime());
  return {
    leftMs: session.leftMs + (session.side === 'Left' ? since : 0),
    rightMs: session.rightMs + (session.side === 'Right' ? since : 0),
  };
}

/** Bank the side that was running and start the other one. */
export function switched(session, toSide, now = Date.now()) {
  const { leftMs, rightMs } = elapsed(session, now);
  return {
    ...session,
    leftMs,
    rightMs,
    side: toSide,
    sideStartedAt: new Date(now).toISOString(),
  };
}

/**
 * The fields the finished entry carries.
 *
 * `duration` is deliberately absent: every backend sets it from the timer's own
 * wall clock while saving, and a total assembled here from rounded halves would
 * quietly disagree with it.
 */
export function finish(session, now = Date.now()) {
  const { leftMs, rightMs } = elapsed(session, now);
  // Which sides were used comes off the raw milliseconds, not off the rounded
  // minutes: a five-minute feed split three ways rounds both halves towards
  // zero, and reading `side` back from those would file a two-sided feed as
  // one-sided - the one field the next feed's suggestion depends on.
  return {
    side: (leftMs > 0 && rightMs > 0) ? 'Both' : (rightMs > 0 ? 'Right' : 'Left'),
    firstSide: session.firstSide,
    leftMin: Math.round(leftMs / 60_000),
    rightMin: Math.round(rightMs / 60_000),
  };
}

/* ---------------------------------------------------------------- next side */

/**
 * Which breast to offer first, from the last feed that recorded one.
 *
 * The rule is alternation: whichever side started the last feed, the other one
 * starts this one. Entries logged before this existed carry no `firstSide`, so
 * a one-sided feed still answers and a `Both` from the old world honestly does
 * not — a guess here is worse than saying nothing, because the whole value of
 * the hint is that it is not a guess.
 */
export function nextSide(events, typeId) {
  const last = (events || []).find(
    (e) => e.typeId === typeId && (e.data?.firstSide || e.data?.side),
  );
  if (!last) return null;
  const began = last.data.firstSide
    || (last.data.side === 'Left' || last.data.side === 'Right' ? last.data.side : null);
  return began ? OTHER[began] || null : null;
}

/**
 * "L 8m · R 11m", for anywhere with room for one line about the split.
 * Callers with a nicer minute formatter to hand (`fmtMinutes`, which says
 * "1h 5m") pass it; the default is enough for a toast.
 */
export function sidesLine(data, fmt = (n) => `${n}m`) {
  const left = Number(data?.leftMin) || 0;
  const right = Number(data?.rightMin) || 0;
  if (!left && !right) return '';
  const parts = [];
  if (left) parts.push(`L ${fmt(left)}`);
  if (right) parts.push(`R ${fmt(right)}`);
  return parts.join(' · ');
}
