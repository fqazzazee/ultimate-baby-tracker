/**
 * Alarm scheduling.
 *
 * The server owns *when* an alarm is due (it has the event history); the browser
 * owns *when it rings* (it re-checks every second against `dueAt`, so a ring is
 * never late by a polling interval). Three modes:
 *
 *   sinceLast  - due `everyMinutes` after the last matching event. Logging the
 *                event resets the countdown. "Feed if it's been 3 hours."
 *   interval   - a fixed cadence from when the alarm was armed, ignoring activity.
 *                Dismissing a ring does not move the cadence; arming it again does.
 *   timeOfDay  - due at wall-clock times, e.g. medicine at 08:00 and 20:00.
 */

import { lastEventOf, getAlarmState } from './store.js';

const MIN = 60_000;

export function instanceKey(alarmId, babyId) {
  return `${alarmId}::${babyId}`;
}

/**
 * Minutes since local midnight for a wall-clock time, or null.
 *
 * Setup saves "20:00", but a config saved before it normalised - or edited by
 * hand - can hold what people actually type when the app shows a 12-hour
 * clock: "8:00 PM", "8pm", "8 p.m.", "20.00". Those used to be dropped here
 * without a word, leaving an alarm with no times that never rang. A bare "8"
 * is still refused: it could be either end of the day.
 *
 * The same grammar as `clockTime` in public/js/settings.js, which normalises
 * on save; the two cannot share a module, so keep them in step.
 */
function parseClock(text) {
  const m = /^(\d{1,2})(?:[:.h](\d{2}))?\s*(?:([ap])\.?\s*m?\.?)?$/i.exec(String(text || '').trim());
  if (!m) return null;
  const half = m[3] ? m[3].toLowerCase() : null;
  if (m[2] === undefined && !half) return null;
  let h = Number(m[1]);
  const min = m[2] === undefined ? 0 : Number(m[2]);
  if (min > 59) return null;
  if (half) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (half === 'p' ? 12 : 0);
  } else if (h > 23) {
    return null;
  }
  return h * 60 + min;
}

