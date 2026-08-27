/**
 * Small SVG chart builders — no libraries, no canvas.
 *
 * House rules, applied everywhere here so the charts read as one set:
 *   · thin columns (max 24px) with a 4px rounded cap and a square baseline;
 *   · a 2px gap in the surface colour between touching marks, never a stroke;
 *   · solid hairline gridlines one step off the surface, never dashed;
 *   · one y-axis, never two — two measures mean two charts;
 *   · labels selectively (the peak, the average line), the rest in the tooltip
 *     and the table twin that every chart card carries.
 *
 * Series colours come from --viz-1 / --viz-2 in the stylesheet, which are
 * stepped separately for light and dark and validated for colour-vision
 * deficiency; they are deliberately not the pastel nursery tones, which are far
 * too pale to read as data.
 */

import { esc } from './util.js';

const PAD = { top: 16, right: 10, bottom: 26, left: 38 };
const MAX_BAR = 24;
const GAP = 2;          // the surface gap between touching marks
const CAP = 4;          // rounded data-end

/**
 * The smallest round number at or above `value`. The ladder is fine enough that
 * a 780-cc day tops out at 800 rather than 1,000 - a ceiling twice the tallest
 * bar wastes half the plot and flattens the very differences it is there to show.
 */
const LADDER = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

export function niceMax(value) {
  if (!(value > 0)) return 1;
  const pow = 10 ** Math.floor(Math.log10(value));
  const n = value / pow;
  return (LADDER.find((x) => n <= x + 1e-9) ?? 10) * pow;
}

/**
 * How many gridlines. A count axis wants whole numbers on its ticks - 0/1/2/3
 * beats 0/0.75/1.5/2.25 every time - so an integer ceiling looks for a divisor
 * that gives one. Otherwise settle for a step that is round at the axis's own
 * scale (0.2 rather than 0.25 when the ceiling is 1).
 */
function tickCount(max) {
  if (Number.isInteger(max) && max <= 12) {
    for (const c of [5, 4, 3, 2]) if (max % c === 0) return c;
    // A ceiling of 1 divides by nothing; unit steps are the only sane answer.
    if (max <= 6) return max;
  }
  for (const c of [4, 5]) {
    const step = max / c;
    const scale = 10 ** Math.floor(Math.log10(step));
    if (Math.abs(step / scale - Math.round(step / scale)) < 1e-9) return c;
  }
  return 4;
}

function ticks(max, count = tickCount(max)) {
  return Array.from({ length: count + 1 }, (_, i) => (max / count) * i);
}

export function fmtTick(v) {
  if (v >= 10000) return `${Math.round(v / 1000)}k`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return String(Math.round(v * 100) / 100);
}

/**
 * A column with a rounded top and a square foot: the data-end is the only part
 * that gets a radius, so the mark still reads as anchored to the baseline.
 */
function columnPath(x, y, w, h) {
  const r = Math.min(CAP, w / 2, h);
  if (h <= 0.5) return '';
  return `M${x} ${y + h}V${y + r}a${r} ${r} 0 0 1 ${r} -${r}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}V${y + h}Z`;
}

function axis(max, w, h) {
  return ticks(max).map((t) => {
    const y = PAD.top + h - (t / max) * h;
    return `<line class="viz-grid" x1="${PAD.left}" y1="${y.toFixed(1)}" x2="${(PAD.left + w).toFixed(1)}" y2="${y.toFixed(1)}"></line>
      <text class="viz-tick" x="${PAD.left - 6}" y="${(y + 3.5).toFixed(1)}" text-anchor="end">${esc(fmtTick(t))}</text>`;
  }).join('');
}

/**
 * `role="group"` rather than `role="img"`: the bands inside are focusable and
 * individually labelled, and an img role would hide them from assistive tech.
 * The table twin on every card is the tabular path to the same numbers.
 */
function frame(width, height, title, inner) {
  return `<svg class="viz" viewBox="0 0 ${width} ${height}" width="100%" height="${height}"
    role="group" aria-label="${esc(title)}" preserveAspectRatio="xMidYMid meet">${inner}</svg>`;
}

/**
 * One measure over an ordered set of bands (days, hours).
 *
 * `rows`: [{ label, full, value }]. `avg` draws a reference line, `unit` rides
 * the tooltip, and the tallest column is direct-labelled — the one value worth
 * naming without flooding the plot.
 */
