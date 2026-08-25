/** Setup screen plus the editors for babies, people, buttons and alarms. */

import {
  state, config, settings, saveConfig, openSheet, closeSheet, toast, refresh, render,
} from './core.js';
import { api } from './api.js';
import * as sound from './sound.js';
import { esc, uid, babyAge } from './util.js';
import {
  TONES, GENDER_TEMPLATES, BABY_EMOJI, PERSON_EMOJI, TYPE_EMOJI,
  toneStyle, activeTypes, typeOf, fieldsHTML, collectFields, wireFieldControls,
} from './ui.js';

/* ------------------------------------------------------------ tiny pickers */

function emojiPicker(name, current, palette) {
  return `
    <div class="preset-row" data-emoji-group="${name}">
      ${palette.map((e) => `
        <button type="button" class="btn sm" data-emoji="${name}" data-value="${esc(e)}"
          style="font-size:1.3rem;${e === current ? 'border-color:var(--pink);background:color-mix(in srgb,var(--pink) 22%,var(--surface-2))' : ''}">${esc(e)}</button>`).join('')}
      <input type="text" data-meta="${name}" value="${esc(current)}" maxlength="4"
             style="width:74px;text-align:center;font-size:1.3rem;min-height:42px;flex:0 0 auto">
    </div>`;
}

function tonePicker(current) {
  return `
    <div class="preset-row" >
      ${TONES.map((t) => `
        <button type="button" class="btn sm" data-tone="${t}"
          style="${toneStyle(t)}background:var(--tone);color:var(--tone-fg);border-color:${t === current ? 'var(--text)' : 'transparent'};text-transform:capitalize">${t}</button>`).join('')}
      <input type="hidden" data-meta="tone" value="${esc(current)}">
    </div>`;
}

/** Wire emoji/tone pickers inside a sheet. */
function wirePickers(sheet) {
  sheet.addEventListener('click', (ev) => {
    const em = ev.target.closest('[data-emoji]');
    if (em) {
      const name = em.dataset.emoji;
      sheet.querySelector(`[data-meta="${name}"]`).value = em.dataset.value;
      sheet.querySelectorAll(`[data-emoji="${name}"]`).forEach((b) => {
        const on = b.dataset.value === em.dataset.value;
        b.style.borderColor = on ? 'var(--pink)' : '';
        b.style.background = on ? 'color-mix(in srgb,var(--pink) 22%,var(--surface-2))' : '';
      });
    }
    const tn = ev.target.closest('[data-tone]');
    if (tn) {
      sheet.querySelector('[data-meta="tone"]').value = tn.dataset.tone;
      sheet.querySelectorAll('[data-tone]').forEach((b) => {
        b.style.borderColor = b.dataset.tone === tn.dataset.tone ? 'var(--text)' : 'transparent';
      });
    }
    const seg = ev.target.closest('[data-seg]');
    if (seg) {
      const group = seg.dataset.seg;
      sheet.querySelector(`[data-meta="${group}"]`).value = seg.dataset.value;
      sheet.querySelectorAll(`[data-seg="${group}"]`).forEach((b) => b.setAttribute('aria-pressed', String(b === seg)));
      sheet.dispatchEvent(new CustomEvent('seg-change', { detail: { group, value: seg.dataset.value } }));
    }
  });
}

function segField(label, name, value, options) {
  return `
    <label class="field">
      <span class="lab">${esc(label)}</span>
      <div class="seg">
        ${options.map((o) => `
          <button type="button" data-seg="${esc(name)}" data-value="${esc(o.value)}"
            aria-pressed="${o.value === value}">${esc(o.label)}</button>`).join('')}
      </div>
      <input type="hidden" data-meta="${esc(name)}" value="${esc(value)}">
    </label>`;
}

/* -------------------------------------------------------------- baby sheet */

