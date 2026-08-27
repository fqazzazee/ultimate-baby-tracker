/**
 * The Statistics screen.
 *
 * The charts here are the ones a pediatric visit actually turns on: how much
 * went in, how often, how many wet and dirty diapers came out, how much sleep,
 * and when in the day the feeds cluster. Everything is derived from the same
 * entries the History screen shows — nothing is stored twice.
 *
 * One filter row scopes every chart on the screen; each chart carries a table
 * twin so no value is reachable by colour or hover alone.
 */

import { state, config, currentBaby } from './core.js';
import { api } from './api.js';
import { esc, fmtMinutes } from './util.js';
import { activeTypes } from './ui.js';
import {
  columnChart, groupedColumnChart, legend, tableTwin, chartCard,
} from './charts.js';
import {
  nutritionOn, shownNutrients, nutrientsOf, milkTypeIds, referenceFor, tidy,
} from './nutrition.js';

/**
 * A single day is bucketed by the hour; anything longer, by the day. Below a
 * day the log is thin enough that a chart says less than the History screen.
 */
export const STATS_RANGES = [1, 3, 7, 14, 30, 90];

/** Which cards have anything to say, given what Setup is set to track. */
function trackedMetrics(cfg) {
  const active = new Set(activeTypes(cfg).map((t) => t.id));
  const milk = [...milkTypeIds(cfg)].filter((id) => active.has(id));
  return {
    milk: new Set(milk),
    feeds: milk.length > 0,
    diapers: active.has('diaper'),
    sleep: active.has('sleep'),
  };
}

/* ------------------------------------------------------------- date walking */

/**
 * Midnight `n` days back, walked as calendar dates.
 *
 * Stepping by 86,400,000 ms looks equivalent and is not: across a daylight
 * saving change one day is 23 or 25 hours, so fixed-millisecond arithmetic
 * lands at 23:00 the evening before and quietly duplicates or skips a day.
 */