export function columnChart({
  rows, width = 640, height = 190, unit = '', title = '', avg = null, decimals = 0,
  // A count axis wants whole bars but a mean of 7.5 feeds; let them differ.
  avgDecimals = null, refs = [],
}) {
  if (!rows.length) return '';
  const w = width - PAD.left - PAD.right;
  const h = height - PAD.top - PAD.bottom;
  const lines = [
    ...(avg > 0 ? [{ value: avg, label: `avg ${avg.toFixed(avgDecimals ?? decimals)}` }] : []),
    ...refs.filter((r) => r.value > 0),
  ];
  const max = niceMax(Math.max(...rows.map((r) => r.value), ...lines.map((l) => l.value)));
  const band = w / rows.length;
  const barW = Math.min(MAX_BAR, Math.max(3, band - GAP - Math.min(10, band * 0.25)));
  const peak = rows.reduce((best, r, i) => (r.value > rows[best].value ? i : best), 0);
  const showEvery = Math.ceil(rows.length / 8);

  const marks = rows.map((r, i) => {
    const x = PAD.left + band * i + (band - barW) / 2;
    const barH = max ? (r.value / max) * h : 0;
    const y = PAD.top + h - barH;
    const tip = `${r.full || r.label}: ${r.value.toFixed(decimals)}${unit ? ` ${unit}` : ''}`;
    const label = i === peak && r.value > 0
      ? `<text class="viz-value" x="${(x + barW / 2).toFixed(1)}" y="${(y - 5).toFixed(1)}" text-anchor="middle">${esc(r.value.toFixed(decimals))}</text>`
      : '';
    const tick = i % showEvery === 0
      ? `<text class="viz-tick" x="${(x + barW / 2).toFixed(1)}" y="${height - 8}" text-anchor="middle">${esc(r.label)}</text>`
      : '';
    return `<g class="viz-band" tabindex="0" role="img" aria-label="${esc(tip)}" data-tip="${esc(tip)}">
      <rect class="viz-hit" x="${(PAD.left + band * i).toFixed(1)}" y="${PAD.top}" width="${band.toFixed(1)}" height="${h}"></rect>
      <path class="viz-mark s1" d="${columnPath(x, y, barW, barH)}"></path>
      ${label}${tick}</g>`;
  }).join('');

  /*
   * Reference lines run *under* the marks, so the bars stay the loudest thing on
   * the plot; their labels go on top, in the left gutter on a patch of surface,
   * so they stay readable wherever the tall bars happen to fall. Labels are
   * nudged apart when two lines land close together.
   */
  const placed = [];
  const drawn = lines
    .filter((l) => l.value <= max)
    .map((l) => {
      const y = PAD.top + h - (l.value / max) * h;
      let labelY = y - 4;
      while (placed.some((p) => Math.abs(p - labelY) < 13)) labelY -= 13;
      placed.push(labelY);
      return { ...l, y, labelY };
    });

  const refLines = drawn.map((l) => `<line class="viz-ref"
    x1="${PAD.left}" y1="${l.y.toFixed(1)}" x2="${PAD.left + w}" y2="${l.y.toFixed(1)}"></line>`).join('');

  const refLabels = drawn.map((l) => `
    <rect class="viz-ref-bg" x="${PAD.left + 2}" y="${(l.labelY - 10).toFixed(1)}"
      width="${l.label.length * 6 + 8}" height="13" rx="4"></rect>
    <text class="viz-ref-label" x="${PAD.left + 6}" y="${l.labelY.toFixed(1)}">${esc(l.label)}</text>`).join('');

  return frame(width, height, title, `${axis(max, w, h)}${refLines}${marks}${refLabels}`);
}

/**
 * Two or three measures side by side per band. Identity is carried by the
 * legend the card draws above the plot, never by colour alone.
 */
