/**
 * The printable report: several charts, chosen by hand, in one file.
 *
 * WHAT THIS IS FOR. The Statistics screen answers "how are we doing" on a phone
 * at three in the morning. A report answers a different question — "what do I
 * show the pediatrician on Thursday" — and the difference is not cosmetic. That
 * conversation wants a fixed range rather than whatever the screen was last set
 * to, only the charts that bear on the reason for the visit, the notation the
 * clinic reads in rather than the one the household types in, and something
 * that survives being printed and handed over.
 *
 * SO IT IS ONE HTML FILE, NOT A PDF AND NOT A FOLDER OF IMAGES.
 *
 * A PDF would need a library, and every one of them is larger than this whole
 * application. A folder of PNGs loses every number the moment it leaves the
 * screen — a chart's table twin is the part a clinician actually reads off.
 * One self-contained HTML file keeps the charts as vectors, so it prints at the
 * printer's resolution rather than the phone's; keeps every figure as text, so
 * it can be searched, copied and read aloud by a screen reader; opens in
 * anything; and prints from the browser that opened it. There is no network
 * request in it and no script that does anything but open and close sections.
 *
 * EVERY CHART EXPANDS, AND SO DOES ITS DATA.
 *
 * Two levels of `<details>`: the chart itself, and the table underneath it. A
 * report with nine charts in it is unreadable as a wall; a report where the one
 * you are discussing is open and the rest are one line each is a document you
 * can hold. Printing opens every one of them first — see the `beforeprint`
 * listener at the foot of the generated file — because a collapsed section on
 * paper is a section that did not print.
 *
 * THE CHARTS ARE THE SCREEN'S OWN.
 *
 * `chartSections()` in stats.js is the single list both this and the Statistics
 * screen render from, so a chart added there is offered here without anybody
 * remembering to add it, and the two can never disagree about what a chart
 * says. This file re-renders that list against its own range and its own unit
 * system, then strips the on-screen furniture — the Table toggle, the download
 * button — that a file on disk has nothing to do with.
 */

import { state, config, currentBaby, openSheet, closeSheet, toast } from './core.js';
import { api, saveFile } from './api.js';
import * as sound from './sound.js';
import { esc, babyAge } from './util.js';
import { UNIT_SYSTEMS, unitSystem } from './units.js';
import { analyse, chartSections, summaryCard, STATS_RANGES } from './stats.js';
import { slug } from './charts.js';

/**
 * Charts are laid out for a sheet of paper rather than for the phone that
 * built them.
 *
 * The SVG scales to its container either way — this only fixes the aspect
 * ratio, and a chart drawn at phone width and blown up to A4 comes out with
 * hair-thin gridlines and enormous gaps between columns.
 */
const REPORT_WIDTH = 760;

/** What the sheet is currently set to. Module-level so a repaint keeps it. */
let draft = null;

/* ------------------------------------------------------------------ sheet */

/**
 * Pick a range, a notation and the charts, then generate.
 *
 * The chart list depends on the range: a button used twice in March has a chart
 * over 90 days and none over 7, and offering a tick box for a chart that will
 * come out blank is worse than not offering it. So changing the range refetches
 * and relists, and the list says it is doing so rather than going quiet.
 */
