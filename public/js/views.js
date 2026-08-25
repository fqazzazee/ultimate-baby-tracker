/** The three main screens: Track, History and Alarms. */

import {
  state, config, currentBaby, runningTimer,
} from './core.js';
import {
  esc, fmtTime, fmtDate, fmtAgo, fmtSpan, fmtClock, fmtMinutes, babyAge, dayKey, ringState,
} from './util.js';
import {
  typeOf, userOf, toneStyle, activeTypes, summarize, alertFor,
} from './ui.js';

/* --------------------------------------------------------------- utilities */

const eventsForBaby = () => (state.data?.events || []).filter(
  (e) => !state.babyId || e.babyId === state.babyId,
);

function todaysEvents() {
  const today = dayKey(new Date().toISOString());
  return eventsForBaby().filter((e) => dayKey(e.at) === today);
}

function lastOfType(typeId) {
  return eventsForBaby().find((e) => e.typeId === typeId) || null; // list is newest-first
}

/** Roll up today's numbers for the hero card. */
function todayStats() {
  const events = todaysEvents();
  const feedTypes = new Set(['breast', 'bottle']);
  let feeds = 0; let volume = 0; let wet = 0; let poop = 0; let sleepMin = 0;

  for (const e of events) {
    const d = e.data || {};
    if (feedTypes.has(e.typeId)) {
      feeds += 1;
      volume += Number(d.amount) || 0;
    }
    if (e.typeId === 'diaper') {
      if (d.pee) wet += 1;
      if (d.poop) poop += 1;
    }
    if (e.typeId === 'sleep') sleepMin += Number(d.duration) || 0;
  }
  return { feeds, volume, wet, poop, sleepMin, total: events.length };
}

function offlineBar() {
  return state.connected ? '' : '<div class="offline-bar">Offline — changes will retry</div>';
}

/* ------------------------------------------------------------- track view */

function heroCard() {
  const baby = currentBaby();
  if (!baby) return '';
  const s = todayStats();
  const lastFeed = eventsForBaby().find((e) => e.typeId === 'breast' || e.typeId === 'bottle');
  const lastDiaper = lastOfType('diaper');

  return `
    <div class="card" style="${toneStyle(baby.tone)}">
      <div class="hero">
        <div class="face">${esc(baby.emoji || '👶')}</div>
        <div class="grow" style="flex:1">
          <h2>${esc(baby.name)}</h2>
          <div class="muted small">${esc(babyAge(baby.birthDate) || 'Add a birthday in Setup')}</div>
          <div class="small" style="margin-top:4px">
            🍼 ${lastFeed ? esc(fmtAgo(lastFeed.at)) : 'no feed yet'} ·
            🧷 ${lastDiaper ? esc(fmtAgo(lastDiaper.at)) : 'no change yet'}
          </div>
        </div>
      </div>
      <div class="stat-grid">
        <div class="stat"><div class="v">${s.feeds}</div><div class="k">Feeds</div></div>
        <div class="stat"><div class="v">${s.volume || '—'}</div><div class="k">cc today</div></div>
        <div class="stat"><div class="v">${s.wet}</div><div class="k">Wet</div></div>
        <div class="stat"><div class="v">${s.poop}</div><div class="k">Poop</div></div>
        <div class="stat"><div class="v">${s.sleepMin ? esc(fmtMinutes(s.sleepMin)) : '—'}</div><div class="k">Sleep</div></div>
      </div>
    </div>`;
}

function timerCards() {
  const timers = (state.data?.timers || []).filter((t) => t.babyId === state.babyId);
  if (!timers.length) return '';
  return timers.map((t) => {
    const type = typeOf(config(), t.typeId);
    return `
      <div class="timer-card" style="${toneStyle(type.tone)}">
        <div style="font-size:1.8rem">${esc(type.emoji)}</div>
        <div class="grow" style="flex:1">
          <div style="font-weight:800">${esc(type.label)} running</div>
          <div class="clock" data-clock="${esc(t.startedAt)}">0:00</div>
          <div class="small muted">started ${esc(fmtTime(t.startedAt))}${t.data?.side ? ` · ${esc(t.data.side)}` : ''}</div>
        </div>
        <div style="display:grid;gap:6px">
          <button class="btn primary sm" data-act="stop-timer" data-id="${esc(t.id)}">Stop &amp; save</button>
          <button class="btn sm" data-act="cancel-timer" data-id="${esc(t.id)}">Discard</button>
        </div>
      </div>`;
  }).join('');
}

