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
import { trackedMetrics, activeTypes } from './ui.js';
import { supportsSides } from './feeding.js';
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

/**
 * Which charts the user asked for, from Setup -> Statistics. Absent means on,
 * so a config written before these switches existed keeps every chart.
 */
function chartPrefs(cfg) {
  const want = cfg?.stats?.charts || {};
  const on = (key) => want[key] !== false;
  return {
    intake: on('intake'),
    feeds: on('feeds'),
    diapers: on('diapers'),
    sleep: on('sleep'),
    pump: on('pump'),
    clock: on('clock'),
    sides: on('sides'),
  };
}

/**
 * Whether a per-button chart is drawn.
 *
 * These are not in the shipped defaults - the keys depend on buttons that did
 * not exist when the app was installed - so the default is carried here rather
 * than in `defaultConfig()`. A button somebody made themselves is on: they made
 * it to track something, and a chart of it is the point. One of the eight that
 * ship is off until asked for, so nobody who never touched Setup finds three
 * new charts of bath times on their Statistics screen.
 */
export function customChartOn(cfg, type, metricKey) {
  // Its own branch of the config rather than a key in `stats.charts`: the
  // hand-written charts keep flat booleans there, and one of them is already
  // called `sleep` - which is also the id of a button. Nesting these under
  // `stats.buttons` keeps a chart switch and a button's chart switches from
  // ever being the same key.
  const want = cfg?.stats?.buttons?.[type.id];
  const value = want && typeof want === 'object' ? want[metricKey] : undefined;
  return value === undefined ? !type.builtin : value !== false;
}

/* ------------------------------------------------- charts from any button */

/**
 * Types that already have a chart written for them by hand. The generic
 * builder leaves them alone rather than drawing a second, worse version of
 * something the bespoke card already says better.
 */
function bespokeTypeIds(cfg) {
  const ids = new Set(milkTypeIds(cfg));
  ids.add('diaper');
  ids.add('sleep');
  ids.add('pump');
  return ids;
}

/**
 * What a button can be charted by, read off the fields it records.
 *
 * Every button can answer "how many a day". Beyond that, a field is chartable
 * when it is a quantity: a number to add up, a stretch of time to total, or a
 * yes/no to count the yeses.
 *
 * Choice and colour fields are deliberately absent. Charting one means a series
 * per option, and the palette here has two slots on purpose - stepped for light
 * and dark and checked for colour-vision deficiency - so an eleven-colour poop
 * chart would either repeat colours or invent unvalidated ones. Setup says this
 * out loud rather than leaving the omission to be noticed.
 */
export function chartableMetrics(type) {
  const out = [{ key: 'count', label: 'How many', kind: 'count', unit: '', agg: 'count' }];
  for (const f of type.fields || []) {
    if (f.type === 'number') {
      out.push({ key: f.key, label: f.label, kind: 'number', unit: f.unit || '', agg: aggOf(f) });
    } else if (f.type === 'duration') {
      out.push({ key: f.key, label: f.label, kind: 'duration', unit: 'min', agg: aggOf(f) });
    } else if (f.type === 'toggle') {
      out.push({ key: f.key, label: f.label, kind: 'toggle', unit: '', agg: 'count' });
    }
  }
  return out;
}

/** Aggregations a number can be charted by, and what each is for. */
export const AGGREGATIONS = [
  { value: 'sum', label: 'Total', hint: 'Added up over the day — for amounts' },
  { value: 'avg', label: 'Average', hint: 'The mean of the day\'s entries' },
  { value: 'last', label: 'Latest', hint: 'The last one that day — for measurements' },
];

/**
 * How a field's numbers combine over a day.
 *
 * The default is `sum`, which is right for anything you are accumulating - cc
 * of milk, minutes of tummy time - and badly wrong for anything you are
 * measuring. Three weigh-ins added up says a 7 lb baby weighs 21 lb, which is
 * not a chart with a rough edge, it is a chart that lies. A field can say which
 * it is; the field editor in Setup offers the choice.
 */
function aggOf(field) {
  return ['sum', 'avg', 'last'].includes(field.agg) ? field.agg : 'sum';
}