function startOfDay(d = new Date()) {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function addDays(date, n) {
  const out = new Date(date);
  out.setDate(out.getDate() + n);
  out.setHours(0, 0, 0, 0);
  return out;
}

/**
 * Whole calendar days between two midnights, DST included. `cap` stops the walk
 * once the answer can no longer change the caller's decision - the first entry
 * may be years back, and counting all of it to then clamp to 90 is wasted work.
 */
function daysBetween(from, to, cap = 4000) {
  let n = 0;
  const cursor = new Date(from);
  while (cursor < to && n < cap) {
    cursor.setDate(cursor.getDate() + 1);
    n += 1;
  }
  return n;
}

const bucketKey = (date) => `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;

/* ------------------------------------------------------------------- data */

/** Identifies the slice currently held, so a stale one can be spotted. */
export const statsKey = () => `${state.babyId || 'all'}|${state.statsDays}`;

/** Pull the range's entries once; every chart on the screen reads this slice. */
export async function loadStats() {
  const key = statsKey();
  const days = state.statsDays;
  const since = addDays(startOfDay(), -(days - 1));
  try {
    const { events } = await api.events({
      babyId: state.babyId || 'all',
      since: since.toISOString(),
      limit: 20000,
    });
    state.stats = { key, days, events, loading: false, error: null };
  } catch (err) {
    state.stats = { ...state.stats, key, days, loading: false, error: err.message };
  }
}

const emptyBucket = () => ({
  values: { ml: 0, feeds: 0, wet: 0, dirty: 0, sleepMin: 0, longestSleep: 0, unmeasured: 0 },
  nutrients: {},
});

/** Fold one entry into whichever bucket its timestamp falls in. */
function tally(cfg, milkIds, bucket, event) {
  const d = event.data || {};
  const v = bucket.values;

  if (milkIds.has(event.typeId)) {
    v.feeds += 1;
    const ml = Number(d.amount) || 0;
    if (ml > 0) {
      v.ml += ml;
      const n = nutrientsOf(cfg, event);
      if (n) {
        for (const [k, val] of Object.entries(n.values)) {
          bucket.nutrients[k] = (bucket.nutrients[k] || 0) + val;
        }
      }
    } else {
      v.unmeasured += 1;
    }
  }
  if (event.typeId === 'diaper') {
    if (d.pee) v.wet += 1;
    if (d.poop) v.dirty += 1;
  }
  if (event.typeId === 'sleep') {
    const mins = Number(d.duration) || 0;
    v.sleepMin += mins;
    v.longestSleep = Math.max(v.longestSleep, mins);
  }
}

/**
 * One row per calendar day in the range, oldest first, gaps filled with zeros.
 *
 * A 90-day window over three weeks of log would spend two thirds of the plot on
 * days that never existed, squashing the part worth reading - so the axis starts
 * at the first entry when that falls inside the range. Days with genuinely
 * nothing in them still get their empty column; only the run before the log
 * began is dropped.
 */
function dailyRows(cfg, events, days) {
  const milkIds = milkTypeIds(cfg);
  const today = startOfDay();
  const oldest = events.reduce((a, e) => (a === null || e.at < a ? e.at : a), null);
  let span = days;
  if (oldest) {
    span = Math.max(1, Math.min(days, daysBetween(startOfDay(new Date(oldest)), today, days) + 1));
  }

  const rows = new Map();
  for (let i = span - 1; i >= 0; i -= 1) {
    const d = addDays(today, -i);
    rows.set(bucketKey(d), {
      date: d,
      label: d.toLocaleDateString([], { day: 'numeric', month: 'numeric' }),
      full: d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }),
      ...emptyBucket(),
    });
  }

  for (const e of events) {
    const row = rows.get(bucketKey(new Date(e.at)));
    if (row) tally(cfg, milkIds, row, e);
  }
  return [...rows.values()];
}

/**
 * One row per hour of today, for the one-day range.
 *
 * Hours that have not happened yet are dropped rather than drawn as zeros - a
 * flat run of empty columns to midnight reads as "the baby stopped eating",
 * which is the opposite of what an 11 a.m. chart means.
 */
function hourlyBuckets(cfg, events, width) {
  const milkIds = milkTypeIds(cfg);
  const step = width < 420 ? 2 : 1;
  const start = startOfDay();
  const nowHour = new Date().getHours();
  const rows = [];

  for (let h = 0; h < 24; h += step) {
    if (h > nowHour) break;
    const to = Math.min(23, h + step - 1);
    rows.push({
      hour: h,
      label: h % (step === 1 ? 3 : 2) === 0 ? `${h}` : '',
      full: step === 1
        ? `${String(h).padStart(2, '0')}:00–${String(h).padStart(2, '0')}:59`
        : `${String(h).padStart(2, '0')}:00–${String(to).padStart(2, '0')}:59`,
      ...emptyBucket(),
    });
  }

  for (const e of events) {
    const at = new Date(e.at);
    if (at < start) continue;
    const row = rows[Math.floor(at.getHours() / step)];
    if (row) tally(cfg, milkIds, row, e);
  }
  return rows;
}

/**
 * Feeds by hour of day, across the whole range. On a narrow screen 24 bands
 * would each be thinner than a fingertip, so they pair up into two-hour blocks -
 * the shape of the day survives, and every bar stays tappable.
 */
function clockRows(cfg, events, width) {
  const milkIds = milkTypeIds(cfg);
  const step = width < 420 ? 2 : 1;
  const counts = new Array(24 / step).fill(0);
  for (const e of events) {
    if (milkIds.has(e.typeId)) counts[Math.floor(new Date(e.at).getHours() / step)] += 1;
  }
  return counts.map((value, i) => {
    const from = i * step;
    const to = from + step - 1;
    return {
      label: `${from}`,
      full: step === 1
        ? `${String(from).padStart(2, '0')}:00–${String(from).padStart(2, '0')}:59`
        : `${String(from).padStart(2, '0')}:00–${String(to).padStart(2, '0')}:59`,
      value,
    };
  });
}

/**
 * Per-bucket means.
 *
 * Over more than one day the last bucket is today, still filling up, and letting
 * a half-finished day drag the mean down is the fastest way to make a chart lie -
 * so it is excluded. Buckets with nothing at all in them are excluded from the
 * denominator too, which keeps a range that reaches back before the log began
 * from reporting an average diluted by days that never existed.
 *
 * Every figure here uses the same denominator, so the headline tiles and the
 * reference lines on the charts can never disagree about what "per day" means.
 */
function averages(rows, hourly) {
  const done = !hourly && rows.length > 1 ? rows.slice(0, -1) : rows;
  const withData = done.filter((r) => r.values.feeds || r.values.wet
    || r.values.dirty || r.values.sleepMin);
  const base = withData.length || 1;
  const sum = (pick) => done.reduce((a, r) => a + pick(r), 0);

  const nutrients = {};
  for (const r of done) {
    for (const [k, v] of Object.entries(r.nutrients)) nutrients[k] = (nutrients[k] || 0) + v;
  }
  for (const k of Object.keys(nutrients)) nutrients[k] /= base;

  return {
    buckets: withData.length,
    partial: !hourly && rows.length > 1,
    ml: sum((r) => r.values.ml) / base,
    feeds: sum((r) => r.values.feeds) / base,
    wet: sum((r) => r.values.wet) / base,
    dirty: sum((r) => r.values.dirty) / base,
    sleepMin: sum((r) => r.values.sleepMin) / base,
    longestSleep: Math.max(0, ...done.map((r) => r.values.longestSleep)),
    nutrients,
    kcal: nutrients.kcal || 0,
  };
}

/** Totals across the whole slice, which is what a one-day view wants to show. */
function totals(rows) {
  const out = { ml: 0, feeds: 0, wet: 0, dirty: 0, sleepMin: 0, longestSleep: 0, unmeasured: 0, nutrients: {} };
  for (const r of rows) {
    for (const k of ['ml', 'feeds', 'wet', 'dirty', 'sleepMin', 'unmeasured']) out[k] += r.values[k];
    out.longestSleep = Math.max(out.longestSleep, r.values.longestSleep);
    for (const [k, v] of Object.entries(r.nutrients)) out.nutrients[k] = (out.nutrients[k] || 0) + v;
  }
  return out;
}

/* ----------------------------------------------------------------- render */

/** Chart width in CSS pixels, so text inside the viewBox renders at its stated size. */
function chartWidth() {
  const wrap = document.querySelector('#view .wrap');
  const outer = wrap?.clientWidth || Math.min(760, window.innerWidth || 760);
  return Math.max(270, Math.round(outer - 28 - 34));
}

function statTile(label, value, hint) {
  return `<div class="stat">
    <div class="v">${esc(value)}</div>
    <div class="k">${esc(label)}</div>
    ${hint ? `<div class="small muted" style="margin-top:2px">${esc(hint)}</div>` : ''}
  </div>`;
}

function rangeRow(hourly) {
  return `<div class="viz-filter">
    <div class="seg">
      ${STATS_RANGES.map((d) => `
        <button data-act="stats-range" data-days="${d}" aria-pressed="${state.statsDays === d}">${d}d</button>`).join('')}
    </div>
    <span class="small muted">${hourly
      ? 'Today, hour by hour. Every chart below covers it.'
      : 'Every chart below covers this range.'}</span>
  </div>`;
}

export function renderStats() {
  const cfg = config();
  const baby = currentBaby();
  if (!baby) {
    return `<div class="wrap"><div class="empty"><span class="big">📊</span>Add a baby and log a few entries — the charts fill themselves in.</div></div>`;
  }

  const days = state.statsDays;
  const hourly = days === 1;

  if (state.stats.error) {
    return `<div class="wrap">${rangeRow(hourly)}<div class="empty"><span class="big">⚠️</span>${esc(state.stats.error)}</div></div>`;
  }
  if (state.stats.loading) {
    return `<div class="wrap">${rangeRow(hourly)}<div class="empty"><span class="big">📊</span>Reading the log…</div></div>`;
  }
  if (!state.stats.events.length) {
    return `<div class="wrap">
      ${rangeRow(hourly)}
      <div class="empty"><span class="big">🧸</span>Nothing logged ${hourly ? 'today' : `in the last ${days} days`} yet.</div>
    </div>`;
  }

  const width = chartWidth();
  const rows = hourly
    ? hourlyBuckets(cfg, state.stats.events, width)
    : dailyRows(cfg, state.stats.events, days);
  const avg = averages(rows, hourly);
  const sum = totals(rows);
  const weight = Number(baby.weightKg) || 0;
  const on = trackedMetrics(cfg);
  const nutrition = nutritionOn(cfg) && on.feeds;

  // A one-day view reports today's totals; a longer one reports the daily mean.
  const head = hourly
    ? { ml: sum.ml, feeds: sum.feeds, wet: sum.wet, dirty: sum.dirty, sleepMin: sum.sleepMin,
        longestSleep: sum.longestSleep, kcal: sum.nutrients.kcal || 0 }
    : avg;
  const per = hourly ? 'today' : '/ day';

  const scope = hourly
    ? 'Totals so far today — hours that have not happened yet are left off the charts.'
    : `${avg.buckets ? `Daily average over ${avg.buckets} full day${avg.buckets === 1 ? '' : 's'}`
      : 'No full days yet'}${avg.partial ? ' — today is still in progress and is left out of the averages' : ''}.`;

  return `
    <div class="wrap">
      <div class="section-title">Statistics · ${esc(baby.name)}</div>
      ${rangeRow(hourly)}

      <div class="card">
        <div class="stat-grid kpi">
          ${on.feeds ? statTile(`cc ${per}`, head.ml ? Math.round(head.ml) : '—', weight && head.ml ? `${(head.ml / weight).toFixed(0)} cc/kg` : '') : ''}
          ${on.feeds ? statTile(`Feeds ${per}`, head.feeds ? head.feeds.toFixed(hourly ? 0 : 1) : '—', '') : ''}
          ${on.sleep ? statTile(`Sleep ${per}`, head.sleepMin ? fmtMinutes(Math.round(head.sleepMin)) : '—', head.longestSleep ? `best ${fmtMinutes(head.longestSleep)}` : '') : ''}
          ${on.diapers ? statTile(`Wet ${per}`, head.wet ? head.wet.toFixed(hourly ? 0 : 1) : '—', '') : ''}
          ${on.diapers ? statTile(`Dirty ${per}`, head.dirty ? head.dirty.toFixed(hourly ? 0 : 1) : '—', '') : ''}
          ${nutrition ? statTile(`kcal ${per}`, head.kcal ? Math.round(head.kcal) : '—', weight && head.kcal ? `${(head.kcal / weight).toFixed(0)} kcal/kg` : '') : ''}
        </div>
        <p class="small muted" style="margin:12px 0 0">
          ${esc(scope)}
          ${weight ? `Per-kilo figures use ${esc(String(weight))} kg from ${esc(baby.name)}'s profile.` : 'Add a weight in Setup → Babies for per-kilo figures.'}
        </p>
      </div>

      ${on.feeds ? intakeChart(rows, avg, width, weight, hourly) : ''}
      ${on.feeds ? feedCountChart(rows, avg, width, hourly) : ''}
      ${on.diapers ? diaperChart(rows, width, hourly) : ''}
      ${on.sleep ? sleepChart(rows, avg, width, hourly) : ''}
      ${nutrition ? nutrientCharts(cfg, rows, avg, width, baby, hourly) : ''}
      ${on.feeds && !hourly ? clockChart(cfg, state.stats.events, width) : ''}

      ${untrackedNote(cfg, on)}

      <div class="notice" style="border-color:color-mix(in srgb,var(--muted) 40%,transparent);background:var(--surface-2);color:var(--text)">
        <b>📋 What to bring to the appointment</b>
        These are the numbers a pediatrician usually asks for: intake, feeds, wet
        and dirty diapers, sleep, the nutrients those feeds carried, and the
        shape of the day. They describe what you logged and nothing more — they
        are not a diagnosis, and a reference line on a chart is not a target to
        hit. Anything that worries you is a phone call, not a chart.
      </div>
    </div>`;
}

/** Say plainly which charts are missing because Setup is not tracking them. */
function untrackedNote(cfg, on) {
  const off = [];
  if (!on.feeds) off.push('feeds');
  if (!on.diapers) off.push('diapers');
  if (!on.sleep) off.push('sleep');
  if (!off.length) return '';
  const list = off.length === 1 ? off[0] : `${off.slice(0, -1).join(', ')} and ${off[off.length - 1]}`;
  return `<p class="small muted" style="margin:0 4px 14px">
    Charts for ${esc(list)} are hidden because those metrics are switched off in
    Setup → Tracked metrics. Tick them back on and they return, history included.
  </p>`;
}

/* --------------------------------------------------------------- the charts */

const xLabel = (hourly) => (hourly ? 'hour' : 'day');

function intakeChart(rows, avg, width, weight, hourly) {
  const data = rows.map((r) => ({ ...r, value: r.values.ml }));
  const missed = rows.reduce((a, r) => a + r.values.unmeasured, 0);
  return chartCard({
    id: 'viz-intake',
    title: `Milk in per ${xLabel(hourly)}`,
    subtitle: `cc from bottles and measured feeds${!hourly && weight && avg.ml ? ` · ${(avg.ml / weight).toFixed(0)} cc/kg/day on average` : ''}`,
    svg: columnChart({ rows: data, width, unit: 'cc', title: 'Milk in', avg: hourly ? null : avg.ml }),
    note: missed
      ? `${missed} feed${missed === 1 ? '' : 's'} in this range recorded no volume, so the real intake is higher than the bars.`
      : '',
    table: tableTwin({
      id: 'viz-intake',
      rows: data,
      columns: [
        { label: 'cc', get: (r) => Math.round(r.values.ml) },
        { label: 'Feeds', get: (r) => r.values.feeds },
      ],
    }),
  });
}

function feedCountChart(rows, avg, width, hourly) {
  const data = rows.map((r) => ({ ...r, value: r.values.feeds }));
  return chartCard({
    id: 'viz-feeds',
    title: `Feeds per ${xLabel(hourly)}`,
    subtitle: 'Every breastfeed and bottle, measured or not',
    svg: columnChart({
      rows: data, width, unit: 'feeds', title: 'Feeds',
      avg: hourly ? null : avg.feeds, avgDecimals: 1,
    }),
    table: tableTwin({
      id: 'viz-feeds',
      rows: data,
      columns: [{ label: 'Feeds', get: (r) => r.values.feeds }],
    }),
  });
}

function diaperChart(rows, width, hourly) {
  const series = [
    { key: 'wet', label: 'Wet', slot: 's1' },
    { key: 'dirty', label: 'Dirty', slot: 's2' },
  ];
  return chartCard({
    id: 'viz-diapers',
    title: `Diapers per ${xLabel(hourly)}`,
    subtitle: 'Wet nappies are the everyday hydration check',
    legendHTML: legend(series),
    svg: groupedColumnChart({ rows, series, width, title: 'Diapers' }),
    note: hourly ? '' : 'Once the milk is in, six or more wet diapers a day is the number most pediatricians quote for a well-hydrated newborn.',
    table: tableTwin({
      id: 'viz-diapers',
      rows,
      columns: [
        { label: 'Wet', get: (r) => r.values.wet },
        { label: 'Dirty', get: (r) => r.values.dirty },
      ],
    }),
  });
}

function sleepChart(rows, avg, width, hourly) {
  const data = rows.map((r) => ({ ...r, value: r.values.sleepMin / 60 }));
  return chartCard({
    id: 'viz-sleep',
    title: `Sleep per ${xLabel(hourly)}`,
    subtitle: 'Hours from timed sleeps only',
    svg: columnChart({
      rows: data, width, unit: 'h', title: 'Sleep', decimals: 1,
      avg: hourly ? null : avg.sleepMin / 60,
    }),
    note: 'Naps you did not time are invisible here, so treat this as a floor rather than a total.',
    table: tableTwin({
      id: 'viz-sleep',
      rows: data,
      columns: [
        { label: 'Total', get: (r) => fmtMinutes(Math.round(r.values.sleepMin)) },
        { label: 'Longest stretch', get: (r) => (r.values.longestSleep ? fmtMinutes(r.values.longestSleep) : '—') },
      ],
    }),
  });
}

/**
 * One chart per nutrient the user chose to show, each with the reference intake
 * for a baby this age drawn across it where such a figure exists.
 *
 * The reference is a line, not a target: for the first six months most of these
 * are Adequate Intakes, the observed average of exclusively breastfed infants.
 * The note under each chart says so, and the line is drawn in the same recessive
 * grey as the average rather than in a colour that would read as a threshold.
 */
function nutrientCharts(cfg, rows, avg, width, baby, hourly) {
  const shown = shownNutrients(cfg);
  if (!shown.length) return '';

  const cards = shown.map((n) => {
    const data = rows.map((r) => ({ ...r, value: r.nutrients[n.key] || 0 }));
    if (!data.some((r) => r.value > 0)) return '';

    const ref = referenceFor(n.key, baby);
    const refs = ref?.value ? [{ value: ref.value, label: `${ref.kind === 'RDA' ? 'RDA' : 'ref'} ${tidy(ref.value)}` }] : [];
    const mean = avg.nutrients[n.key] || 0;
    const weight = Number(baby.weightKg) || 0;

    const perKg = n.key === 'kcal' && weight && mean
      ? ` · ${(mean / weight).toFixed(0)} kcal/kg/day on average` : '';

    return chartCard({
      id: `viz-n-${n.key}`,
      title: `${n.label} per ${xLabel(hourly)}`,
      subtitle: `${n.emoji} ${n.unit} from the milk profile on each feed${perKg}`,
      svg: columnChart({
        rows: data, width, unit: n.unit, title: n.label, decimals: n.dp,
        avg: hourly ? null : mean, refs,
      }),
      note: [
        ref?.value
          ? `The line is the ${esc(ref.kind || 'reference')} for ${esc(ref.basis)} — a description of well-fed babies, not a bar to clear.`
          : 'There is no reference intake for this one in infancy.',
        // Iron and vitamin D both look alarming against their reference for
        // reasons that have nothing to do with the baby; say why here rather
        // than only in the tile's sheet.
        ref?.note ? esc(ref.note) : '',
      ].filter(Boolean).join(' '),
      table: tableTwin({
        id: `viz-n-${n.key}`,
        rows: data,
        columns: [{ label: `${n.label} (${n.unit})`, get: (r) => (r.value ? r.value.toFixed(n.dp) : '0') }],
      }),
    });
  }).filter(Boolean).join('');

  if (!cards) return '';
  return `<div class="section-title">Nutrients</div>
    <p class="small muted" style="margin:-4px 4px 10px">
      Only feeds with a recorded volume can be counted — a nursing session you
      timed but did not measure has no cc to scale. Choose which nutrients appear
      in Setup → Nutrition.
    </p>
    ${cards}`;
}

function clockChart(cfg, events, width) {
  const rows = clockRows(cfg, events, width);
  if (!rows.some((r) => r.value)) return '';
  return chartCard({
    id: 'viz-clock',
    title: 'When feeds happen',
    subtitle: 'Every feed in the range, by hour of the day',
    svg: columnChart({ rows, width, unit: 'feeds', title: 'Feeds by hour of day' }),
    note: 'The shape of this one is what tells you whether nights are settling — a thinning band between midnight and 5 a.m. is the thing to watch.',
    table: tableTwin({
      id: 'viz-clock',
      rows: rows.filter((r) => r.value),
      columns: [{ label: 'Feeds', get: (r) => r.value }],
    }),
  });
}