export function openBabySheet(babyId = null) {
  const cfg = config();
  const baby = cfg.babies.find((b) => b.id === babyId) || {
    id: null, name: '', gender: 'surprise', birthDate: '', emoji: '🐣', tone: 'mint',
  };

  openSheet(`
    <h3>${baby.id ? 'Edit baby' : 'Add a baby'}</h3>
    <label class="field"><span class="lab">Name</span>
      <input type="text" data-meta="name" value="${esc(baby.name)}" placeholder="Baby's name" autofocus>
    </label>
    ${segField('Template', 'gender', baby.gender, [
      { value: 'girl', label: '👧 Girl' }, { value: 'boy', label: '👦 Boy' }, { value: 'surprise', label: '🐣 Surprise' },
    ])}
    <label class="field"><span class="lab">Birthday</span>
      <input type="date" data-meta="birthDate" value="${esc(baby.birthDate || '')}">
    </label>
    <label class="field"><span class="lab">Avatar</span>${emojiPicker('emoji', baby.emoji || '🐣', BABY_EMOJI)}</label>
    <label class="field"><span class="lab">Colour</span>${tonePicker(baby.tone || 'mint')}</label>
    <div class="sheet-actions">
      <button class="btn" data-close type="button">Cancel</button>
      <button class="btn primary" data-save type="button">Save</button>
    </div>
    ${baby.id ? '<button class="btn danger wide" data-delete type="button" style="margin-top:10px">Delete baby</button>' : ''}
  `, (sheet) => {
    wirePickers(sheet);

    // Picking a gender template nudges the colour and avatar to match.
    sheet.addEventListener('seg-change', (ev) => {
      if (ev.detail.group !== 'gender') return;
      const tpl = GENDER_TEMPLATES[ev.detail.value];
      if (!tpl) return;
      sheet.querySelector('[data-meta="tone"]').value = tpl.tone;
      sheet.querySelectorAll('[data-tone]').forEach((b) => {
        b.style.borderColor = b.dataset.tone === tpl.tone ? 'var(--text)' : 'transparent';
      });
    });

    sheet.querySelector('[data-save]').addEventListener('click', async () => {
      const name = sheet.querySelector('[data-meta="name"]').value.trim();
      if (!name) return toast({ icon: '✏️', text: 'Give your baby a name', tone: 'peach' });
      const next = {
        id: baby.id || uid('b'),
        name,
        gender: sheet.querySelector('[data-meta="gender"]').value,
        birthDate: sheet.querySelector('[data-meta="birthDate"]').value,
        emoji: sheet.querySelector('[data-meta="emoji"]').value || '👶',
        tone: sheet.querySelector('[data-meta="tone"]').value,
      };
      closeSheet();
      await saveConfig((cfgDraft) => {
        const i = cfgDraft.babies.findIndex((b) => b.id === next.id);
        if (i >= 0) cfgDraft.babies[i] = next;
        else cfgDraft.babies.push(next);
      });
      if (!baby.id) {
        state.babyId = next.id;
        render();
      }
      sound.play('twinkle');
      toast({ icon: next.emoji, text: `<b>${esc(name)}</b> saved`, tone: next.tone });
    });

    sheet.querySelector('[data-delete]')?.addEventListener('click', async () => {
      if (!confirm(`Remove ${baby.name}? Logged entries stay in the history file.`)) return;
      closeSheet();
      await saveConfig((cfgDraft) => {
        cfgDraft.babies = cfgDraft.babies.filter((b) => b.id !== baby.id);
      });
    });
  });
}

/* ------------------------------------------------------------ person sheet */

export function openUserSheet(userId = null) {
  const cfg = config();
  const user = cfg.users.find((u) => u.id === userId) || { id: null, name: '', emoji: '🧑', tone: 'lavender' };

  openSheet(`
    <h3>${user.id ? 'Edit person' : 'Add a person'}</h3>
    <label class="field"><span class="lab">Name</span>
      <input type="text" data-meta="name" value="${esc(user.name)}" placeholder="Mom, Dad, Grandma…" autofocus>
    </label>
    <label class="field"><span class="lab">Avatar</span>${emojiPicker('emoji', user.emoji || '🧑', PERSON_EMOJI)}</label>
    <label class="field"><span class="lab">Colour</span>${tonePicker(user.tone || 'lavender')}</label>
    <div class="sheet-actions">
      <button class="btn" data-close type="button">Cancel</button>
      <button class="btn primary" data-save type="button">Save</button>
    </div>
    ${user.id && cfg.users.length > 1 ? '<button class="btn danger wide" data-delete type="button" style="margin-top:10px">Remove person</button>' : ''}
  `, (sheet) => {
    wirePickers(sheet);
    sheet.querySelector('[data-save]').addEventListener('click', async () => {
      const name = sheet.querySelector('[data-meta="name"]').value.trim();
      if (!name) return toast({ icon: '✏️', text: 'Name required', tone: 'peach' });
      const next = {
        id: user.id || uid('u'),
        name,
        emoji: sheet.querySelector('[data-meta="emoji"]').value || '🧑',
        tone: sheet.querySelector('[data-meta="tone"]').value,
      };
      closeSheet();
      await saveConfig((cfgDraft) => {
        const i = cfgDraft.users.findIndex((u) => u.id === next.id);
        if (i >= 0) cfgDraft.users[i] = next;
        else cfgDraft.users.push(next);
      });
      sound.play('success');
    });
    sheet.querySelector('[data-delete]')?.addEventListener('click', async () => {
      closeSheet();
      await saveConfig((cfgDraft) => {
        cfgDraft.users = cfgDraft.users.filter((u) => u.id !== user.id);
      });
    });
  });
}