/** A one-line "next alarm" strip so the countdown is visible while tracking. */
function alarmStrip() {
  const live = (state.data?.alarms || [])
    .filter((a) => !state.babyId || a.babyId === state.babyId)
    .map((a) => ({ a, r: ringState(a) }))
    .filter((x) => x.r.target)
    .sort((x, y) => x.r.target - y.r.target);
  if (!live.length) return '';
  const { a, r } = live[0];
  return `
    <div class="card" style="${toneStyle('lemon')};display:flex;align-items:center;gap:12px;padding:12px 14px">
      <div style="font-size:1.5rem">${esc(a.emoji)}</div>
      <div class="grow" style="flex:1">
        <div style="font-weight:800">${esc(a.label)}</div>
        <div class="small muted">${r.snoozed ? 'snoozed' : r.ringing ? 'due now' : 'next in'}
          <span data-countdown="${esc(new Date(r.target).toISOString())}">…</span></div>
      </div>
      <button class="btn sm" data-act="tab" data-tab="alarms">Alarms</button>
    </div>`;
}

function typeCard(type) {
  const last = lastOfType(type.id);
  const running = runningTimer(type.id);
  const presets = type.presets?.length ? type.presets : [{ id: null, label: type.label, emoji: type.emoji, data: {} }];

  const sinceText = running
    ? 'running now'
    : last
      ? `${fmtAgo(last.at)}${summarize(last, type) ? ` · ${summarize(last, type)}` : ''}`
      : 'not logged yet';

  const buttons = running
    ? `<button class="tap running" data-act="stop-timer" data-id="${esc(running.id)}">
         <span class="ico">⏹️</span>Stop <span data-clock="${esc(running.startedAt)}">0:00</span>
       </button>`
    : presets.map((p) => `
        <button class="tap" data-act="quick" data-type="${esc(type.id)}" data-preset="${esc(p.id ?? '')}">
          <span class="ico">${esc(p.emoji || type.emoji)}</span>${esc(p.label)}
        </button>`).join('');

  return `
    <div class="type-card" style="${toneStyle(type.tone)}">
      <div class="type-head">
        <div class="emoji">${esc(type.emoji)}</div>
        <div class="grow" style="flex:1;min-width:0">
          <div class="label">${esc(type.label)}${type.mode === 'timer' ? ' <span class="pill">timer</span>' : ''}</div>
          <div class="since">${sinceText}</div>
        </div>
      </div>
      <div class="preset-row">
        ${buttons}
        <button class="tap ghost" data-act="details" data-type="${esc(type.id)}" title="Log with details" aria-label="Log ${esc(type.label)} with details">⋯</button>
      </div>
    </div>`;
}

function recentStrip() {
  const recent = eventsForBaby().slice(0, 4);
  if (!recent.length) return '';
  const cfg = config();
  return `
    <div class="section-title">Just now</div>
    ${recent.map((e) => entryRow(e, cfg)).join('')}
    <button class="btn wide" data-act="tab" data-tab="history" style="margin-top:4px">See full history</button>`;
}

export function renderTrack() {
  const cfg = config();
  if (!cfg.babies.length) return onboarding();
  return `
    ${offlineBar()}
    <div class="wrap">
      ${heroCard()}
      ${timerCards()}
      ${alarmStrip()}
      <div class="section-title">Tap to log</div>
      ${activeTypes(cfg).map(typeCard).join('')}
      ${recentStrip()}
    </div>`;
}

function onboarding() {
  return `
    <div class="wrap">
      <div class="card center" style="margin-top:28px">
        <div style="font-size:3.4rem">🍼</div>
        <h2 style="margin:10px 0 6px">Welcome!</h2>
        <p class="muted">Add your baby and you can start logging with one tap.</p>
        <button class="btn primary wide" data-act="add-baby" style="margin-top:14px">Add a baby</button>
      </div>
    </div>`;
}

/* ----------------------------------------------------------- history view */

function entryRow(e, cfg) {
  const type = typeOf(cfg, e.typeId);
  const user = userOf(cfg, e.userId);
  const baby = cfg.babies.find((b) => b.id === e.babyId);
  const alert = alertFor(e, type);
  const detail = summarize(e, type);
  return `
    <div class="entry" style="${toneStyle(type.tone)}" data-act="edit-event" data-id="${esc(e.id)}" role="button" tabindex="0">
      <div class="ico">${esc(type.emoji)}</div>
      <div class="body">
        <div class="title">${esc(type.label)}${detail ? ` <span class="muted" style="font-weight:600">${detail}</span>` : ''}</div>
        <div class="meta">${esc(user.emoji)} ${esc(user.name)}${cfg.babies.length > 1 && baby ? ` · ${esc(baby.name)}` : ''} · ${esc(fmtAgo(e.at))}</div>
        ${alert ? `<div class="pill alert" style="margin-top:4px">⚠️ ${esc(alert)}</div>` : ''}
      </div>
      <div class="when">${esc(fmtTime(e.at))}</div>
    </div>`;
}

