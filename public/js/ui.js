/** Shared rendering helpers: tones, event summaries, and the field renderer. */

import { esc, fmtMinutes } from './util.js';

export const TONES = ['pink', 'sky', 'mint', 'lemon', 'lavender', 'peach'];

export const GENDER_TEMPLATES = {
  girl: { label: 'Girl', tone: 'pink', emoji: '👶' },
  boy: { label: 'Boy', tone: 'sky', emoji: '👶' },
  surprise: { label: 'Surprise', tone: 'mint', emoji: '🐣' },
};

export const BABY_EMOJI = ['👶', '🍼', '🧸', '🐣', '🐻', '🐰', '🦊', '🐨', '🌸', '⭐', '🌙', '🐧'];
export const PERSON_EMOJI = ['🤱', '🧔', '👩', '👨', '👵', '👴', '🧑‍🍼', '👩‍⚕️', '🧑', '💜'];
export const TYPE_EMOJI = ['🍼', '🤱', '🧷', '💩', '💦', '😴', '🛁', '💊', '🌡️', '⚖️', '📝', '🚼', '🫙', '🧴', '🪥', '🎵', '🚗', '☀️'];

export function toneStyle(tone) {
  return `--tone: var(--${TONES.includes(tone) ? tone : 'pink'});`;
}

export const byId = (list, id) => (list || []).find((x) => x.id === id) || null;

export function typeOf(config, id) {
  return byId(config.eventTypes, id) || { id, label: id, emoji: '❓', tone: 'pink', fields: [], presets: [] };
}

export function userOf(config, id) {
  return byId(config.users, id) || { id, name: 'Someone', emoji: '🧑', tone: 'mint' };
}

export function babyOf(config, id) {
  return byId(config.babies, id) || null;
}

export function activeTypes(config) {
  return (config.eventTypes || [])
    .filter((t) => !t.archived)
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
}

/** Look up a colour field option (poop colours carry an alert note). */
export function colorOption(field, value) {
  const opts = field?.options || [];
  return opts.find((o) => (typeof o === 'string' ? o : o.name) === value) || null;
}

/**
 * Human sentence for one logged event's data, e.g. "60 cc · Formula" or
 * "Wet + poop · [swatch] Mustard". Returns HTML (values are escaped).
 */
export function summarize(event, type) {
  const data = event.data || {};
  const parts = [];
  const diaperBits = [];

  for (const field of type.fields || []) {
    const v = data[field.key];
    if (v === undefined || v === null || v === '' || v === false) continue;

    if (field.type === 'toggle') {
      diaperBits.push(field.label.replace(/\s*\(.*\)$/, ''));
      continue;
    }
    if (field.type === 'color') {
      const opt = colorOption(field, v);
      const hex = opt && typeof opt === 'object' ? opt.hex : '#ccc';
      parts.push(`<span class="swatch" style="background:${esc(hex)}"></span>${esc(v)}`);
      continue;
    }
    if (field.type === 'duration') {
      parts.push(esc(fmtMinutes(v)));
      continue;
    }
    if (field.type === 'number') {
      parts.push(`${esc(v)}${field.unit ? ` ${esc(field.unit)}` : ''}`);
      continue;
    }
    parts.push(esc(v));
  }

  if (diaperBits.length) parts.unshift(esc(diaperBits.join(' + ')));
  if (event.note) parts.push(`<span class="muted">${esc(event.note)}</span>`);
  return parts.join(' · ');
}

/** Any alert text attached to the chosen colour (e.g. "call your doctor"). */
export function alertFor(event, type) {
  for (const field of type.fields || []) {
    if (field.type !== 'color') continue;
    const opt = colorOption(field, (event.data || {})[field.key]);
    if (opt && typeof opt === 'object' && opt.alert) return opt.alert;
  }
  return null;
}

/* ------------------------------------------------------------ field inputs */

const QUICK_MINUTES = [5, 10, 15, 20, 30, 45];

function optionName(o) {
  return typeof o === 'string' ? o : o.name;
}

