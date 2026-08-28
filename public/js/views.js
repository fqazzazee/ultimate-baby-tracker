/** The three main screens: Track, History and Alarms. */

import {
  state, config, currentBaby, runningTimer, openSheet,
} from './core.js';
import {
  esc, fmtTime, fmtDate, fmtAgo, fmtSpan, fmtClock, fmtMinutes, babyAge, dayKey, ringState,
} from './util.js';
import {
  typeOf, userOf, toneStyle, activeTypes, trackedMetrics, summarize, alertFor,
} from './ui.js';
import {
  nutritionOn, shownNutrients, totalNutrients, fmtNutrient,
  referenceFor, referenceLine, nutrientMeta, tidy, milkFor, milkTypeIds,
} from './nutrition.js';

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
  // Same definition of "a feed" the Statistics screen uses, so the two agree.
  const feedTypes = milkTypeIds(config());
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

/**
 * The overview tile. Every figure on it is one Setup is actually tracking:
 * untick Sleep and the sleep tile goes with the card, rather than sitting
 * there reading "-" forever.
 */
function heroCard() {
  const baby = currentBaby();
  if (!baby) return '';
  const cfg = config();
  const on = trackedMetrics(cfg);
  const s = todayStats();
  const feedTypes = milkTypeIds(cfg);
  const lastFeed = eventsForBaby().find((e) => feedTypes.has(e.typeId));
  const lastDiaper = lastOfType('diaper');

  const since = [
    on.feeds ? `🍼 ${lastFeed ? esc(fmtAgo(lastFeed.at)) : 'no feed yet'}` : '',
    on.diapers ? `🧷 ${lastDiaper ? esc(fmtAgo(lastDiaper.at)) : 'no change yet'}` : '',
  ].filter(Boolean).join(' · ');

  const tile = (value, label) => `<div class="stat"><div class="v">${value}</div><div class="k">${label}</div></div>`;
  const tiles = [
    on.feeds ? tile(s.feeds, 'Feeds') : '',
    on.feeds ? tile(s.volume || '—', 'cc today') : '',
    on.diapers ? tile(s.wet, 'Wet') : '',
    on.diapers ? tile(s.poop, 'Poop') : '',
    on.sleep ? tile(s.sleepMin ? esc(fmtMinutes(s.sleepMin)) : '—', 'Sleep') : '',
  ].filter(Boolean).join('');

  return `
    <div class="card" style="${toneStyle(baby.tone)}">
      <div class="hero">
        <div class="face">${esc(baby.emoji || '👶')}</div>
        <div class="grow" style="flex:1">
          <h2>${esc(baby.name)}</h2>
          <div class="muted small">${esc(babyAge(baby.birthDate) || 'Add a birthday in Setup')}</div>
          ${since ? `<div class="small" style="margin-top:4px">${since}</div>` : ''}
        </div>
      </div>
      ${tiles ? `<div class="stat-grid">${tiles}</div>` : ''}
    </div>`;
}

/**
 * What today's cc actually amounted to. Volumes are multiplied by the milk
 * profile on each feed, so this only ever reflects feeds that recorded an
 * amount - it says so out loud rather than implying the baby ate less.
 */
function nutritionToday() {
  const cfg = config();
  if (!nutritionOn(cfg)) return '';
  const shown = shownNutrients(cfg);
  if (!shown.length) return '';

  const { totals, ml, counted, unmeasured } = totalNutrients(cfg, todaysEvents());
  if (!counted) return '';
  const baby = currentBaby();
  const weight = Number(baby?.weightKg) || 0;
  const perKg = weight && totals.kcal ? `${(totals.kcal / weight).toFixed(0)} kcal/kg` : '';

  return `
    <div class="card" style="${toneStyle('lemon')}">
      <div class="row">
        <div style="font-size:1.5rem">🥣</div>
        <div class="grow" style="flex:1;min-width:0">
          <div style="font-weight:800">Nutrition today</div>
          <div class="small muted">${ml} cc over ${counted} measured feed${counted === 1 ? '' : 's'}${perKg ? ` · ${esc(perKg)}` : ''}</div>
        </div>
      </div>
      <div class="stat-grid kpi">
        ${shown.map((n) => {
          const taken = totals[n.key] || 0;
          return `
          <button class="stat tappable" data-act="nutrient-info" data-key="${esc(n.key)}"
            data-tip="${esc(`${n.label}: ${referenceLine(n.key, taken, baby)}`)}"
            aria-label="${esc(`${n.label}. ${referenceLine(n.key, taken, baby)}. Tap for the reference figure.`)}">
            <div class="v">${esc(fmtNutrient(n.key, taken).split(' ')[0])}</div>
            <div class="k">${esc(n.label)} ${esc(n.unit)}</div>
          </button>`;
        }).join('')}
      </div>
      ${unmeasured ? `<p class="small muted" style="margin:10px 0 0">
        ${unmeasured} feed${unmeasured === 1 ? '' : 's'} today had no volume recorded, so the real totals are higher.
      </p>` : ''}
    </div>`;
}

/**
 * What one nutrient tile means, on tap: how much has gone in today, what the
 * reference figure for a baby this age is, and - the part that matters most -
 * why that reference is not a target.
 */