export function openReportSheet() {
  const cfg = config();
  const baby = currentBaby();
  if (!baby) {
    return toast({ icon: '📋', text: 'Add a baby first', tone: 'peach' });
  }

  draft = {
    days: state.statsDays,
    units: unitSystem(cfg),
    // `null` means "everything this range offers, as the screen has it set".
    // A real Set only appears once somebody unticks something, so a range
    // change does not have to reconcile a stale selection against a new list.
    ids: null,
    summary: true,
    tables: true,
    // Everything one pass over the range produced: the charts, and the figures
    // the summary card is built from. Kept together because they have to agree
    // - a summary computed from a different pass than the charts under it is
    // the one kind of wrong a reader cannot see.
    data: null,
    loading: true,
    error: null,
  };

  openSheet(sheetHTML(baby), (sheet) => {
    const repaint = () => {
      const box = sheet.querySelector('[data-report-charts]');
      if (box) box.innerHTML = chartListHTML();
      const go = sheet.querySelector('[data-generate]');
      if (go) go.disabled = draft.loading || !!draft.error;
    };

    const reload = async () => {
      draft.loading = true;
      draft.error = null;
      draft.data = null;
      repaint();
      try {
        draft.data = await readRange(cfg, baby, draft.days, draft.units);
      } catch (err) {
        draft.error = err.message;
      }
      draft.loading = false;
      repaint();
    };

    sheet.addEventListener('click', async (ev) => {
      const seg = ev.target.closest('[data-report-seg]');
      if (seg) {
        const group = seg.dataset.reportSeg;
        draft[group] = group === 'days' ? Number(seg.dataset.value) : seg.dataset.value;
        sheet.querySelectorAll(`[data-report-seg="${group}"]`).forEach((b) =>
          b.setAttribute('aria-pressed', String(b === seg)));
        // Both of them change what the charts are, not just how they read: a
        // longer range can add one, and the notation is baked into every axis.
        draft.ids = null;
        await reload();
        return;
      }

      if (ev.target.closest('[data-cancel]')) {
        closeSheet();
        return;
      }

      const all = ev.target.closest('[data-report-all]');
      if (all) {
        const want = all.dataset.reportAll === 'on';
        draft.ids = want ? null : new Set();
        repaint();
        return;
      }

      const go = ev.target.closest('[data-generate]');
      if (go) {
        closeSheet();
        await generate(baby);
      }
    });

    sheet.addEventListener('change', (ev) => {
      const box = ev.target.closest('[data-report-id]');
      if (box) {
        if (!draft.ids) draft.ids = new Set(draft.data.sections.map((x) => x.id));
        if (box.checked) draft.ids.add(box.dataset.reportId);
        else draft.ids.delete(box.dataset.reportId);
        // Only the counter and the tick that changed need redrawing, and
        // repainting the list here would fight the checkbox that fired this.
        const count = sheet.querySelector('[data-report-count]');
        if (count) count.textContent = countLine();
        return;
      }
      const opt = ev.target.closest('[data-report-opt]');
      if (opt) draft[opt.dataset.reportOpt] = opt.checked;
    });

    reload();
  });
  return undefined;
}

function sheetHTML(baby) {
  return `
    <h3>📋 Report for ${esc(baby.name)}</h3>
    <p class="small muted" style="margin:-6px 0 14px">
      One file with the charts you pick in it, each one expandable and each
      carrying its own table. Made to be printed or handed over.
    </p>

    <label class="field"><span class="lab">Range</span>
      <div class="seg">
        ${STATS_RANGES.map((d) => `
          <button type="button" data-report-seg="days" data-value="${d}"
            aria-pressed="${d === draft.days}">${d}d</button>`).join('')}
      </div>
    </label>

    <label class="field"><span class="lab">Measurements</span>
      <div class="seg">
        ${UNIT_SYSTEMS.map((u) => `
          <button type="button" data-report-seg="units" data-value="${u.value}"
            aria-pressed="${u.value === draft.units}">${esc(u.label)}</button>`).join('')}
      </div>
      <span class="small muted">The report is written in this whichever way the
      app is set — for a clinic that reads in the other one. Nothing logged
      changes.</span>
    </label>

    <div class="section-title" style="margin:16px 0 8px;font-size:0.8rem">Include</div>
    <div data-report-charts></div>

    <div class="section-title" style="margin:16px 0 4px;font-size:0.74rem">As well as the charts</div>
    <label class="switch">
      <input type="checkbox" data-report-opt="summary" ${draft.summary ? 'checked' : ''}>
      <span class="track"></span>
      <span class="txt"><b>Summary figures</b>
        <span class="small muted">The tiles from the top of Stats, at the head of
        the report</span></span>
    </label>
    <label class="switch">
      <input type="checkbox" data-report-opt="tables" ${draft.tables ? 'checked' : ''}>
      <span class="track"></span>
      <span class="txt"><b>Data tables</b>
        <span class="small muted">Every value under its own chart, expandable.
        Leave on unless you want the pictures alone</span></span>
    </label>

    <div class="sheet-actions">
      <button class="btn" type="button" data-cancel>Cancel</button>
      <button class="btn primary" type="button" data-generate disabled>Generate</button>
    </div>`;
}