export function groupedColumnChart({
  rows, series, width = 640, height = 190, unit = '', title = '', decimals = 0,
}) {
  if (!rows.length || !series.length) return '';
  const w = width - PAD.left - PAD.right;
  const h = height - PAD.top - PAD.bottom;
  const max = niceMax(Math.max(1, ...rows.flatMap((r) => series.map((s) => r.values[s.key] || 0))));
  const band = w / rows.length;
  const inner = Math.min(band - 8, MAX_BAR * series.length + GAP * (series.length - 1));
  const barW = Math.max(3, (inner - GAP * (series.length - 1)) / series.length);
  const showEvery = Math.ceil(rows.length / 8);

  const marks = rows.map((r, i) => {
    const left = PAD.left + band * i + (band - inner) / 2;
    const bars = series.map((s, k) => {
      const v = r.values[s.key] || 0;
      const barH = (v / max) * h;
      const x = left + k * (barW + GAP);
      const tip = `${r.full || r.label} · ${s.label}: ${v.toFixed(decimals)}${unit ? ` ${unit}` : ''}`;
      return `<g class="viz-band" tabindex="0" role="img" aria-label="${esc(tip)}" data-tip="${esc(tip)}">
        <rect class="viz-hit" x="${(x - GAP / 2).toFixed(1)}" y="${PAD.top}" width="${(barW + GAP).toFixed(1)}" height="${h}"></rect>
        <path class="viz-mark ${s.slot}" d="${columnPath(x, PAD.top + h - barH, barW, barH)}"></path>
      </g>`;
    }).join('');
    const tick = i % showEvery === 0
      ? `<text class="viz-tick" x="${(PAD.left + band * i + band / 2).toFixed(1)}" y="${height - 8}" text-anchor="middle">${esc(r.label)}</text>`
      : '';
    return bars + tick;
  }).join('');

  return frame(width, height, title, `${axis(max, w, h)}${marks}`);
}

/** Swatch + name pairs. Always drawn when a chart carries two or more series. */
export function legend(series) {
  return `<div class="viz-legend">
    ${series.map((s) => `<span class="viz-key"><i class="viz-dot ${s.slot}"></i>${esc(s.label)}</span>`).join('')}
  </div>`;
}

/** The table twin: every chart's values, reachable without seeing colour. */
export function tableTwin({ rows, columns, id }) {
  return `<div class="viz-table" id="${esc(id)}" hidden>
    <table>
      <thead><tr><th scope="col">When</th>${columns.map((c) => `<th scope="col">${esc(c.label)}</th>`).join('')}</tr></thead>
      <tbody>
        ${rows.map((r) => `<tr><th scope="row">${esc(r.full || r.label)}</th>${
          columns.map((c) => `<td>${esc(c.get(r))}</td>`).join('')}</tr>`).join('')}
      </tbody>
    </table>
  </div>`;
}

/**
 * One chart card: title, optional subtitle and legend, the plot, a table
 * toggle, and the table itself. The toggle is delegated, not wired here.
 */
export function chartCard({
  id, title, subtitle = '', svg, legendHTML = '', table = '', note = '',
}) {
  if (!svg) {
    return `<div class="card viz-card"><div class="viz-head"><h3>${esc(title)}</h3></div>
      <p class="small muted" style="margin:8px 0 0">Nothing logged in this range yet.</p></div>`;
  }
  return `<div class="card viz-card" data-chart-card="${esc(id)}" data-chart-title="${esc(title)}"
      data-chart-sub="${esc(stripTags(subtitle))}">
    <div class="viz-head">
      <div class="grow" style="flex:1;min-width:0">
        <h3>${esc(title)}</h3>
        ${subtitle ? `<div class="small muted">${subtitle}</div>` : ''}
      </div>
      <div class="viz-tools">
        <button class="btn sm" data-act="viz-table" data-viz-table="${esc(id)}"
          aria-expanded="false" aria-controls="${esc(id)}">Table</button>
        <button class="icon-btn sm" data-act="viz-download" data-viz-download="${esc(id)}"
          title="Download this chart as an image" aria-label="Download ${esc(title)} as an image">⬇️</button>
      </div>
    </div>
    ${legendHTML}
    <div class="viz-plot">${svg}</div>
    ${note ? `<p class="small muted" style="margin:8px 0 0">${note}</p>` : ''}
    ${table}
  </div>`;
}

/** Subtitles carry a little markup; the exported image wants plain text. */
function stripTags(html) {
  return String(html).replace(/<[^>]*>/g, '');
}

/* --------------------------------------------------------------- download */