export function renderHistory() {
  const cfg = config();
  const all = eventsForBaby();
  const filtered = state.historyType === 'all' ? all : all.filter((e) => e.typeId === state.historyType);

  const groups = new Map();
  for (const e of filtered) {
    const key = dayKey(e.at);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }

  const filterChips = `
    <div class="chip-strip" style="padding-left:0;padding-right:0">
      <button class="chip" data-act="filter-type" data-type="all" aria-pressed="${state.historyType === 'all'}">All</button>
      ${activeTypes(cfg).map((t) => `
        <button class="chip" style="${toneStyle(t.tone)}" data-act="filter-type" data-type="${esc(t.id)}"
          aria-pressed="${state.historyType === t.id}">${esc(t.emoji)} ${esc(t.label)}</button>`).join('')}
    </div>`;

  const rangeSeg = `
    <div class="seg" style="margin-bottom:12px">
      ${[1, 3, 7, 14, 30].map((d) => `
        <button data-act="range" data-days="${d}" aria-pressed="${state.historyDays === d}">${d}d</button>`).join('')}
    </div>`;

  const body = groups.size
    ? [...groups.entries()].map(([key, list]) => {
        const dayTotal = list.reduce((acc, e) => acc + (Number(e.data?.amount) || 0), 0);
        return `
          <div class="day-head">
            <span>${esc(fmtDate(list[0].at))}</span>
            <span class="muted small">${list.length} entries${dayTotal ? ` · ${dayTotal} cc` : ''}</span>
          </div>
          ${list.map((e) => entryRow(e, cfg)).join('')}`;
      }).join('')
    : '<div class="empty"><span class="big">🧸</span>Nothing logged in this range yet.</div>';

  return `
    ${offlineBar()}
    <div class="wrap">
      <div class="section-title">History</div>
      ${rangeSeg}
      ${filterChips}
      ${body}
      <button class="btn wide" data-act="export" style="margin-top:14px">⬇️ Export CSV</button>
    </div>`;
}

/* ------------------------------------------------------------ alarms view */

export function renderAlarms() {
  const cfg = config();
  const instances = state.data?.alarms || [];

  const cards = (cfg.alarms || []).map((alarm) => {
    const mine = instances.filter((i) => i.alarmId === alarm.id);
    const inst = mine.find((i) => i.babyId === state.babyId) || mine[0] || null;
    const r = inst ? ringState(inst) : null;
    const types = (alarm.typeIds || []).map((id) => typeOf(cfg, id).label).join(', ') || 'nothing yet';

    const desc = alarm.mode === 'timeOfDay'
      ? `At ${(alarm.times || []).join(', ') || '—'}`
      : alarm.mode === 'interval'
        ? `Every ${fmtSpan(alarm.everyMinutes * 60000)}, always`
        : `${fmtSpan(alarm.everyMinutes * 60000)} after the last ${types}`;

    const countdown = !alarm.enabled
      ? '<span class="muted">off</span>'
      : r?.ringing
        ? '<span class="countdown over">due now</span>'
        : r?.target
          ? `<span class="countdown" data-countdown="${esc(new Date(r.target).toISOString())}">…</span>`
          : '<span class="muted">—</span>';

    return `
      <div class="alarm-card ${r?.ringing ? 'due' : ''}" style="${toneStyle('lemon')}">
        <div class="row">
          <div style="font-size:1.8rem">${esc(alarm.emoji || '⏰')}</div>
          <div class="grow" style="flex:1;min-width:0">
            <div style="font-weight:900">${esc(alarm.label)}</div>
            <div class="small muted">${esc(desc)}${r?.snoozed ? ' · snoozed' : ''}${alarm.quietHours ? ` · quiet ${esc(alarm.quietHours.from)}–${esc(alarm.quietHours.to)}` : ''}</div>
          </div>
          <label class="switch" style="padding:0">
            <input type="checkbox" data-act="toggle-alarm" data-id="${esc(alarm.id)}" ${alarm.enabled ? 'checked' : ''}>
            <span class="track"></span>
          </label>
        </div>
        <div class="row" style="margin-top:10px">
          <div class="grow" style="flex:1">${countdown}</div>
          ${alarm.enabled && inst ? `
            <button class="btn sm" data-act="snooze-alarm" data-key="${esc(inst.key)}" data-min="${alarm.snoozeMinutes}">😴 ${alarm.snoozeMinutes}m</button>
            <button class="btn sm" data-act="reset-alarm" data-key="${esc(inst.key)}">↻ Reset</button>` : ''}
          <button class="btn sm" data-act="edit-alarm" data-id="${esc(alarm.id)}">Edit</button>
        </div>
      </div>`;
  }).join('');

  return `
    ${offlineBar()}
    <div class="wrap">
      <div class="section-title">Alarms &amp; reminders</div>
      ${cards || '<div class="empty"><span class="big">⏰</span>No alarms yet.</div>'}
      <button class="btn primary wide" data-act="add-alarm" style="margin-top:8px">➕ New alarm</button>
      <p class="small muted" style="margin-top:14px;text-align:center">
        Alarms ring in any open tab. Allow notifications to be nudged when the app is in the background.
      </p>
      ${'Notification' in window && Notification.permission !== 'granted'
        ? '<button class="btn wide" data-act="ask-notify">🔔 Enable notifications</button>' : ''}
    </div>`;
}

export { entryRow };