/** Render one editable field. Values are collected back by collectFields(). */
export function fieldHTML(field, value) {
  const key = esc(field.key);
  const lab = esc(field.label || field.key);
  const showIf = field.showIf ? ` data-showif="${esc(field.showIf)}"` : '';
  let body = '';

  switch (field.type) {
    case 'toggle':
      return `<div class="wrapfield"${showIf}>
        <label class="switch">
          <input type="checkbox" data-field="${key}" data-kind="toggle" ${value ? 'checked' : ''}>
          <span class="track"></span>
          <span class="txt"><b>${lab}</b></span>
        </label>
      </div>`;

    case 'select': {
      const opts = field.options || [];
      const cur = value ?? '';
      body = `<input type="hidden" data-field="${key}" data-kind="text" value="${esc(cur)}">
        <div class="preset-row" data-choices="${key}">
          ${opts.map((o) => {
            const name = optionName(o);
            return `<button type="button" class="btn sm" data-choose="${key}" data-value="${esc(name)}"
              aria-pressed="${name === cur}" style="${name === cur ? 'border-color:var(--pink);background:color-mix(in srgb,var(--pink) 22%,var(--surface-2))' : ''}">${esc(name)}</button>`;
          }).join('')}
          ${cur ? `<button type="button" class="btn sm" data-choose="${key}" data-value="">Clear</button>` : ''}
        </div>`;
      break;
    }

    case 'color': {
      const opts = field.options || [];
      const cur = value ?? '';
      body = `<input type="hidden" data-field="${key}" data-kind="text" value="${esc(cur)}">
        <div class="swatch-grid" data-choices="${key}">
          ${opts.map((o) => {
            const name = optionName(o);
            const hex = typeof o === 'object' ? o.hex : '#ddd';
            return `<button type="button" class="swatch-opt" data-choose="${key}" data-value="${esc(name)}"
              aria-pressed="${name === cur}" title="${esc(name)}" style="background:${esc(hex)}"></button>`;
          }).join('')}
        </div>
        <div class="small muted" data-colorname="${key}" style="margin-top:6px">${esc(cur)}</div>`;
      break;
    }

    case 'duration':
      body = `<div class="row">
          <input type="number" data-field="${key}" data-kind="number" inputmode="numeric"
                 min="0" step="1" value="${value ?? ''}" placeholder="minutes">
          <span class="muted small">min</span>
        </div>
        <div class="preset-row" style="margin-top:8px">
          ${QUICK_MINUTES.map((m) => `<button type="button" class="btn sm" data-setnum="${key}" data-value="${m}">${m}m</button>`).join('')}
        </div>`;
      break;

    case 'number': {
      const step = field.step || 1;
      body = `<div class="row">
          <button type="button" class="btn sm" data-bump="${key}" data-value="-${step}">−</button>
          <input type="number" data-field="${key}" data-kind="number" inputmode="decimal"
                 ${field.min !== undefined ? `min="${field.min}"` : ''}
                 ${field.max !== undefined ? `max="${field.max}"` : ''}
                 step="${step}" value="${value ?? ''}">
          <button type="button" class="btn sm" data-bump="${key}" data-value="${step}">+</button>
          ${field.unit ? `<span class="muted small">${esc(field.unit)}</span>` : ''}
        </div>`;
      break;
    }

    default:
      body = `<input type="text" data-field="${key}" data-kind="text" value="${esc(value ?? '')}" placeholder="${lab}">`;
  }

  return `<label class="field"${showIf}><span class="lab">${lab}</span>${body}</label>`;
}

export function fieldsHTML(type, data = {}) {
  return (type.fields || []).map((f) => fieldHTML(f, data[f.key])).join('');
}

/** Read every [data-field] back into a plain object. */
export function collectFields(root) {
  const out = {};
  root.querySelectorAll('[data-field]').forEach((el) => {
    const key = el.dataset.field;
    if (el.dataset.kind === 'toggle') {
      if (el.checked) out[key] = true;
    } else if (el.dataset.kind === 'number') {
      if (el.value !== '') out[key] = Number(el.value);
    } else if (el.value !== '') {
      out[key] = el.value;
    }
  });
  return out;
}

/** Hide fields whose `showIf` dependency is currently falsy. */
export function applyShowIf(root) {
  const values = collectFields(root);
  root.querySelectorAll('[data-showif]').forEach((el) => {
    el.classList.toggle('hidden', !values[el.dataset.showif]);
  });
}

/**
 * Wire the button-driven inputs (choice chips, steppers, quick minutes) inside
 * a container. Returns nothing; listeners live for the container's lifetime.
 */
export function wireFieldControls(root, onChange = () => {}) {
  root.addEventListener('click', (ev) => {
    const choose = ev.target.closest('[data-choose]');
    if (choose) {
      const key = choose.dataset.choose;
      const input = root.querySelector(`[data-field="${CSS.escape(key)}"]`);
      if (input) input.value = choose.dataset.value;
      root.querySelectorAll(`[data-choose="${CSS.escape(key)}"]`).forEach((b) => {
        const on = b.dataset.value === choose.dataset.value && b.dataset.value !== '';
        b.setAttribute('aria-pressed', String(on));
        if (b.classList.contains('btn')) {
          b.style.borderColor = on ? 'var(--pink)' : '';
          b.style.background = on ? 'color-mix(in srgb,var(--pink) 22%,var(--surface-2))' : '';
        }
      });
      const nameEl = root.querySelector(`[data-colorname="${CSS.escape(key)}"]`);
      if (nameEl) nameEl.textContent = choose.dataset.value;
      applyShowIf(root);
      onChange();
      return;
    }

    const bump = ev.target.closest('[data-bump]');
    if (bump) {
      const input = root.querySelector(`[data-field="${CSS.escape(bump.dataset.bump)}"]`);
      if (input) {
        const next = (Number(input.value) || 0) + Number(bump.dataset.value);
        input.value = String(Math.max(Number(input.min ?? 0) || 0, next));
      }
      onChange();
      return;
    }

    const setnum = ev.target.closest('[data-setnum]');
    if (setnum) {
      const input = root.querySelector(`[data-field="${CSS.escape(setnum.dataset.setnum)}"]`);
      if (input) input.value = setnum.dataset.value;
      onChange();
    }
  });

  root.addEventListener('change', () => { applyShowIf(root); onChange(); });
  applyShowIf(root);
}