/** How many charts are ticked, said in words rather than left to be counted. */
function countLine() {
  const total = draft.data?.sections.length || 0;
  const picked = draft.ids ? draft.ids.size : total;
  if (!total) return 'No charts have anything in this range.';
  return `${picked} of ${total} chart${total === 1 ? '' : 's'}`;
}

function chartListHTML() {
  if (draft.loading) return '<p class="small muted">Reading the log…</p>';
  if (draft.error) return `<p class="small muted">⚠️ ${esc(draft.error)}</p>`;
  if (!draft.data.sections.length) {
    return `<p class="small muted">Nothing was logged in this range, so there is
      no chart to put in a report. Try a longer one.</p>`;
  }

  const ticked = (id) => (draft.ids ? draft.ids.has(id) : true);
  let group = null;
  const rows = draft.data.sections.map((x) => {
    const head = x.group === group
      ? ''
      : `<div class="section-title" style="margin:10px 0 4px;font-size:0.74rem">${esc(x.group || 'Charts')}</div>`;
    group = x.group;
    return `${head}
      <label class="switch">
        <input type="checkbox" data-report-id="${esc(x.id)}" ${ticked(x.id) ? 'checked' : ''}>
        <span class="track"></span>
        <span class="txt"><b>${esc(x.label)}</b></span>
      </label>`;
  }).join('');

  return `
    <div class="row" style="margin-bottom:6px">
      <span class="small muted grow" data-report-count>${esc(countLine())}</span>
      <button type="button" class="btn sm" data-report-all="on">All</button>
      <button type="button" class="btn sm" data-report-all="off">None</button>
    </div>
    ${rows}`;
}

/* --------------------------------------------------------------- building */

/**
 * The charts for a range and a notation, whatever the app is currently set to.
 *
 * The config is cloned with `settings.units` overridden rather than the real
 * one being changed and changed back. A report is not a mode: generating one in
 * pounds must not leave the app in pounds, and must not flicker every screen
 * behind the sheet on its way through.
 */
async function readRange(cfg, baby, days, units) {
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  since.setDate(since.getDate() - (days - 1));

  const { events } = await api.events({
    babyId: state.babyId || 'all',
    since: since.toISOString(),
    limit: 20000,
  });

  const asked = { ...cfg, settings: { ...(cfg.settings || {}), units } };
  const { rows, avg, sum } = analyse(asked, events, days, REPORT_WIDTH);
  const sections = chartSections(asked, {
    rows, avg, sum, events, days, baby, width: REPORT_WIDTH,
  });
  return { asked, rows, avg, sum, sections };
}

async function generate(baby) {
  const { days, units, summary, tables, data } = draft;
  const picked = data.sections.filter((x) => (draft.ids ? draft.ids.has(x.id) : true));
  if (!picked.length && !summary) {
    return toast({ icon: '📋', text: 'Pick at least one chart', tone: 'peach' });
  }

  try {
    const { asked, rows, avg, sum } = data;
    const html = reportHTML({
      baby, days, units, sections: picked, tables,
      summary: summary ? summaryCard(asked, { rows, avg, sum, baby, hourly: days === 1 }) : '',
    });
    const name = `report-${slug(baby.name)}-${new Date().toISOString().slice(0, 10)}.html`;
    await saveFile(new Blob([html], { type: 'text/html;charset=utf-8' }), name);
    sound.play('success');
    toast({ icon: '📋', text: `<b>${esc(name)}</b> saved`, tone: 'mint', ms: 5000 });
  } catch (err) {
    sound.play('error');
    toast({ icon: '⚠️', text: `Could not build the report: ${err.message}`, tone: 'peach', ms: 7000 });
  }
  return undefined;
}

/* ------------------------------------------------------- the document itself */