/** The next occurrence of a wall-clock time at or after `from`, in local time. */
function nextClockTime(from, minutesOfDay) {
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  d.setMinutes(minutesOfDay);
  if (d.getTime() < from) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/** The most recent occurrence of a wall-clock time at or before `from`. */
function prevClockTime(from, minutesOfDay) {
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  d.setMinutes(minutesOfDay);
  if (d.getTime() > from) d.setDate(d.getDate() - 1);
  return d.getTime();
}

function slotsOf(alarm) {
  return (alarm.times || []).map(parseClock).filter((v) => v !== null);
}

function nextTimeOfDay(alarm, fromMs) {
  const slots = slotsOf(alarm);
  if (!slots.length) return null;
  return Math.min(...slots.map((s) => nextClockTime(fromMs, s)));
}

function prevTimeOfDay(alarm, fromMs) {
  const slots = slotsOf(alarm);
  if (!slots.length) return null;
  return Math.max(...slots.map((s) => prevClockTime(fromMs, s)));
}

/** How long a missed time-of-day slot keeps ringing before we skip to the next. */
const MISSED_SLOT_GRACE = 60 * 60_000;

/**
 * Expand one configured alarm into a live instance per targeted baby.
 * Returns [] when the alarm is off or targets a baby that no longer exists.
 */
function expand(alarm, babies, nowMs) {
  if (!alarm || !alarm.enabled) return [];
  const targets = alarm.babyId && alarm.babyId !== 'all'
    ? babies.filter((b) => b.id === alarm.babyId)
    : babies;

  return targets.map((baby) => {
    const key = instanceKey(alarm.id, baby.id);
    const state = getAlarmState()[key] || {};
    const armedAt = state.armedAt ? new Date(state.armedAt).getTime() : nowMs;
    const typeIds = alarm.typeIds && alarm.typeIds.length ? alarm.typeIds : [];

    let dueAt = null;
    let anchorAt = null;
    let anchorLabel = '';

    if (alarm.mode === 'timeOfDay') {
      const lead = Math.max(0, Number(alarm.leadMinutes) || 0) * MIN;
      dueAt = nextTimeOfDay(alarm, nowMs);
      // A slot that has only just passed keeps ringing rather than jumping to
      // tomorrow - but only if it passed after the alarm was armed, so turning
      // an alarm on in the evening does not instantly fire this morning's slot.
      const prev = prevTimeOfDay(alarm, nowMs);
      if (prev !== null) {
        const prevDue = prev - lead;
        const stillFresh = nowMs - prevDue <= MISSED_SLOT_GRACE;
        const afterArming = prevDue >= armedAt;
        const notDismissed = state.dismissedForDueAt !== new Date(prevDue).toISOString();
        if (stillFresh && afterArming && notDismissed) dueAt = prev;
      }
    } else if (alarm.mode === 'interval') {
      // Boundaries fall at base + k*every for k >= 1; base itself is the moment
      // of arming and never rings. Work in due times (boundary minus lead), the
      // same as the comparison the browser makes.
      //
      // This used to return the boundary just passed, so an alarm was due the
      // moment it was armed, and a Dismiss - which moved the base to "now" -
      // produced a fresh due time seconds later that it had not dismissed, and
      // the alarm rang straight back.
      const every = Math.max(1, Number(alarm.everyMinutes) || 60) * MIN;
      const lead = Math.max(0, Number(alarm.leadMinutes) || 0) * MIN;
      const base = state.lastCycleAt ? new Date(state.lastCycleAt).getTime() : armedAt;
      let k = Math.max(1, Math.floor((nowMs + lead - base) / every) + 1); // first due still ahead
      // The one just passed keeps ringing until it is answered, inside the same
      // grace a time-of-day slot gets. Without it, any refresh after the ring
      // started - another phone logging a diaper - moved `dueAt` to the next
      // boundary and silenced it unanswered, and a snooze skipped a whole cycle.
      if (k > 1) {
        const prevDue = base + (k - 1) * every - lead;
        const stillFresh = nowMs - prevDue <= MISSED_SLOT_GRACE;
        const notDismissed = state.dismissedForDueAt !== new Date(prevDue).toISOString();
        if (stillFresh && notDismissed) k -= 1;
      }
      dueAt = base + k * every;
      anchorAt = base;
      anchorLabel = 'armed';
    } else {
      // sinceLast
      const last = typeIds.length ? lastEventOf(baby.id, typeIds) : null;
      anchorAt = last ? new Date(last.at).getTime() : armedAt;
      anchorLabel = last ? 'last logged' : 'armed';
      dueAt = anchorAt + Math.max(1, Number(alarm.everyMinutes) || 60) * MIN;
    }

    if (dueAt !== null) dueAt -= Math.max(0, Number(alarm.leadMinutes) || 0) * MIN;

    return {
      key,
      alarmId: alarm.id,
      babyId: baby.id,
      babyName: baby.name,
      label: alarm.label,
      emoji: alarm.emoji || '⏰',
      mode: alarm.mode,
      typeIds,
      sound: alarm.sound || 'chime',
      repeat: alarm.repeat !== false,
      snoozeMinutes: Math.max(1, Number(alarm.snoozeMinutes) || 10),
      quietHours: alarm.quietHours || null,
      dueAt: dueAt === null ? null : new Date(dueAt).toISOString(),
      anchorAt: anchorAt === null ? null : new Date(anchorAt).toISOString(),
      anchorLabel,
      snoozedUntil: state.snoozedUntil || null,
      dismissedForDueAt: state.dismissedForDueAt || null,
    };
  });
}

export function computeAlarmInstances(config, now = Date.now()) {
  const babies = config.babies || [];
  const out = [];
  for (const alarm of config.alarms || []) out.push(...expand(alarm, babies, now));
  return out.sort((a, b) => String(a.dueAt).localeCompare(String(b.dueAt)));
}