/* -------------------------------------------------- event type ("button") */

let draft = null; // the type being edited across nested sheets

const FIELD_KINDS = [
  { value: 'number', label: 'Number' },
  { value: 'text', label: 'Text' },
  { value: 'select', label: 'Choice' },
  { value: 'toggle', label: 'Yes / no' },
  { value: 'color', label: 'Colour' },
  { value: 'duration', label: 'Duration' },
];

export function openTypeSheet(typeId = null) {
  const cfg = config();
  if (!draft || draft.id !== typeId) {
    const found = cfg.eventTypes.find((t) => t.id === typeId);
    draft = found
      ? structuredClone(found)
      : {
          id: null, label: '', emoji: '⭐', tone: 'lavender', mode: 'instant',
          sound: 'chime', order: 500, fields: [], presets: [{ id: uid('p'), label: 'Log', emoji: '⭐', data: {} }],
          builtin: false, archived: false,
        };
  }
  const t = draft;

  openSheet(`
    <h3>${t.id ? 'Edit button' : 'New button'}</h3>
    <label class="field"><span class="lab">Name</span>
      <input type="text" data-meta="label" value="${esc(t.label)}" placeholder="Tummy time, Weight, Vitamin D…">
    </label>
    <label class="field"><span class="lab">Icon</span>${emojiPicker('emoji', t.emoji, TYPE_EMOJI)}</label>
    <label class="field"><span class="lab">Colour</span>${tonePicker(t.tone)}</label>
    ${segField('How it logs', 'mode', t.mode, [
      { value: 'instant', label: '⚡ One tap' }, { value: 'timer', label: '⏱️ Timer' },
    ])}
    <label class="field"><span class="lab">Sound</span>
      <div class="preset-row">
        ${sound.SOUND_NAMES.map((s) => `
          <button type="button" class="btn sm" data-sound="${esc(s)}"
            style="${s === t.sound ? 'border-color:var(--pink);background:color-mix(in srgb,var(--pink) 22%,var(--surface-2))' : ''}">${esc(s)}</button>`).join('')}
      </div>
      <input type="hidden" data-meta="sound" value="${esc(t.sound || 'chime')}">
    </label>

    <div class="section-title" style="margin-left:0">Fields to record</div>
    ${(t.fields || []).map((f, i) => `
      <div class="list-item">
        <div class="grow">
          <b>${esc(f.label)}</b>
          <div class="small muted">${esc(f.type)}${f.unit ? ` · ${esc(f.unit)}` : ''}${f.options?.length ? ` · ${f.options.length} options` : ''}</div>
        </div>
        <button class="btn sm" data-field-edit="${i}" type="button">Edit</button>
        <button class="btn sm danger" data-field-del="${i}" type="button">✕</button>
      </div>`).join('') || '<p class="small muted">No extra fields — the button just records the time.</p>'}
    <button class="btn wide sm" data-field-add type="button" style="margin-bottom:6px">➕ Add field</button>

    <div class="section-title" style="margin-left:0">Buttons on the card</div>
    ${(t.presets || []).map((p, i) => `
      <div class="list-item">
        <div class="grow"><b>${esc(p.emoji || t.emoji)} ${esc(p.label)}</b>
          <div class="small muted">${esc(Object.entries(p.data || {}).map(([k, v]) => `${k}: ${v}`).join(', ') || 'no preset values')}</div>
        </div>
        <button class="btn sm" data-preset-edit="${i}" type="button">Edit</button>
        ${(t.presets || []).length > 1 ? `<button class="btn sm danger" data-preset-del="${i}" type="button">✕</button>` : ''}
      </div>`).join('')}
    <button class="btn wide sm" data-preset-add type="button">➕ Add button</button>

    <div class="sheet-actions">
      <button class="btn" data-cancel type="button">Cancel</button>
      <button class="btn primary" data-save type="button">Save</button>
    </div>
    ${t.id ? `<button class="btn danger wide" data-archive type="button" style="margin-top:10px">
      ${t.builtin ? 'Hide this button' : 'Delete this button'}</button>` : ''}
  `, (sheet) => {
    wirePickers(sheet);

    /** Pull the top-level inputs into the draft before opening a sub-sheet. */
    const sync = () => {
      draft.label = sheet.querySelector('[data-meta="label"]').value.trim();
      draft.emoji = sheet.querySelector('[data-meta="emoji"]').value || '⭐';
      draft.tone = sheet.querySelector('[data-meta="tone"]').value;
      draft.mode = sheet.querySelector('[data-meta="mode"]').value;
      draft.sound = sheet.querySelector('[data-meta="sound"]').value;
    };

    sheet.addEventListener('click', (ev) => {
      const s = ev.target.closest('[data-sound]');
      if (s) {
        sheet.querySelector('[data-meta="sound"]').value = s.dataset.sound;
        sheet.querySelectorAll('[data-sound]').forEach((b) => {
          const on = b.dataset.sound === s.dataset.sound;
          b.style.borderColor = on ? 'var(--pink)' : '';
          b.style.background = on ? 'color-mix(in srgb,var(--pink) 22%,var(--surface-2))' : '';
        });
        sound.play(s.dataset.sound);
      }
    });

    sheet.querySelector('[data-field-add]').addEventListener('click', () => { sync(); openFieldSheet(-1); });
    sheet.querySelectorAll('[data-field-edit]').forEach((b) =>
      b.addEventListener('click', () => { sync(); openFieldSheet(Number(b.dataset.fieldEdit)); }));
    sheet.querySelectorAll('[data-field-del]').forEach((b) =>
      b.addEventListener('click', () => {
        sync();
        draft.fields.splice(Number(b.dataset.fieldDel), 1);
        openTypeSheet(draft.id);
      }));

    sheet.querySelector('[data-preset-add]').addEventListener('click', () => { sync(); openPresetSheet(-1); });
    sheet.querySelectorAll('[data-preset-edit]').forEach((b) =>
      b.addEventListener('click', () => { sync(); openPresetSheet(Number(b.dataset.presetEdit)); }));
    sheet.querySelectorAll('[data-preset-del]').forEach((b) =>
      b.addEventListener('click', () => {
        sync();
        draft.presets.splice(Number(b.dataset.presetDel), 1);
        openTypeSheet(draft.id);
      }));

    sheet.querySelector('[data-cancel]').addEventListener('click', () => { draft = null; closeSheet(); });

    sheet.querySelector('[data-save]').addEventListener('click', async () => {
      sync();
      if (!draft.label) return toast({ icon: '✏️', text: 'Give the button a name', tone: 'peach' });
      const next = { ...draft, id: draft.id || uid('t') };
      draft = null;
      closeSheet();
      await saveConfig((cfgDraft) => {
        const i = cfgDraft.eventTypes.findIndex((x) => x.id === next.id);
        if (i >= 0) cfgDraft.eventTypes[i] = next;
        else cfgDraft.eventTypes.push({ ...next, order: (cfgDraft.eventTypes.length + 1) * 10 });
      });
      sound.play(next.sound || 'success');
    });

    sheet.querySelector('[data-archive]')?.addEventListener('click', async () => {
      const isBuiltin = draft.builtin;
      if (!confirm(isBuiltin ? 'Hide this button from the track screen?' : 'Delete this button?')) return;
      const id = draft.id;
      draft = null;
      closeSheet();
      await saveConfig((cfgDraft) => {
        if (isBuiltin) {
          const t2 = cfgDraft.eventTypes.find((x) => x.id === id);
          if (t2) t2.archived = true;
        } else {
          cfgDraft.eventTypes = cfgDraft.eventTypes.filter((x) => x.id !== id);
        }
      });
    });
  });
}