/**
 * One chart, assembled for a page rather than for a screen.
 *
 * Built from the same `parts` the Statistics screen hands to `chartCard` — the
 * title, the plot, the note and the table twin — rather than from that card's
 * finished markup. The alternative was to parse the card back apart and throw
 * away its Table toggle and its download button, which would have made this
 * file depend on class names three modules away and would have needed a live
 * DOM to do it in.
 *
 * The table keeps its `hidden` attribute: on the screen that is what the Table
 * button toggles, and here the report's own stylesheet simply overrides it,
 * which is one line of CSS against a string rewrite that could go wrong.
 */
function chartBlock(section, withTable) {
  const p = section.parts;
  const sub = stripTags(p.subtitle || '');
  const table = withTable && p.table
    ? `<details class="rep-data">
        <summary>Every value · ${bodyRows(p.table)} row${bodyRows(p.table) === 1 ? '' : 's'}</summary>
        ${p.table}
      </details>`
    : '';

  return `<details class="rep-chart" open>
    <summary><b>${esc(p.title)}</b>${sub ? `<span class="rep-sub">${esc(sub)}</span>` : ''}</summary>
    <div class="rep-body">
      ${p.legendHTML || ''}
      <div class="viz-plot">${p.svg}</div>
      ${p.note ? `<p class="rep-note">${p.note}</p>` : ''}
      ${table}
    </div>
  </details>`;
}

/**
 * How many rows a table twin has.
 *
 * Counted off the one marker `tableTwin` puts at the head of every body row and
 * nowhere else. A count is worth having on the summary line — "Every value" on
 * a closed section says nothing about whether opening it is worth the paper.
 */
function bodyRows(table) {
  return (String(table).match(/<tr><th scope="row">/g) || []).length;
}

/** Subtitles carry a little markup; a summary line wants plain text. */
function stripTags(html) {
  return String(html).replace(/<[^>]*>/g, '');
}

/** "24 Aug – 6 Sep 2026", or just the day when the range is one. */
function rangeLine(days) {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - (days - 1));
  const fmt = (d) => d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
  return days === 1 ? fmt(to) : `${fmt(from)} – ${fmt(to)}`;
}