export function openNutrientSheet(key) {
  const cfg = config();
  const baby = currentBaby();
  const meta = nutrientMeta(key);
  if (!meta) return;

  const events = todaysEvents();
  const { totals, ml, counted, unmeasured } = totalNutrients(cfg, events);
  const taken = totals[key] || 0;
  const ref = referenceFor(key, baby);
  const pct = ref?.value ? Math.round((taken / ref.value) * 100) : null;

  // Which milks got the baby here, largest contribution first.
  const byMilk = new Map();
  for (const e of events) {
    const amount = Number(e.data?.amount) || 0;
    if (!amount || e.typeId === 'pump') continue;
    const milk = milkFor(cfg, e);
    if (!milk) continue;
    const per = Number(milk.per100?.[key]);
    if (!Number.isFinite(per)) continue;
    const cur = byMilk.get(milk.name) || { ml: 0, value: 0, emoji: milk.emoji };
    cur.ml += amount;
    cur.value += (per * amount) / 100;
    byMilk.set(milk.name, cur);
  }
  const sources = [...byMilk.entries()].sort((a, b) => b[1].value - a[1].value);

  openSheet(`
    <h3>${esc(meta.emoji)} ${esc(meta.label)} today</h3>

    <div class="card" style="margin:0 0 12px;text-align:center">
      <div style="font-size:2.1rem;font-weight:900;line-height:1.1">${esc(fmtNutrient(key, taken))}</div>
      <div class="small muted">from ${ml} cc over ${counted} measured feed${counted === 1 ? '' : 's'}</div>
      ${ref?.value !== null && ref?.value !== undefined ? `
        <div class="meter" role="img"
          aria-label="${esc(`${pct}% of the ${ref.kind || 'reference'} figure of ${tidy(ref.value)} ${meta.unit}`)}">
          <span style="width:${Math.min(100, pct)}%"></span>
        </div>
        <div class="small muted" style="margin-top:6px">
          about <b>${pct}%</b> of ${esc(tidy(ref.value))} ${esc(meta.unit)}
        </div>` : ''}
    </div>

    <label class="field"><span class="lab">The reference figure</span>
      ${ref?.value !== null && ref?.value !== undefined ? `
        <div class="row" style="justify-content:space-between">
          <span>${esc(ref.kind || 'Reference')}</span>
          <b>${esc(tidy(ref.value))} ${esc(meta.unit)} / day</b>
        </div>
        <span class="small muted">${esc(ref.basis)}${ref.assumedAge ? ' — no birthday set, so this assumes under six months' : ''}</span>`
      : `<span class="small muted">${esc(ref?.perKgOnly
          ? 'Energy needs scale with body mass, so this one needs a weight on the baby\'s profile before it can be turned into a daily figure.'
          : 'There is no reference intake for this one in infancy.')}</span>`}
    </label>

    ${ref?.note ? `<p class="small muted">${esc(ref.note)}</p>` : ''}

    ${sources.length ? `
      <label class="field"><span class="lab">Where it came from</span>
        ${sources.map(([name, v]) => `
          <div class="row" style="justify-content:space-between">
            <span>${esc(v.emoji || '🍼')} ${esc(name)} <span class="muted small">${v.ml} cc</span></span>
            <b>${esc(fmtNutrient(key, v.value))}</b>
          </div>`).join('')}
      </label>` : ''}

    <div class="notice" style="border-color:color-mix(in srgb,var(--muted) 40%,transparent);background:var(--surface-2);color:var(--text)">
      <b>A reference, not a target</b>
      For the first six months these figures are an <i>Adequate Intake</i> — the
      observed average of healthy, exclusively breastfed babies. They describe
      well-fed infants rather than setting a bar to clear, so being under one is
      not a deficiency and there is no prize for being over it.
      ${unmeasured ? `And this only counts feeds with a volume written down: ${unmeasured}
        today had none, so the real total is higher than the number above.` : ''}
      Anything that worries you belongs with your pediatrician, not a phone screen.
    </div>

    <div class="sheet-actions">
      <button class="btn wide" data-close type="button">Close</button>
    </div>`);
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

/**
 * Three bands of the Track screen, kept as separate sections so a wide screen
 * can set them side by side: the buttons on the left, how the day is going in
 * the middle, what just happened on the right.
 *
 * Source order is middle, left, right - which is the order a phone wants, since
 * it stacks them straight down. The columns are re-ordered in CSS, not here, so
 * the narrow layout stays exactly as it was.
 */
export function renderTrack() {
  const cfg = config();
  if (!cfg.babies.length) return onboarding();

  const status = `${heroCard()}${nutritionToday()}${timerCards()}${alarmStrip()}`;
  const recent = recentStrip();

  return `
    ${offlineBar()}
    <div class="wrap track-cols">
      ${status ? `<section class="col-status">${status}</section>` : ''}
      <section class="col-log">
        <div class="section-title">Tap to log</div>
        ${activeTypes(cfg).map(typeCard).join('')}
      </section>
      ${recent ? `<section class="col-recent">${recent}</section>` : ''}
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