/** Field editor; index -1 appends. Returns to the type sheet when done. */
function openFieldSheet(index) {
  const field = index >= 0
    ? structuredClone(draft.fields[index])
    : { key: '', label: '', type: 'number', unit: '', options: [] };

  const optionText = (field.options || [])
    .map((o) => (typeof o === 'string' ? o : `${o.name}${o.hex ? `|${o.hex}` : ''}`))
    .join('\n');

  openSheet(`
    <h3>${index >= 0 ? 'Edit field' : 'Add field'}</h3>
    <label class="field"><span class="lab">Label</span>
      <input type="text" data-meta="label" value="${esc(field.label)}" placeholder="Amount, Side, Temperature…">
    </label>
    ${segField('Kind', 'type', field.type, FIELD_KINDS.slice(0, 3))}
    ${segField('', 'type2', field.type, FIELD_KINDS.slice(3))}
    <label class="field"><span class="lab">Unit (optional)</span>
      <input type="text" data-meta="unit" value="${esc(field.unit || '')}" placeholder="cc, °C, kg">
    </label>
    <label class="field"><span class="lab">Options — one per line (choice / colour)</span>
      <textarea data-meta="options" placeholder="Left&#10;Right&#10;Both&#10;&#10;For colours: Mustard|#d9a520">${esc(optionText)}</textarea>
    </label>
    <label class="field"><span class="lab">Only show when this field is ticked (optional)</span>
      <input type="text" data-meta="showIf" value="${esc(field.showIf || '')}" placeholder="key of a yes/no field">
    </label>
    <div class="sheet-actions">
      <button class="btn" data-back type="button">Back</button>
      <button class="btn primary" data-save type="button">Done</button>
    </div>
  `, (sheet) => {
    wirePickers(sheet);
    // Two segmented rows share one value; keep them in sync.
    sheet.addEventListener('seg-change', (ev) => {
      const other = ev.detail.group === 'type' ? 'type2' : 'type';
      sheet.querySelector(`[data-meta="${other}"]`).value = ev.detail.value;
      sheet.querySelectorAll(`[data-seg="${other}"]`).forEach((b) =>
        b.setAttribute('aria-pressed', String(b.dataset.value === ev.detail.value)));
    });

    sheet.querySelector('[data-back]').addEventListener('click', () => openTypeSheet(draft.id));

    sheet.querySelector('[data-save]').addEventListener('click', () => {
      const label = sheet.querySelector('[data-meta="label"]').value.trim();
      if (!label) return toast({ icon: '✏️', text: 'Field needs a label', tone: 'peach' });
      const type = sheet.querySelector('[data-meta="type"]').value;
      const options = sheet.querySelector('[data-meta="options"]').value
        .split('\n').map((l) => l.trim()).filter(Boolean)
        .map((line) => {
          const [name, hex] = line.split('|').map((x) => x.trim());
          return type === 'color' ? { name, hex: hex || '#cccccc' } : name;
        });
      const next = {
        key: field.key || label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || uid('f'),
        label,
        type,
        unit: sheet.querySelector('[data-meta="unit"]').value.trim() || undefined,
        options: options.length ? options : undefined,
        showIf: sheet.querySelector('[data-meta="showIf"]').value.trim() || undefined,
      };
      if (index >= 0) draft.fields[index] = next;
      else draft.fields.push(next);
      openTypeSheet(draft.id);
    });
  });
}