function reportHTML({ baby, days, units, sections, summary, tables }) {
  const system = UNIT_SYSTEMS.find((u) => u.value === units);
  const age = babyAge(baby.birthDate);
  const title = `${baby.name} — tracker report`;

  let group = null;
  const body = sections.map((x) => {
    const head = x.group === group && group !== null
      ? ''
      : (x.group ? `<h2 class="rep-group">${esc(x.group)}</h2>` : '');
    group = x.group;
    return head + chartBlock(x, tables);
  }).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${REPORT_CSS}</style>
</head>
<body>
<header class="rep-head">
  <h1>${esc(baby.emoji || '👶')} ${esc(title)}</h1>
  <p class="rep-meta">
    <span><b>${esc(rangeLine(days))}</b></span>
    <span>${days === 1 ? 'Today, hour by hour' : `Last ${days} days`}</span>
    ${age ? `<span>${esc(age)}</span>` : ''}
    <span>${esc(system?.label || units)} · ${esc(system?.hint || '')}</span>
    <span>Generated ${esc(new Date().toLocaleString())}</span>
  </p>
</header>

<div class="rep-tools no-print">
  <button type="button" onclick="window.print()">🖨️ Print</button>
  <button type="button" data-open="1">Expand all</button>
  <button type="button" data-open="0">Collapse all</button>
  <span class="rep-hint">Every chart opens and closes. Printing opens them all first.</span>
</div>

${summary ? `<section class="rep-summary"><h2 class="rep-group">Summary</h2>${summary}</section>` : ''}
${body || '<p class="rep-empty">No charts were selected.</p>'}

<footer class="rep-foot">
  <p><b>What this is.</b> A description of what was logged for ${esc(baby.name)}
  over ${esc(rangeLine(days))}, and nothing more. It is not a diagnosis, and a
  reference line on a chart is a description of well-fed babies rather than a
  target to hit. Anything that worries you is a phone call, not a chart.</p>
  <p><b>What is missing.</b> Only what was recorded can be counted. Feeds logged
  without a volume, naps nobody timed and days the app was not opened are absent
  here, so treat every total as a floor rather than the whole story.</p>
  <p class="rep-src">Ultimate Baby Tracker · this file is self-contained: no
  network, no tracking, nothing outside it.</p>
</footer>

<script>
/* The only script in the file: opening and closing sections, and making sure a
   collapsed one is never what comes out of the printer. */
(function () {
  var all = function () { return document.querySelectorAll('details'); };
  document.querySelectorAll('[data-open]').forEach(function (b) {
    b.addEventListener('click', function () {
      var want = b.getAttribute('data-open') === '1';
      all().forEach(function (d) { d.open = want; });
    });
  });
  /* Remember what was open, open everything, then put it back — otherwise
     printing silently rearranges the page you were reading. */
  var was = null;
  window.addEventListener('beforeprint', function () {
    was = [].map.call(all(), function (d) { return d.open; });
    all().forEach(function (d) { d.open = true; });
  });
  window.addEventListener('afterprint', function () {
    if (!was) return;
    all().forEach(function (d, i) { d.open = was[i]; });
    was = null;
  });
}());
</script>
</body>
</html>`;
}

/**
 * The report's own stylesheet.
 *
 * The chart class names are the application's, so the same rules that paint a
 * chart on screen paint it here and the two cannot drift apart in colour. What
 * changes is the ground: this is a document, so it is light whatever the reader
 * has their system set to. A report is printed, mailed and put in a folder, and
 * a dark one wastes a cartridge and reads as a screenshot rather than a page.
 */
const REPORT_CSS = `
:root {
  --ink: #1b1b1f; --muted: #5f6068; --line: #dcdce3;
  --surface: #ffffff; --surface-2: #f5f5f8; --text: #1b1b1f;
  --viz-1: #2a78d6; --viz-2: #eb6834;
  color-scheme: light;
}
* { box-sizing: border-box; }
body {
  margin: 0 auto; padding: 24px 20px 60px; max-width: 900px;
  background: var(--surface); color: var(--ink);
  font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
h1 { font-size: 1.5rem; margin: 0 0 6px; }
.rep-group { font-size: 0.78rem; text-transform: uppercase; letter-spacing: .06em;
  color: var(--muted); margin: 26px 0 8px; }
.rep-head { border-bottom: 2px solid var(--ink); padding-bottom: 12px; margin-bottom: 6px; }
.rep-meta { display: flex; flex-wrap: wrap; gap: 4px 16px; margin: 0;
  font-size: 0.82rem; color: var(--muted); }

.rep-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 14px 0 4px; }
.rep-tools button {
  font: inherit; font-size: 0.82rem; font-weight: 700; cursor: pointer;
  padding: 7px 12px; border-radius: 9px; border: 1px solid var(--line);
  background: var(--surface-2); color: var(--ink);
}
.rep-tools button:hover { border-color: var(--muted); }
.rep-hint { font-size: 0.78rem; color: var(--muted); }

/* One chart, collapsible, and never split across two sheets of paper. */
.rep-chart, .rep-summary {
  border: 1px solid var(--line); border-radius: 12px;
  margin: 10px 0; padding: 10px 14px; background: var(--surface);
  break-inside: avoid; page-break-inside: avoid;
}
.rep-summary { padding-top: 2px; }
.rep-summary .rep-group { margin-top: 10px; }
/* display:block on a summary removes the disclosure marker the browser
   would otherwise draw, so the triangle is drawn here instead. Without one,
   nothing on a collapsed report says the rows are openable at all. */
.rep-chart > summary {
  cursor: pointer; font-size: 1rem; padding: 4px 0 4px 20px;
  display: block; position: relative; list-style: none;
}
.rep-chart > summary::-webkit-details-marker { display: none; }
.rep-chart > summary::before {
  content: '▸'; position: absolute; left: 2px; top: 4px;
  color: var(--muted); transition: transform .12s ease;
}
.rep-chart[open] > summary::before { transform: rotate(90deg); }
.rep-chart > summary b { font-size: 1.02rem; }
.rep-sub { display: block; font-weight: 400; font-size: 0.82rem; color: var(--muted); }
.rep-body { padding-top: 4px; }
.rep-data { margin-top: 10px; border-top: 1px solid var(--line); padding-top: 8px; }
.rep-data > summary { cursor: pointer; font-size: 0.8rem; font-weight: 700; color: var(--muted); }
/* The table twin is emitted with a hidden attribute, which is what the screen's
   Table button toggles. Here the enclosing details element is the toggle, so
   the attribute is overridden rather than stripped out of the markup. */
.rep-data .viz-table[hidden] { display: block; }
.rep-note { font-size: 0.82rem; color: var(--muted); margin: 8px 0 0; }
.rep-empty { color: var(--muted); }

.rep-foot { margin-top: 32px; border-top: 1px solid var(--line); padding-top: 12px;
  font-size: 0.8rem; color: var(--muted); break-inside: avoid; }
.rep-foot p { margin: 0 0 8px; }
.rep-src { font-size: 0.74rem; }

/* Straight from the app's stylesheet, so a chart reads identically here. */
.viz-plot { margin: 4px 0 0; }
.viz { display: block; overflow: visible; width: 100%; height: auto; }
.viz-grid { stroke: var(--line); stroke-width: 1; }
.viz-tick { fill: var(--muted); font-size: 10px; font-weight: 700; font-variant-numeric: tabular-nums; }
.viz-value { fill: var(--text); font-size: 11px; font-weight: 800; }
.viz-ref { stroke: var(--muted); stroke-width: 1; opacity: 0.75; }
.viz-ref-bg { fill: var(--surface); opacity: 0.88; }
.viz-ref-label { fill: var(--muted); font-size: 10px; font-weight: 700; }
.viz-mark.s1, .viz-dot-mark.s1 { fill: var(--viz-1); }
.viz-mark.s2, .viz-dot-mark.s2 { fill: var(--viz-2); }
.viz-line { fill: none; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
.viz-line.s1 { stroke: var(--viz-1); }
.viz-line.s2 { stroke: var(--viz-2); }
.viz-hit { fill: transparent; }
.viz-legend { display: flex; flex-wrap: wrap; gap: 6px 18px; margin: 2px 0 8px; }
.viz-key { display: inline-flex; align-items: center; gap: 6px; font-size: 0.8rem;
  font-weight: 700; color: var(--muted); }
.viz-dot { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
.viz-dot.s1 { background: var(--viz-1); }
.viz-dot.s2 { background: var(--viz-2); }
.viz-table table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
.viz-table th, .viz-table td {
  padding: 5px 8px; text-align: right; border-bottom: 1px solid var(--line);
  font-variant-numeric: tabular-nums;
}
.viz-table thead th { color: var(--muted); font-size: 0.74rem;
  text-transform: uppercase; letter-spacing: .04em; }
.viz-table th[scope='row'], .viz-table thead th:first-child { text-align: left; }
.viz-table th[scope='row'] { font-weight: 700; white-space: nowrap; }

/* The summary tiles, which the app lays out as a grid of cards. */
.stat-grid, .stat-grid.kpi { display: grid; gap: 8px;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); }
.stat { border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px;
  background: var(--surface-2); }
.stat .v { font-size: 1.3rem; font-weight: 800; line-height: 1.2; }
.stat .k { font-size: 0.76rem; color: var(--muted); font-weight: 700; }
.small { font-size: 0.8rem; }
.muted { color: var(--muted); }
.card { padding: 0; }

@media print {
  @page { margin: 14mm; }
  body { max-width: none; padding: 0; font-size: 11pt; }
  .no-print { display: none !important; }
  /* There is deliberately no CSS here forcing a shut section open.
     It cannot be done: a closed details element hides its contents through the
     browser's own shadow DOM, and neither display nor content-visibility on
     the light-DOM children reaches it — tried, and it silently prints a report
     of empty headings. The beforeprint listener at the foot of the file is the
     mechanism, and it is a reliable one: every browser fires beforeprint for
     both Ctrl-P and window.print(). */
  .rep-chart, .rep-summary { border-color: #bbb; }
  /* On paper every section is open, so a triangle claiming otherwise is
     noise. */
  .rep-chart > summary::before { display: none; }
  .rep-chart > summary { padding-left: 0; }
  .rep-data > summary::marker { content: ''; }
  a[href]::after { content: ''; }
}
`;