/** typeId -> its chartable metrics, for the tally pass. */
function customMetricMap(cfg) {
  return new Map(customChartTypes(cfg).map((x) => [x.type.id, x.metrics]));
}

/** The buttons the generic builder is responsible for, with their metrics. */
export function customChartTypes(cfg) {
  const bespoke = bespokeTypeIds(cfg);
  return activeTypes(cfg)
    .filter((t) => !bespoke.has(t.id))
    .map((t) => ({ type: t, metrics: chartableMetrics(t) }))
    .filter((x) => x.metrics.length);
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
  values: {
    ml: 0, feeds: 0, wet: 0, dirty: 0, sleepMin: 0, longestSleep: 0, unmeasured: 0,
    pumpMl: 0, pumps: 0, leftMin: 0, rightMin: 0, nursedMin: 0,
  },
  nutrients: {},
  // "<typeId>.<metricKey>" -> running total, for the charts built from a
  // button's own fields rather than from a hand-written one.
  custom: {},
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
  // Pumping is milk coming out, never in: it is counted here and nowhere near
  // the intake or nutrient totals.
  if (event.typeId === 'pump') {
    v.pumps += 1;
    v.pumpMl += Number(d.amount) || 0;
  }
  // Time at the breast, split by side. Counted off the entry's own fields, so
  // a feed logged or corrected by hand counts exactly like a timed one.
  const left = Number(d.leftMin) || 0;
  const right = Number(d.rightMin) || 0;
  if (left || right) {
    v.leftMin += left;
    v.rightMin += right;
    v.nursedMin += left + right;
  }
}

/**
 * Fold one entry into whatever generic metrics its button declares.
 *
 * Each cell keeps the count, the running total and the latest value with its
 * timestamp, so the same pass answers "total", "average" and "latest" without
 * knowing in advance which of them a chart is going to ask for.
 */
function tallyCustom(metrics, bucket, event) {
  const list = metrics.get(event.typeId);
  if (!list) return;
  const d = event.data || {};
  for (const m of list) {
    const id = `${event.typeId}.${m.key}`;
    const cell = bucket.custom[id] || (bucket.custom[id] = { n: 0, sum: 0, last: 0, at: '' });
    if (m.kind === 'count') {
      cell.n += 1;
    } else if (m.kind === 'toggle') {
      if (d[m.key]) cell.n += 1;
    } else {
      const n = Number(d[m.key]);
      if (!Number.isFinite(n)) continue;
      cell.n += 1;
      cell.sum += n;
      // Entries arrive newest-first, so only an older one may overwrite.
      if (!cell.at || event.at > cell.at) { cell.last = n; cell.at = event.at; }
    }
  }
}