/** Preset editor: what one tap on this button should record. */
function openPresetSheet(index) {
  const preset = index >= 0
    ? structuredClone(draft.presets[index])
    : { id: uid('p'), label: '', emoji: draft.emoji, data: {} };

  openSheet(`
    <h3>${index >= 0 ? 'Edit button' : 'Add button'}</h3>
    <label class="field"><span class="lab">Label</span>
      <input type="text" data-meta="label" value="${esc(preset.label)}" placeholder="Wet, 60 cc, Left…">
    </label>
    <label class="field"><span class="lab">Icon</span>${emojiPicker('emoji', preset.emoji || draft.emoji, TYPE_EMOJI)}</label>
    <div class="section-title" style="margin-left:0">One tap records</div>
    <div data-fields>${fieldsHTML(draft, preset.data || {})}</div>
    <p class="small muted">Leave blank to be asked later. ${draft.mode === 'timer' ? 'Duration is filled in when the timer stops.' : ''}</p>
    <div class="sheet-actions">
      <button class="btn" data-back type="button">Back</button>
      <button class="btn primary" data-save type="button">Done</button>
    </div>
  `, (sheet) => {
    wirePickers(sheet);
    wireFieldControls(sheet.querySelector('[data-fields]'));
    sheet.querySelector('[data-back]').addEventListener('click', () => openTypeSheet(draft.id));
    sheet.querySelector('[data-save]').addEventListener('click', () => {
      const label = sheet.querySelector('[data-meta="label"]').value.trim();
      if (!label) return toast({ icon: '✏️', text: 'Button needs a label', tone: 'peach' });
      const next = {
        id: preset.id || uid('p'),
        label,
        emoji: sheet.querySelector('[data-meta="emoji"]').value || draft.emoji,
        data: collectFields(sheet.querySelector('[data-fields]')),
      };
      if (index >= 0) draft.presets[index] = next;
      else draft.presets.push(next);
      openTypeSheet(draft.id);
    });
  });
}

/* ------------------------------------------------------------ alarm sheet */