/** Properties that actually decide how a mark looks, copied onto the clone. */
const PAINT = [
  'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity',
  'opacity', 'font-family', 'font-size', 'font-weight', 'text-anchor',
];

/**
 * Export one chart as a PNG.
 *
 * The plot is styled entirely by the stylesheet, so a serialised `<svg>` on its
 * own would come out unpainted - every var() and class is gone the moment it
 * leaves the document. The clone therefore carries the *computed* value of each
 * paint property, read element by element from the live chart. Title, subtitle
 * and a footer are drawn onto the canvas afterwards, so the file is readable on
 * its own rather than being an unlabelled rectangle.
 */
export async function downloadChart(root, id, { footer = '' } = {}) {
  const card = root.querySelector(`[data-chart-card="${CSS.escape(id)}"]`);
  const live = card?.querySelector('svg.viz');
  if (!live) return;

  const clone = live.cloneNode(true);
  const from = [live, ...live.querySelectorAll('*')];
  const to = [clone, ...clone.querySelectorAll('*')];
  from.forEach((el, i) => {
    const cs = getComputedStyle(el);
    // A transparent hit rect computes to rgba(0,0,0,0), which serialises and
    // renders correctly - no special case needed for it.
    const decl = PAINT.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(';');
    to[i].setAttribute('style', decl);
    to[i].removeAttribute('class');
    to[i].removeAttribute('tabindex');
  });
  const box = live.viewBox.baseVal;
  const w = box.width || live.clientWidth;
  const h = box.height || live.clientHeight;
  clone.setAttribute('width', w);
  clone.setAttribute('height', h);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

  const styles = getComputedStyle(card);
  const surface = styles.backgroundColor;
  const ink = styles.color;
  const font = styles.fontFamily;
  const title = card.dataset.chartTitle || '';
  const sub = card.dataset.chartSub || '';

  const scale = 2;
  const padX = 18;
  const head = sub ? 54 : 36;
  const foot = footer ? 26 : 10;

  const svgURL = URL.createObjectURL(new Blob(
    [new XMLSerializer().serializeToString(clone)],
    { type: 'image/svg+xml;charset=utf-8' },
  ));

  try {
    const img = await loadImage(svgURL);
    const canvas = document.createElement('canvas');
    canvas.width = (w + padX * 2) * scale;
    canvas.height = (h + head + foot) * scale;
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);

    ctx.fillStyle = surface;
    ctx.fillRect(0, 0, w + padX * 2, h + head + foot);

    ctx.fillStyle = ink;
    ctx.font = `800 15px ${font}`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(title, padX, 22);
    if (sub) {
      ctx.fillStyle = mix(ink, surface);
      ctx.font = `600 11px ${font}`;
      ctx.fillText(sub, padX, 40);
    }

    ctx.drawImage(img, padX, head, w, h);

    if (footer) {
      ctx.fillStyle = mix(ink, surface);
      ctx.font = `600 10px ${font}`;
      ctx.fillText(footer, padX, h + head + 16);
    }

    const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
    saveBlob(blob, `${slug(title)}-${new Date().toISOString().slice(0, 10)}.png`);
  } finally {
    URL.revokeObjectURL(svgURL);
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not render the chart to an image.'));
    img.src = src;
  });
}

/** Halfway between two colours, for the muted text in an exported image. */
function mix(a, b) {
  const nums = (c) => (c.match(/[\d.]+/g) || [0, 0, 0]).slice(0, 3).map(Number);
  const [r1, g1, b1] = nums(a);
  const [r2, g2, b2] = nums(b);
  return `rgb(${Math.round((r1 + r2) / 2)},${Math.round((g1 + g2) / 2)},${Math.round((b1 + b2) / 2)})`;
}

function slug(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'chart';
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * The table toggle. Delegated from app.js's action map, so nothing here has to
 * be re-wired on every render; tooltips come from the shared tips module.
 */
export function toggleTable(root, id) {
  const table = root.querySelector(`#${CSS.escape(id)}`);
  const btn = root.querySelector(`[data-viz-table="${CSS.escape(id)}"]`);
  if (!table || !btn) return;
  const open = table.hasAttribute('hidden');
  table.toggleAttribute('hidden', !open);
  btn.setAttribute('aria-expanded', String(open));
  btn.textContent = open ? 'Hide table' : 'Table';
}