/** One number out of a cell, according to what the metric asked for. */
export function metricValue(metric, cell) {
  if (!cell) return 0;
  if (metric.agg === 'count') return cell.n;
  if (metric.agg === 'avg') return cell.n ? cell.sum / cell.n : 0;
  if (metric.agg === 'last') return cell.last;
  return cell.sum;
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
  const metrics = customMetricMap(cfg);
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
    if (row) { tally(cfg, milkIds, row, e); tallyCustom(metrics, row, e); }
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
  const metrics = customMetricMap(cfg);
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
    if (row) { tally(cfg, milkIds, row, e); tallyCustom(metrics, row, e); }
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
function averages(rows, hourly, metricsByKey = new Map()) {
  const done = !hourly && rows.length > 1 ? rows.slice(0, -1) : rows;
  // A day whose only entry was on a button of your own is still a day with
  // something in it; leaving it out would divide that button's own chart by a
  // denominator that pretends the day never happened.
  const withData = done.filter((r) => r.values.feeds || r.values.wet
    || r.values.dirty || r.values.sleepMin || r.values.pumps
    || Object.values(r.custom).some((c) => c && c.n));
  const base = withData.length || 1;
  const sum = (pick) => done.reduce((a, r) => a + pick(r), 0);

  const nutrients = {};
  for (const r of done) {
    for (const [k, v] of Object.entries(r.nutrients)) nutrients[k] = (nutrients[k] || 0) + v;
  }
  for (const k of Object.keys(nutrients)) nutrients[k] /= base;

  // Every generic metric gets the same denominator as everything else, so a
  // per-day figure on a custom chart means what it means everywhere else. The
  // mean is taken over each day's *resolved* value, so the average line under a
  // "latest weight" chart is the average of the daily weights rather than of
  // some total nobody asked for.
  const custom = {};
  for (const r of done) {
    for (const [k, cell] of Object.entries(r.custom)) {
      const m = metricsByKey.get(k);
      if (!m) continue;
      const bin = custom[k] || (custom[k] = { total: 0, days: 0 });
      bin.total += metricValue(m, cell);
      // A "latest" or "average" metric skips days it never happened on rather
      // than averaging a zero in, which would drag a weight chart towards nil.
      if (m.agg === 'sum' || m.agg === 'count' || cell.n) bin.days += 1;
    }
  }
  for (const k of Object.keys(custom)) {
    const m = metricsByKey.get(k);
    custom[k] = (m.agg === 'sum' || m.agg === 'count')
      ? custom[k].total / base
      : custom[k].total / (custom[k].days || 1);
  }

  return {
    buckets: withData.length,
    partial: !hourly && rows.length > 1,
    custom,
    leftMin: sum((r) => r.values.leftMin) / base,
    rightMin: sum((r) => r.values.rightMin) / base,
    nursedMin: sum((r) => r.values.nursedMin) / base,
    ml: sum((r) => r.values.ml) / base,
    feeds: sum((r) => r.values.feeds) / base,
    wet: sum((r) => r.values.wet) / base,
    dirty: sum((r) => r.values.dirty) / base,
    sleepMin: sum((r) => r.values.sleepMin) / base,
    pumpMl: sum((r) => r.values.pumpMl) / base,
    pumps: sum((r) => r.values.pumps) / base,
    longestSleep: Math.max(0, ...done.map((r) => r.values.longestSleep)),
    nutrients,
    kcal: nutrients.kcal || 0,
  };
}

/** Totals across the whole slice, which is what a one-day view wants to show. */
function totals(rows) {
  const out = {
    ml: 0, feeds: 0, wet: 0, dirty: 0, sleepMin: 0, longestSleep: 0, unmeasured: 0,
    pumpMl: 0, pumps: 0, leftMin: 0, rightMin: 0, nursedMin: 0,
    nutrients: {}, custom: {},
  };
  for (const r of rows) {
    for (const k of ['ml', 'feeds', 'wet', 'dirty', 'sleepMin', 'unmeasured', 'pumpMl',
      'pumps', 'leftMin', 'rightMin', 'nursedMin']) out[k] += r.values[k];
    out.longestSleep = Math.max(out.longestSleep, r.values.longestSleep);
    for (const [k, v] of Object.entries(r.nutrients)) out.nutrients[k] = (out.nutrients[k] || 0) + v;
    for (const [k, cell] of Object.entries(r.custom)) {
      const bin = out.custom[k] || (out.custom[k] = { n: 0, sum: 0, last: 0, at: '' });
      bin.n += cell.n;
      bin.sum += cell.sum;
      if (!bin.at || cell.at > bin.at) { bin.last = cell.last; bin.at = cell.at; }
    }
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
  const metricsByKey = new Map(
    customChartTypes(cfg).flatMap(({ type, metrics }) => metrics.map((m) => [`${type.id}.${m.key}`, m])),
  );
  const avg = averages(rows, hourly, metricsByKey);
  const sum = totals(rows);
  const weight = Number(baby.weightKg) || 0;
  const on = trackedMetrics(cfg);
  const charts = chartPrefs(cfg);
  const nutrition = nutritionOn(cfg) && on.feeds;
  // Only worth any of the nursing furniture when a button records sides at all
  // and something in this range actually used it.
  const nursing = activeTypes(cfg).some(supportsSides)
    && rows.some((r) => r.values.nursedMin > 0);

  // A one-day view reports today's totals; a longer one reports the daily mean.
  const head = hourly
    ? { ml: sum.ml, feeds: sum.feeds, wet: sum.wet, dirty: sum.dirty, sleepMin: sum.sleepMin,
        pumpMl: sum.pumpMl, longestSleep: sum.longestSleep, kcal: sum.nutrients.kcal || 0,
        nursedMin: sum.nursedMin, leftMin: sum.leftMin, rightMin: sum.rightMin }
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
          ${on.pump ? statTile(`cc pumped ${per}`, head.pumpMl ? Math.round(head.pumpMl) : '—', '') : ''}
          ${nursing ? statTile(`Nursing ${per}`, head.nursedMin ? fmtMinutes(Math.round(head.nursedMin)) : '—',
            head.nursedMin ? `${Math.round((head.leftMin / head.nursedMin) * 100)}% left` : '') : ''}
          ${nutrition ? statTile(`kcal ${per}`, head.kcal ? Math.round(head.kcal) : '—', weight && head.kcal ? `${(head.kcal / weight).toFixed(0)} kcal/kg` : '') : ''}
        </div>
        <p class="small muted" style="margin:12px 0 0">
          ${esc(scope)}
          ${weight ? `Per-kilo figures use ${esc(String(weight))} kg from ${esc(baby.name)}'s profile.` : 'Add a weight in Setup → Babies for per-kilo figures.'}
        </p>
      </div>

      ${on.feeds && charts.intake ? intakeChart(rows, avg, width, weight, hourly) : ''}
      ${on.feeds && charts.feeds ? feedCountChart(rows, avg, width, hourly) : ''}
      ${on.diapers && charts.diapers ? diaperChart(rows, width, hourly) : ''}
      ${on.sleep && charts.sleep ? sleepChart(rows, avg, width, hourly) : ''}
      ${on.pump && charts.pump ? pumpChart(rows, avg, width, hourly) : ''}
      ${nursing && charts.sides ? sidesChart(rows, avg, width, hourly) : ''}
      ${nutrition ? nutrientCharts(cfg, rows, avg, width, baby, hourly) : ''}
      ${on.feeds && charts.clock && !hourly ? clockChart(cfg, state.stats.events, width) : ''}
      ${customCharts(cfg, rows, avg, width, hourly)}

      ${untrackedNote(on, charts)}

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

/**
 * Say plainly which charts are missing, and which of the two switches did it -
 * a metric nobody is tracking, or a chart turned off on a screen that was
 * getting long. Either way the entries are still there.
 */
function untrackedNote(on, charts) {
  const list = (items) => (items.length === 1
    ? items[0]
    : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

  const off = [];
  if (!on.feeds) off.push('feeds');
  if (!on.diapers) off.push('diapers');
  if (!on.sleep) off.push('sleep');
  if (!on.pump) off.push('pumping');

  // Named as the switches in Setup name them, so the sentence points at a row
  // the reader can actually find.
  const hidden = [];
  if (on.feeds && !charts.intake) hidden.push('Milk in');
  if (on.feeds && !charts.feeds) hidden.push('Feeds');
  if (on.diapers && !charts.diapers) hidden.push('Diapers');
  if (on.sleep && !charts.sleep) hidden.push('Sleep');
  if (on.pump && !charts.pump) hidden.push('Pumped');
  if (on.feeds && !charts.clock) hidden.push('When feeds happen');
  if (!charts.sides) hidden.push('Nursing by side');

  return `
    ${off.length ? `<p class="small muted" style="margin:0 4px 8px">
      Charts for ${esc(list(off))} are hidden because those metrics are switched off in
      Setup → Tracked metrics. Tick them back on and they return, history included.
    </p>` : ''}
    ${hidden.length ? `<p class="small muted" style="margin:0 4px 8px">
      The ${esc(list(hidden))} chart${hidden.length === 1 ? ' is' : 's are'} switched off in
      Setup → Statistics. Nothing stopped being recorded — only the drawing is gone.
    </p>` : ''}`;
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

/**
 * What came out rather than what went in.
 *
 * Pumped milk is deliberately kept off the intake chart: the bottle it becomes
 * is logged separately, and adding both would count the same milk twice.
 */
function pumpChart(rows, avg, width, hourly) {
  const data = rows.map((r) => ({ ...r, value: r.values.pumpMl }));
  const sessions = rows.reduce((a, r) => a + r.values.pumps, 0);
  if (!sessions) return '';
  const blank = sessions - rows.reduce((a, r) => a + (r.values.pumpMl > 0 ? r.values.pumps : 0), 0);

  return chartCard({
    id: 'viz-pump',
    title: `Pumped per ${xLabel(hourly)}`,
    subtitle: 'cc expressed, from the amount on each pump entry',
    svg: columnChart({
      rows: data, width, unit: 'cc', title: 'Pumped', avg: hourly ? null : avg.pumpMl,
    }),
    note: blank
      ? 'Sessions logged without an amount leave no bar behind, so the real total is higher than this.'
      : '',
    table: tableTwin({
      id: 'viz-pump',
      rows: data,
      columns: [
        { label: 'cc', get: (r) => Math.round(r.values.pumpMl) },
        { label: 'Sessions', get: (r) => r.values.pumps },
      ],
    }),
  });
}

/**
 * Left against right, and with it how long the baby actually spent nursing.
 *
 * Two series and one axis, which is what the palette here is built for. The
 * question it answers is the one a nursing parent is usually asked at a
 * check-up and cannot answer from a stack of durations: is one side being
 * favoured, and is it getting worse.
 */
function sidesChart(rows, avg, width, hourly) {
  const sessions = rows.reduce((a, r) => a + (r.values.nursedMin > 0 ? 1 : 0), 0);
  if (!sessions) return '';

  const series = [
    { key: 'leftMin', label: 'Left', slot: 's1' },
    { key: 'rightMin', label: 'Right', slot: 's2' },
  ];
  const left = rows.reduce((a, r) => a + r.values.leftMin, 0);
  const right = rows.reduce((a, r) => a + r.values.rightMin, 0);
  const total = left + right;
  // A split is only worth remarking on once there is enough of it to mean
  // something; under an hour a single long feed swings it entirely.
  const skew = total >= 60 ? Math.round((Math.max(left, right) / total) * 100) : null;

  return chartCard({
    id: 'viz-sides',
    title: `Nursing by side per ${xLabel(hourly)}`,
    subtitle: `Minutes at the breast${skew !== null && skew >= 60
      ? ` · ${skew}% on the ${left > right ? 'left' : 'right'}`
      : ''}`,
    legendHTML: legend(series),
    svg: groupedColumnChart({ rows, series, width, unit: 'min', title: 'Nursing by side' }),
    note: [
      'Only feeds whose sides were timed appear here — a nursing session logged as one total has no split to draw.',
      skew !== null && skew >= 65
        ? 'A lasting preference for one side is worth mentioning at your next visit; it is common, usually harmless, and occasionally worth looking at.'
        : '',
    ].filter(Boolean).join(' '),
    table: tableTwin({
      id: 'viz-sides',
      rows,
      columns: [
        { label: 'Left', get: (r) => (r.values.leftMin ? fmtMinutes(Math.round(r.values.leftMin)) : '—') },
        { label: 'Right', get: (r) => (r.values.rightMin ? fmtMinutes(Math.round(r.values.rightMin)) : '—') },
        { label: 'Total', get: (r) => (r.values.nursedMin ? fmtMinutes(Math.round(r.values.nursedMin)) : '—') },
      ],
    }),
  });
}

/**
 * Whether a button's metrics share one chart instead of getting one each.
 *
 * Off by default: combining is only ever right for measures that belong on the
 * same axis, and the app cannot know that a "Left" and a "Right" you invented
 * are two halves of one thing rather than two unrelated numbers. You know, so
 * you say - Setup -> Charts from your own buttons.
 */
export function combineCharts(cfg, type) {
  return cfg?.stats?.combine?.[type.id] === true;
}

/**
 * What may share an axis, and in what order.
 *
 * Two metrics can share a chart only when they agree about *both* things a y-axis
 * asserts: the unit the numbers are in, and how a day of them was reduced to one
 * number. Millilitres beside minutes is the "one y-axis, never two" rule broken;
 * a daily total beside a daily latest is subtler and worse, because the axis
 * looks fine and the columns mean different things.
 *
 * Groups are then cut into pairs, because the chart palette has two slots. They
 * are stepped separately for light and dark and checked for colour-vision
 * deficiency, and a third colour invented here would be neither. Three
 * compatible metrics therefore give one paired chart and one single, rather than
 * one crowded chart in colours nobody has checked.
 */
export function chartGroups(cfg, type, metrics) {
  const on = metrics.filter((m) => customChartOn(cfg, type, m.key));
  if (!combineCharts(cfg, type)) return on.map((m) => [m]);

  const buckets = new Map();
  for (const m of on) {
    const key = `${m.agg}|${m.unit || ''}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(m);
  }
  const out = [];
  for (const bucket of buckets.values()) {
    for (let i = 0; i < bucket.length; i += 2) out.push(bucket.slice(i, i + 2));
  }
  return out;
}

/** Minutes are stored, hours read better once a day's worth piles up. */
function asHoursScale(metrics, peak) {
  return metrics.every((m) => m.kind === 'duration' && m.agg !== 'count') && peak >= 120;
}

/** The sentence under the title, saying which summary these columns are. */
function summaryLine(type, m, hourly) {
  if (m.kind === 'count') return `Every ${type.label.toLowerCase()} logged`;
  if (m.kind === 'toggle') return `How often "${m.label}" was ticked`;
  return {
    sum: `Added up over the ${xLabel(hourly)}${m.unit ? ` · ${m.unit}` : ''}`,
    avg: `Average of the ${xLabel(hourly)}'s entries${m.unit ? ` · ${m.unit}` : ''}`,
    last: `The last one recorded each ${xLabel(hourly)}${m.unit ? ` · ${m.unit}` : ''}`,
  }[m.agg];
}

/**
 * What to call a metric on screen. The count metric is called "How many" in the
 * settings list, where it sits under the button's own heading - on a chart it
 * has to carry the button's name itself, or a pair reads "How many and Rained".
 */
const labelOf = (type, m) => (m.kind === 'count' ? type.label : m.label);

const cardId = (type, metrics) =>
  `viz-c-${type.id}-${metrics.map((m) => m.key).join('-')}`.replace(/[^a-zA-Z0-9-]/g, '-');

/** One metric, one chart. The shape this screen had before combining existed. */
function singleCard(cfg, type, m, rows, avg, width, hourly) {
  const id = `${type.id}.${m.key}`;
  const data = rows.map((r) => ({ ...r, value: metricValue(m, r.custom[id]) }));
  if (!data.some((r) => r.value > 0)) return '';

  const mean = avg.custom[id] || 0;
  const duration = m.kind === 'duration' && m.agg !== 'count';
  const asHours = asHoursScale([m], Math.max(...data.map((r) => r.value)));
  const scaled = asHours ? data.map((r) => ({ ...r, value: r.value / 60 })) : data;
  const unit = asHours ? 'h' : (m.kind === 'count' || m.kind === 'toggle' ? '' : m.unit);
  const vizId = cardId(type, [m]);

  return chartCard({
    id: vizId,
    title: `${type.emoji} ${m.kind === 'count' ? type.label : m.label} per ${xLabel(hourly)}`,
    subtitle: summaryLine(type, m, hourly),
    svg: columnChart({
      rows: scaled,
      width,
      unit,
      title: m.label,
      decimals: asHours ? 1 : 0,
      avg: hourly ? null : (asHours ? mean / 60 : mean),
      avgDecimals: 1,
    }),
    table: tableTwin({
      id: vizId,
      rows: data,
      columns: [{
        label: duration ? 'Time' : (m.unit || 'Count'),
        get: (r) => (duration
          ? (r.value ? fmtMinutes(Math.round(r.value)) : '—')
          : Math.round(r.value * 100) / 100),
      }],
    }),
  });
}

/**
 * Two metrics on one chart, side by side.
 *
 * Grouped rather than stacked, which is the same choice the diaper and nursing
 * charts made. Stacking asserts that the two add up to something - fine for
 * left and right minutes at the breast, wrong for a high and a low temperature,
 * and this code cannot tell which pair it has been handed. Side by side asserts
 * only that they are comparable, which is exactly what sharing a unit and an
 * aggregation guarantees.
 *
 * No average line: it belongs to one series, and drawn across two it would
 * silently pick one and look like it described both.
 */
function pairCard(cfg, type, pair, rows, avg, width, hourly) {
  const ids = pair.map((m) => `${type.id}.${m.key}`);
  const values = (r) => Object.fromEntries(
    pair.map((m, k) => [m.key, metricValue(m, r.custom[ids[k]])]),
  );
  const raw = rows.map((r) => ({ ...r, values: values(r) }));
  if (!raw.some((r) => pair.some((m) => r.values[m.key] > 0))) return '';

  const peak = Math.max(...raw.flatMap((r) => pair.map((m) => r.values[m.key])));
  const asHours = asHoursScale(pair, peak);
  const data = asHours
    ? raw.map((r) => ({
      ...r,
      values: Object.fromEntries(pair.map((m) => [m.key, r.values[m.key] / 60])),
    }))
    : raw;

  const duration = pair.every((m) => m.kind === 'duration' && m.agg !== 'count');
  const unit = asHours ? 'h' : (pair[0].kind === 'count' || pair[0].kind === 'toggle' ? '' : pair[0].unit);
  const series = pair.map((m, k) => ({ key: m.key, label: labelOf(type, m), slot: `s${k + 1}` }));
  const vizId = cardId(type, pair);

  // Both halves share an aggregation by construction, so one sentence covers
  // the pair - and it is the pair's sentence, not the first one's.
  const how = pair[0].agg === 'count'
    ? 'Counted per'
    : { sum: 'Added up over the', avg: "Average of the", last: 'The last one recorded each' }[pair[0].agg];
  const tail = pair[0].agg === 'count'
    ? `${xLabel(hourly)}`
    : `${xLabel(hourly)}${pair[0].unit ? ` · ${pair[0].unit}` : ''}`;

  return chartCard({
    id: vizId,
    title: `${type.emoji} ${pair.map((m) => labelOf(type, m)).join(' and ')} per ${xLabel(hourly)}`,
    subtitle: `${how} ${tail}`,
    legendHTML: legend(series),
    svg: groupedColumnChart({
      rows: data,
      series,
      width,
      unit,
      title: pair.map((m) => labelOf(type, m)).join(' and '),
      decimals: asHours ? 1 : 0,
    }),
    table: tableTwin({
      id: vizId,
      rows: raw,
      columns: pair.map((m) => ({
        label: `${labelOf(type, m)}${m.unit && !duration ? ` (${m.unit})` : ''}`,
        get: (r) => (duration
          ? (r.values[m.key] ? fmtMinutes(Math.round(r.values[m.key])) : '—')
          : Math.round(r.values[m.key] * 100) / 100),
      })),
    }),
  });
}

/**
 * The charts for buttons of your own.
 *
 * Built from each button's own fields, so a "Tummy time" button with a duration
 * on it gets minutes a day and a "Weight" button with a number gets its own
 * column chart, with no chart code written for either. A metric with nothing in
 * the range draws nothing rather than a row of zeros.
 */
function customCharts(cfg, rows, avg, width, hourly) {
  const cards = customChartTypes(cfg).flatMap(({ type, metrics }) =>
    chartGroups(cfg, type, metrics).map((group) => (group.length > 1
      ? pairCard(cfg, type, group, rows, avg, width, hourly)
      : singleCard(cfg, type, group[0], rows, avg, width, hourly))))
    .filter(Boolean).join('');

  if (!cards) return '';
  return `<div class="section-title">Your own buttons</div>
    <p class="small muted" style="margin:-4px 4px 10px">
      Drawn from the fields each button records. Choose which of them appear —
      and whether they share a chart — in Setup → Statistics.
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