export function openAlarmSheet(alarmId = null) {
  const cfg = config();
  const alarm = cfg.alarms.find((a) => a.id === alarmId) || {
    id: null, label: '', emoji: '⏰', enabled: true, mode: 'sinceLast',
    typeIds: [], babyId: 'all', everyMinutes: 180, times: ['08:00'],
    leadMinutes: 0, snoozeMinutes: 10, sound: 'chime', repeat: true, quietHours: null,
  };
  const quiet = alarm.quietHours || { from: '22:00', to: '06:00' };

  openSheet(`
    <h3>${alarm.id ? 'Edit alarm' : 'New alarm'}</h3>
    <label class="field"><span class="lab">Name</span>
      <input type="text" data-meta="label" value="${esc(alarm.label)}" placeholder="Feeding time, Vitamin D…">
    </label>
    <label class="field"><span class="lab">Icon</span>${emojiPicker('emoji', alarm.emoji || '⏰', ['⏰', '🍼', '🤱', '🧷', '💊', '😴', '🛁', '🌡️'])}</label>

    ${segField('When to ring', 'mode', alarm.mode, [
      { value: 'sinceLast', label: 'After last' },
      { value: 'interval', label: 'Every' },
      { value: 'timeOfDay', label: 'At time' },
    ])}

    <div data-when-sincelast class="${alarm.mode === 'timeOfDay' ? 'hidden' : ''}">
      <label class="field"><span class="lab">Interval (minutes)</span>
        <div class="row">
          <input type="number" data-meta="everyMinutes" value="${Number(alarm.everyMinutes) || 180}" min="1" step="5" inputmode="numeric">
        </div>
        <div class="preset-row" style="margin-top:8px">
          ${[60, 90, 120, 150, 180, 240, 360].map((m) => `<button type="button" class="btn sm" data-setmins="${m}">${m >= 60 ? `${m / 60}h` : `${m}m`}</button>`).join('')}
        </div>
      </label>
    </div>

    <div data-when-timeofday class="${alarm.mode === 'timeOfDay' ? '' : 'hidden'}">
      <label class="field"><span class="lab">Times of day — one per line (HH:MM)</span>
        <textarea data-meta="times" placeholder="08:00&#10;20:00">${esc((alarm.times || []).join('\n'))}</textarea>
      </label>
    </div>

    <label class="field"><span class="lab">Watches these buttons</span>
      <div class="preset-row" data-types>
        ${activeTypes(cfg).map((t) => `
          <button type="button" class="btn sm" data-type-toggle="${esc(t.id)}"
            aria-pressed="${(alarm.typeIds || []).includes(t.id)}"
            style="${(alarm.typeIds || []).includes(t.id) ? 'border-color:var(--pink);background:color-mix(in srgb,var(--pink) 22%,var(--surface-2))' : ''}">
            ${esc(t.emoji)} ${esc(t.label)}</button>`).join('')}
      </div>
      <p class="small muted" style="margin-top:6px">Logging one of these resets the countdown — and the alarm's "Done" button logs the first one.</p>
    </label>

    <label class="field"><span class="lab">Baby</span>
      <div class="preset-row">
        <button type="button" class="btn sm" data-baby-pick="all" aria-pressed="${alarm.babyId === 'all'}"
          style="${alarm.babyId === 'all' ? 'border-color:var(--pink);background:color-mix(in srgb,var(--pink) 22%,var(--surface-2))' : ''}">All babies</button>
        ${cfg.babies.map((b) => `
          <button type="button" class="btn sm" data-baby-pick="${esc(b.id)}" aria-pressed="${alarm.babyId === b.id}"
            style="${alarm.babyId === b.id ? 'border-color:var(--pink);background:color-mix(in srgb,var(--pink) 22%,var(--surface-2))' : ''}">${esc(b.emoji || '👶')} ${esc(b.name)}</button>`).join('')}
      </div>
      <input type="hidden" data-meta="babyId" value="${esc(alarm.babyId || 'all')}">
    </label>

    <label class="field"><span class="lab">Snooze length (minutes)</span>
      <input type="number" data-meta="snoozeMinutes" value="${Number(alarm.snoozeMinutes) || 10}" min="1" step="1" inputmode="numeric">
    </label>

    <div class="switch">
      <span class="txt"><b>Quiet hours</b><span class="small muted">Stay silent overnight</span></span>
      <label class="switch" style="padding:0">
        <input type="checkbox" data-meta="quietOn" ${alarm.quietHours ? 'checked' : ''}>
        <span class="track"></span>
      </label>
    </div>
    <div class="row" data-quiet-row style="${alarm.quietHours ? '' : 'display:none'}">
      <input type="time" data-meta="quietFrom" value="${esc(quiet.from)}">
      <span class="muted">to</span>
      <input type="time" data-meta="quietTo" value="${esc(quiet.to)}">
    </div>

    <div class="sheet-actions">
      <button class="btn" data-close type="button">Cancel</button>
      <button class="btn primary" data-save type="button">Save</button>
    </div>
    ${alarm.id ? '<button class="btn danger wide" data-delete type="button" style="margin-top:10px">Delete alarm</button>' : ''}
  `, (sheet) => {
    wirePickers(sheet);
    const picked = new Set(alarm.typeIds || []);

    sheet.addEventListener('seg-change', (ev) => {
      if (ev.detail.group !== 'mode') return;
      sheet.querySelector('[data-when-sincelast]').classList.toggle('hidden', ev.detail.value === 'timeOfDay');
      sheet.querySelector('[data-when-timeofday]').classList.toggle('hidden', ev.detail.value !== 'timeOfDay');
    });

    sheet.addEventListener('click', (ev) => {
      const tt = ev.target.closest('[data-type-toggle]');
      if (tt) {
        const id = tt.dataset.typeToggle;
        if (picked.has(id)) picked.delete(id); else picked.add(id);
        const on = picked.has(id);
        tt.setAttribute('aria-pressed', String(on));
        tt.style.borderColor = on ? 'var(--pink)' : '';
        tt.style.background = on ? 'color-mix(in srgb,var(--pink) 22%,var(--surface-2))' : '';
      }
      const bp = ev.target.closest('[data-baby-pick]');
      if (bp) {
        sheet.querySelector('[data-meta="babyId"]').value = bp.dataset.babyPick;
        sheet.querySelectorAll('[data-baby-pick]').forEach((b) => {
          const on = b === bp;
          b.setAttribute('aria-pressed', String(on));
          b.style.borderColor = on ? 'var(--pink)' : '';
          b.style.background = on ? 'color-mix(in srgb,var(--pink) 22%,var(--surface-2))' : '';
        });
      }
      const mins = ev.target.closest('[data-setmins]');
      if (mins) sheet.querySelector('[data-meta="everyMinutes"]').value = mins.dataset.setmins;
    });

    sheet.querySelector('[data-meta="quietOn"]').addEventListener('change', (ev) => {
      sheet.querySelector('[data-quiet-row]').style.display = ev.target.checked ? '' : 'none';
    });

    sheet.querySelector('[data-save]').addEventListener('click', async () => {
      const label = sheet.querySelector('[data-meta="label"]').value.trim();
      if (!label) return toast({ icon: '✏️', text: 'Alarm needs a name', tone: 'peach' });
      const mode = sheet.querySelector('[data-meta="mode"]').value;
      if (mode === 'sinceLast' && !picked.size) {
        return toast({ icon: '👆', text: 'Pick at least one button to watch', tone: 'peach' });
      }
      const quietOn = sheet.querySelector('[data-meta="quietOn"]').checked;
      const next = {
        id: alarm.id || uid('a'),
        label,
        emoji: sheet.querySelector('[data-meta="emoji"]').value || '⏰',
        enabled: alarm.id ? alarm.enabled : true,
        mode,
        typeIds: [...picked],
        babyId: sheet.querySelector('[data-meta="babyId"]').value,
        everyMinutes: Math.max(1, Number(sheet.querySelector('[data-meta="everyMinutes"]').value) || 180),
        times: sheet.querySelector('[data-meta="times"]').value.split('\n').map((s) => s.trim()).filter(Boolean),
        leadMinutes: 0,
        snoozeMinutes: Math.max(1, Number(sheet.querySelector('[data-meta="snoozeMinutes"]').value) || 10),
        sound: alarm.sound || 'chime',
        repeat: true,
        quietHours: quietOn
          ? { from: sheet.querySelector('[data-meta="quietFrom"]').value, to: sheet.querySelector('[data-meta="quietTo"]').value }
          : null,
      };
      closeSheet();
      await saveConfig((cfgDraft) => {
        const i = cfgDraft.alarms.findIndex((a) => a.id === next.id);
        if (i >= 0) cfgDraft.alarms[i] = next;
        else cfgDraft.alarms.push(next);
      });
      if (next.enabled && 'Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
      }
      sound.play('twinkle');
    });

    sheet.querySelector('[data-delete]')?.addEventListener('click', async () => {
      if (!confirm('Delete this alarm?')) return;
      closeSheet();
      await saveConfig((cfgDraft) => {
        cfgDraft.alarms = cfgDraft.alarms.filter((a) => a.id !== alarm.id);
      });
    });
  });
}

/* -------------------------------------------------------------- setup view */

function switchRow(label, hint, key, checked) {
  return `
    <label class="switch">
      <input type="checkbox" data-setting="${esc(key)}" ${checked ? 'checked' : ''}>
      <span class="track"></span>
      <span class="txt"><b>${esc(label)}</b><span class="small muted">${esc(hint)}</span></span>
    </label>`;
}

export function renderSetup() {
  const cfg = config();
  const s = settings();
  return `
    <div class="wrap">
      <div class="section-title">Babies</div>
      ${cfg.babies.map((b) => `
        <div class="list-item" style="${toneStyle(b.tone)}">
          <div style="font-size:1.6rem">${esc(b.emoji || '👶')}</div>
          <div class="grow">
            <b>${esc(b.name)}</b>
            <div class="small muted">${esc(babyAge(b.birthDate) || 'no birthday set')} · ${esc(GENDER_TEMPLATES[b.gender]?.label || '—')}</div>
          </div>
          <button class="btn sm" data-act="edit-baby" data-id="${esc(b.id)}">Edit</button>
        </div>`).join('') || '<p class="small muted">No babies yet.</p>'}
      <button class="btn wide" data-act="add-baby">➕ Add baby</button>

      <div class="section-title">People</div>
      ${cfg.users.map((u) => `
        <div class="list-item" style="${toneStyle(u.tone)}">
          <div style="font-size:1.6rem">${esc(u.emoji)}</div>
          <div class="grow"><b>${esc(u.name)}</b></div>
          <button class="btn sm" data-act="edit-user" data-id="${esc(u.id)}">Edit</button>
        </div>`).join('')}
      <button class="btn wide" data-act="add-user">➕ Add person</button>

      <div class="section-title">Buttons</div>
      ${(cfg.eventTypes || []).slice().sort((a, b) => (a.order ?? 999) - (b.order ?? 999)).map((t) => `
        <div class="list-item" style="${toneStyle(t.tone)};${t.archived ? 'opacity:.55' : ''}">
          <div style="font-size:1.6rem">${esc(t.emoji)}</div>
          <div class="grow">
            <b>${esc(t.label)}</b>
            <div class="small muted">${t.mode === 'timer' ? '⏱️ timer' : '⚡ one tap'} · ${(t.presets || []).length} button(s)${t.archived ? ' · hidden' : ''}</div>
          </div>
          ${t.archived
            ? `<button class="btn sm" data-act="unhide-type" data-id="${esc(t.id)}">Show</button>`
            : `<button class="btn sm" data-act="edit-type" data-id="${esc(t.id)}">Edit</button>`}
        </div>`).join('')}
      <button class="btn wide" data-act="add-type">➕ New button</button>

      <div class="section-title">Look &amp; feel</div>
      <div class="card">
        <label class="field"><span class="lab">Theme</span>
          <div class="seg">
            ${[['auto', '🌗 Auto'], ['light', '☀️ Light'], ['dark', '🌙 Dark']].map(([v, l]) => `
              <button data-act="set-theme" data-value="${v}" aria-pressed="${(s.theme || 'auto') === v}">${l}</button>`).join('')}
          </div>
        </label>
        <label class="field"><span class="lab">Clock</span>
          <div class="seg">
            ${[['12h', '2:04 PM'], ['24h', '14:04']].map(([v, l]) => `
              <button data-act="set-timefmt" data-value="${v}" aria-pressed="${(s.timeFormat || '12h') === v}">${l}</button>`).join('')}
          </div>
        </label>
        ${switchRow('Sounds', 'Chime when something is logged', 'sound', s.sound !== false)}
        <label class="field"><span class="lab">Volume</span>
          <input type="range" min="0" max="1" step="0.05" value="${s.volume ?? 0.6}" data-setting-range="volume" style="width:100%;min-height:auto">
        </label>
        ${switchRow('Spoken confirmation', 'Says what was logged, and by whom', 'voice', !!s.voice)}
        ${switchRow('Vibration', 'Buzz on tap where supported', 'haptics', s.haptics !== false)}
        ${switchRow('Confirm before delete', 'Ask before removing an entry', 'confirmDelete', s.confirmDelete !== false)}
      </div>

      <div class="section-title">Data</div>
      <div class="card">
        <p class="small muted" style="margin-top:0">
          ${state.data?.totalEvents ?? 0} entries stored as plain text on the server
          (<code>data/events.log</code> and <code>data/config.json</code>). Everything survives a restart.
        </p>
        <button class="btn wide" data-act="export">⬇️ Export CSV</button>
      </div>
      <p class="center small muted" style="margin:18px 0">Made with 🍼 and very little sleep.</p>
    </div>`;
}

/** Settings toggles/sliders are wired once, on the delegated container. */
export function wireSetup(root) {
  root.querySelectorAll('[data-setting]').forEach((el) => {
    el.addEventListener('change', () => {
      saveConfig((cfg) => { cfg.settings[el.dataset.setting] = el.checked; });
      if (el.dataset.setting === 'sound' && el.checked) sound.play('chime');
    });
  });
  root.querySelectorAll('[data-setting-range]').forEach((el) => {
    el.addEventListener('change', () => {
      saveConfig((cfg) => { cfg.settings[el.dataset.settingRange] = Number(el.value); });
      sound.play('ding');
    });
  });
}

export async function exportCSV() {
  window.location.href = `/api/export.csv?babyId=${encodeURIComponent(state.babyId || 'all')}`;
}
