/** Setup screen plus the editors for babies, people, buttons and alarms. */

import {
  state, config, settings, saveConfig, openSheet, closeSheet, toast, refresh, render,
  markUnlocked, lockProfile,
} from './core.js';
import { api, autoBackup } from './api.js';
import * as sound from './sound.js';
import { esc, uid, babyAge } from './util.js';
import {
  TONES, GENDER_TEMPLATES, BABY_EMOJI, PERSON_EMOJI, TYPE_EMOJI,
  toneStyle, activeTypes, trackedMetrics, typeOf, fieldsHTML, collectFields, wireFieldControls,
} from './ui.js';
import {
  NUTRIENTS, MILK_KINDS, nutritionOn, milkById, milkEnabled, enabledMilks, milkSummary,
} from './nutrition.js';
import { supportsSides } from './feeding.js';
import { customChartTypes, customChartOn, AGGREGATIONS } from './stats.js';

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
    id: null, name: '', gender: 'surprise', birthDate: '', weightKg: '', emoji: '🐣', tone: 'mint',
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
    <label class="field"><span class="lab">Current weight (optional)</span>
      <div class="row">
        <input type="number" data-meta="weightKg" inputmode="decimal" min="0" max="40" step="0.05"
               value="${esc(baby.weightKg ?? '')}" placeholder="e.g. 4.2">
        <span class="muted small">kg</span>
      </div>
      <span class="small muted">Used for the per-kilo intake figures a pediatrician asks about. Update it after each weigh-in.</span>
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
        weightKg: Number(sheet.querySelector('[data-meta="weightKg"]').value) || null,
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

/* --------------------------------------------------------------- PIN entry */

/**
 * A numeric keypad sheet. `onComplete(pin, ctl)` fires as soon as four digits
 * are in; `ctl.error()` shakes and clears, `ctl.reset()` just clears.
 */
export function openPinPad({ title, subtitle = '', onComplete, onCancel }) {
  let digits = '';

  const sheet = openSheet(`
    <h3 style="text-align:center">${esc(title)}</h3>
    <p class="small muted center" data-pin-sub style="margin:0 0 14px">${esc(subtitle)}</p>
    <div class="pin-dots" data-dots>
      ${[0, 1, 2, 3].map(() => '<span class="pin-dot"></span>').join('')}
    </div>
    <div class="keypad">
      ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button type="button" class="key" data-key="${n}">${n}</button>`).join('')}
      <button type="button" class="key ghost" data-key="cancel">Cancel</button>
      <button type="button" class="key" data-key="0">0</button>
      <button type="button" class="key ghost" data-key="del">⌫</button>
    </div>
  `, (el) => {
    const dots = el.querySelector('[data-dots]');
    const sub = el.querySelector('[data-pin-sub]');

    const paint = () => {
      [...dots.children].forEach((d, i) => d.classList.toggle('on', i < digits.length));
    };

    const ctl = {
      reset() { digits = ''; paint(); },
      error(msg) {
        digits = '';
        paint();
        dots.classList.remove('shake');
        void dots.offsetWidth;      // restart the animation
        dots.classList.add('shake');
        sub.textContent = msg;
        sub.classList.add('pin-error');
        sound.play('error');
      },
      setSubtitle(msg) {
        sub.textContent = msg;
        sub.classList.remove('pin-error');
      },
      close: closeSheet,
    };

    el.addEventListener('click', (ev) => {
      const key = ev.target.closest('[data-key]');
      if (!key) return;
      const val = key.dataset.key;
      if (val === 'cancel') { closeSheet(); onCancel?.(); return; }
      if (val === 'del') { digits = digits.slice(0, -1); paint(); return; }
      if (digits.length >= 4) return;
      digits += val;
      sound.play('pop');
      paint();
      if (digits.length === 4) setTimeout(() => onComplete(digits, ctl), 120);
    });

    // Physical keyboards work too.
    const onKey = (ev) => {
      if (/^[0-9]$/.test(ev.key) && digits.length < 4) {
        digits += ev.key;
        paint();
        if (digits.length === 4) setTimeout(() => onComplete(digits, ctl), 120);
      } else if (ev.key === 'Backspace') {
        digits = digits.slice(0, -1);
        paint();
      }
    };
    document.addEventListener('keydown', onKey);
    el.addEventListener('sheet-closed', () => document.removeEventListener('keydown', onKey));
  });

  return sheet;
}

/** Ask for `user`'s PIN, then run `onSuccess`. Unlocks for the tab session. */
export function unlockProfile(userId, onSuccess, onCancel) {
  const user = config().users.find((u) => u.id === userId);
  if (!user) return;
  openPinPad({
    title: `${user.emoji} ${user.name}`,
    subtitle: 'Enter PIN',
    onCancel,
    onComplete: async (pin, ctl) => {
      try {
        const res = await api.verifyPin(userId, pin);
        if (res.ok) {
          markUnlocked(userId);
          closeSheet();
          sound.play('success');
          onSuccess?.();
        } else if (res.retryAfter) {
          ctl.error(`Too many tries — wait ${res.retryAfter}s`);
        } else {
          ctl.error(`Wrong PIN — ${res.remaining} tries left`);
        }
      } catch (err) {
        ctl.error(err.message);
      }
    },
  });
}

/** Set, change or clear a profile PIN. Returns to the person sheet after. */
function choosePin(userId, currentPin) {
  const user = config().users.find((u) => u.id === userId);
  openPinPad({
    title: `${user.emoji} ${user.name}`,
    subtitle: 'Choose a new 4-digit PIN',
    onCancel: () => openUserSheet(userId),
    onComplete: (first, ctl) => {
      ctl.reset();
      ctl.setSubtitle('Enter it once more');
      // Second pass must match the first.
      openPinPad({
        title: `${user.emoji} ${user.name}`,
        subtitle: 'Confirm the PIN',
        onCancel: () => openUserSheet(userId),
        onComplete: async (second, ctl2) => {
          if (second !== first) return ctl2.error('PINs did not match — try again');
          try {
            await api.setPin(userId, first, currentPin);
            markUnlocked(userId);
            closeSheet();
            sound.play('twinkle');
            toast({ icon: '🔒', text: `PIN set for <b>${esc(user.name)}</b>`, tone: 'mint' });
            await refresh();
            openUserSheet(userId);
          } catch (err) {
            ctl2.error(err.message);
          }
        },
      });
    },
  });
}

/** Entry point from the person sheet: verify the old PIN first if there is one. */
function startPinChange(userId) {
  const user = config().users.find((u) => u.id === userId);
  if (!user.hasPin) return choosePin(userId, null);
  openPinPad({
    title: `${user.emoji} ${user.name}`,
    subtitle: 'Enter the current PIN',
    onCancel: () => openUserSheet(userId),
    onComplete: async (pin, ctl) => {
      try {
        const res = await api.verifyPin(userId, pin);
        if (!res.ok) {
          return ctl.error(res.retryAfter ? `Too many tries — wait ${res.retryAfter}s` : 'Wrong PIN');
        }
        choosePin(userId, pin);
      } catch (err) {
        ctl.error(err.message);
      }
    },
  });
}

function startPinRemoval(userId) {
  const user = config().users.find((u) => u.id === userId);
  openPinPad({
    title: `${user.emoji} ${user.name}`,
    subtitle: 'Enter the PIN to remove it',
    onCancel: () => openUserSheet(userId),
    onComplete: async (pin, ctl) => {
      try {
        await api.setPin(userId, null, pin);
        lockProfile(userId);
        closeSheet();
        sound.play('undo');
        toast({ icon: '🔓', text: `PIN removed for <b>${esc(user.name)}</b>`, tone: 'lavender' });
        await refresh();
        openUserSheet(userId);
      } catch (err) {
        ctl.error(err.message);
      }
    },
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

    <div class="section-title" style="margin-left:0">Profile lock</div>
    ${user.id ? `
      <div class="list-item">
        <div style="font-size:1.4rem">${user.hasPin ? '🔒' : '🔓'}</div>
        <div class="grow">
          <b>${user.hasPin ? 'PIN required' : 'No PIN'}</b>
          <div class="small muted">${user.hasPin
            ? 'Asked for when switching to this person'
            : 'Anyone can log entries as this person'}</div>
        </div>
        <button class="btn sm" data-pin-change type="button">${user.hasPin ? 'Change' : 'Set PIN'}</button>
        ${user.hasPin ? '<button class="btn sm danger" data-pin-remove type="button">Remove</button>' : ''}
      </div>
      <p class="small muted">A 4-digit PIN keeps entries from being logged under the wrong name. It is a courtesy lock, not real security.</p>`
      : '<p class="small muted">Save this person first, then you can add a PIN.</p>'}

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
    sheet.querySelector('[data-pin-change]')?.addEventListener('click', () => startPinChange(user.id));
    sheet.querySelector('[data-pin-remove]')?.addEventListener('click', () => startPinRemoval(user.id));

    sheet.querySelector('[data-delete]')?.addEventListener('click', async () => {
      closeSheet();
      lockProfile(user.id);
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
    <div data-agg-row class="${['number', 'duration'].includes(field.type) ? '' : 'hidden'}">
      ${segField('On a chart, a day of these is', 'agg', field.agg || 'sum',
        AGGREGATIONS.map((a) => ({ value: a.value, label: a.label })))}
      <p class="small muted" style="margin:-6px 0 10px">
        <b>Total</b> for something you are accumulating — millilitres, minutes.
        <b>Latest</b> for something you are measuring: three weigh-ins added
        together would say a 7 lb baby weighs 21 lb.
      </p>
    </div>
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
      if (ev.detail.group === 'agg') return;
      const other = ev.detail.group === 'type' ? 'type2' : 'type';
      sheet.querySelector(`[data-meta="${other}"]`).value = ev.detail.value;
      sheet.querySelectorAll(`[data-seg="${other}"]`).forEach((b) =>
        b.setAttribute('aria-pressed', String(b.dataset.value === ev.detail.value)));
      sheet.querySelector('[data-agg-row]').classList
        .toggle('hidden', !['number', 'duration'].includes(ev.detail.value));
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
        // Only meaningful on a quantity, and `sum` is the default, so it is
        // written only when it is neither.
        agg: (['number', 'duration'].includes(type)
          && sheet.querySelector('[data-meta="agg"]').value !== 'sum')
          ? sheet.querySelector('[data-meta="agg"]').value
          : undefined,
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
    <div data-fields>${fieldsHTML(draft, preset.data || {}, config())}</div>
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
          <div class="grow"><b>${esc(u.name)}</b>${u.hasPin ? ' <span class="pill">🔒 PIN</span>' : ''}</div>
          <button class="btn sm" data-act="edit-user" data-id="${esc(u.id)}">Edit</button>
        </div>`).join('')}
      <button class="btn wide" data-act="add-user">➕ Add person</button>

      <div class="section-title">Tracked metrics</div>
      <p class="small muted" style="margin:-4px 4px 10px">
        Tick what you want to keep track of. Unticking hides that card from the
        Track screen, its tile from the overview and its chart from Statistics,
        and drops it from the History filters — nothing already logged is
        deleted, and ticking it again brings everything back.
        <b>Drag ⠿ to reorder</b>: this is the order the cards appear in on the
        Track screen. With the grip focused, ↑ and ↓ do the same thing.
      </p>
      <div data-reorder="types">
        ${(cfg.eventTypes || []).slice().sort((a, b) => (a.order ?? 999) - (b.order ?? 999)).map((t) => `
          <div class="list-item reorder-row" data-reorder-id="${esc(t.id)}"
               style="${toneStyle(t.tone)};${t.archived ? 'opacity:.55' : ''}">
            <button type="button" class="grip" data-grip
              aria-label="Reorder ${esc(t.label)}" title="Drag to reorder, or use the arrow keys">⠿</button>
            <label class="switch" style="padding:0;min-height:auto" title="${t.archived ? 'Not tracked' : 'Tracked'}">
              <input type="checkbox" data-act="toggle-type" data-id="${esc(t.id)}" ${t.archived ? '' : 'checked'}
                     aria-label="Track ${esc(t.label)}">
              <span class="track"></span>
            </label>
            <div style="font-size:1.6rem">${esc(t.emoji)}</div>
            <div class="grow">
              <b>${esc(t.label)}</b>
              <div class="small muted">${t.mode === 'timer' ? '⏱️ timer' : '⚡ one tap'} · ${(t.presets || []).length} button${(t.presets || []).length === 1 ? '' : 's'}${t.archived ? ' · not tracked' : ''}</div>
            </div>
            <button class="btn sm" data-act="edit-type" data-id="${esc(t.id)}">Edit</button>
          </div>`).join('')}
      </div>
      <button class="btn wide" data-act="add-type">➕ New button</button>

      ${nutritionCard(cfg)}

      ${statsCard(cfg)}

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
        ${switchRow('Vibration', 'Buzz on tap where supported', 'haptics', s.haptics !== false)}
        ${switchRow('Confirm before delete', 'Ask before removing an entry', 'confirmDelete', s.confirmDelete !== false)}
      </div>

      <div class="section-title">Data</div>
      <div class="card">
        <p class="small muted" style="margin-top:0">
          ${state.data?.totalEvents ?? 0} entries stored as plain text on the server
          (<code>data/events.log</code> and <code>data/config.json</code>). Everything survives a restart.
        </p>
        <div class="btn-stack">
          <button class="btn wide stacked" data-act="export">⬇️ Export CSV<span class="small muted">Entries only, for a spreadsheet</span></button>
          <button class="btn wide stacked" data-act="backup">🗜️ Download backup<span class="small muted">Everything, compressed, for safekeeping</span></button>
          <button class="btn wide stacked" data-act="restore">♻️ Restore from backup<span class="small muted">Replaces everything on the server</span></button>
        </div>
        <p class="small muted" style="margin-bottom:0">
          A backup holds babies, people, buttons, alarms and every entry — including
          PIN hashes. Keep it as private as the data folder itself.
        </p>
      </div>

      ${autoBackupCard(cfg)}

      ${aboutCard()}
    </div>`;
}

/* ----------------------------------------------------------- auto-backup */

const BACKUP_EVERY = [[24, 'Daily'], [24 * 7, 'Weekly']];
const BACKUP_KEEP = [7, 14, 30];

/** Defaults for a config saved before the block existed. */
const backupCfg = (cfg) => ({
  enabled: cfg.backup?.enabled === true,
  everyHours: cfg.backup?.everyHours ?? 24,
  keep: cfg.backup?.keep ?? 14,
});

/**
 * Scheduled backups, written by the server rather than by this page.
 *
 * The card is the remote control; lib/autobackup.js does the work and answers
 * for it. Where the copies go is deliberately not editable from here: a path on
 * the server is not something a browser can browse, and `BT_BACKUP_DIR` belongs
 * with the rest of the deployment rather than in a config a restore would carry
 * onto a machine where it means nothing.
 */
function autoBackupCard(cfg) {
  if (!autoBackup.available) return '';

  const b = backupCfg(cfg);
  const st = state.backup.status;
  const folder = st?.folder || 'data/backups';
  const last = st?.lastRunAt ? new Date(st.lastRunAt) : null;
  const lastLine = st?.lastError
    ? `<span style="color:var(--danger)">⚠️ ${esc(st.lastError)}</span>`
    : last
      ? `Last backup ${esc(last.toLocaleString())}${st.lastFile ? ` · <code>${esc(st.lastFile)}</code>` : ''}`
      : 'No backup written yet.';

  return `
    <div class="section-title">Automatic backup</div>
    <div class="card">
      ${switchRow(
        'Back up on its own',
        b.enabled ? `Every ${b.everyHours >= 168 ? 'week' : 'day'} into ${folder}` : 'Off — nothing is written',
        'backup.enabled',
        b.enabled,
      )}

      ${b.enabled ? `
        <p class="small muted">
          The server checks every quarter of an hour and writes one when it is
          due, whether or not anybody has this page open. It is the same file
          <b>Download backup</b> produces, so either one restores anywhere.
        </p>

        <label class="field"><span class="lab">Folder</span>
          <div class="list-item" style="margin:0">
            <div style="font-size:1.4rem">${st?.usingFolder ? '🗂️' : '📁'}</div>
            <div class="grow" style="min-width:0">
              <b style="overflow-wrap:anywhere">${esc(folder)}</b>
              <div class="small muted">${st?.usingFolder
                ? 'From BT_BACKUP_DIR — a mount or a synced folder, so the copies leave this machine'
                : 'The default, beside the data folder. Set BT_BACKUP_DIR to write somewhere that outlives this machine'}</div>
            </div>
          </div>
        </label>

        <label class="field"><span class="lab">How often</span>
          <div class="seg">
            ${BACKUP_EVERY.map(([hours, l]) => `
              <button data-act="backup-every" data-value="${hours}" aria-pressed="${b.everyHours === hours}">${l}</button>`).join('')}
          </div>
        </label>

        <label class="field"><span class="lab">Keep the newest</span>
          <div class="seg">
            ${BACKUP_KEEP.map((n) => `
              <button data-act="backup-keep" data-value="${n}" aria-pressed="${b.keep === n}">${n}</button>`).join('')}
          </div>
        </label>
        <p class="small muted">Older ones are deleted, and only files this app
        wrote are ever touched — a folder you keep other things in is safe.</p>

        <p class="small muted">${lastLine}</p>
        <button class="btn wide" data-act="backup-run" ${state.backup.busy ? 'disabled' : ''}>
          ${state.backup.busy ? 'Backing up…' : '🗜️ Back up now'}</button>
      ` : ''}
    </div>
`;
}

/** Pull the server's status and redraw. Called on mount and after a change. */
export async function refreshBackupStatus() {
  if (!autoBackup.available) return;
  state.backup.loaded = true;
  try {
    state.backup.status = await autoBackup.status();
  } catch (err) {
    state.backup.status = null;
    console.warn('[backup status]', err.message);
  }
  render();
}

/** "Back up now", with the button showing that it is working. */
export async function runBackupNow() {
  state.backup.busy = true;
  render();
  try {
    const st = await autoBackup.now();
    state.backup.status = st;
    if (st?.ok) {
      sound.play('success');
      toast({ icon: '🗜️', text: `Backed up to ${st.folder}`, tone: 'mint' });
    } else {
      sound.play('error');
      toast({ icon: '⚠️', text: st?.lastError || 'Backup failed', tone: 'peach', ms: 7000 });
    }
  } catch (err) {
    sound.play('error');
    toast({ icon: '⚠️', text: err.message, tone: 'peach', ms: 7000 });
  } finally {
    state.backup.busy = false;
    render();
  }
}

/* ------------------------------------------------------------ statistics */

/**
 * Which history charts the Statistics screen draws.
 *
 * A metric nobody is tracking has no chart to switch, so its row says what it
 * is waiting for and the switch is disabled rather than quietly doing nothing.
 * The nutrient charts have their own list under Nutrition and are not repeated
 * here.
 */
function statsCard(cfg) {
  const on = { ...trackedMetrics(cfg), sides: activeTypes(cfg).some(supportsSides) };
  const want = cfg.stats?.charts || {};
  const rows = [
    { key: 'intake', label: 'Milk in', hint: 'cc per day from measured feeds', on: on.feeds, needs: 'a feed button' },
    { key: 'feeds', label: 'Feeds', hint: 'How often, measured or not', on: on.feeds, needs: 'a feed button' },
    { key: 'diapers', label: 'Diapers', hint: 'Wet and dirty side by side', on: on.diapers, needs: 'the diaper button' },
    { key: 'sleep', label: 'Sleep', hint: 'Hours from timed sleeps', on: on.sleep, needs: 'the sleep button' },
    { key: 'pump', label: 'Pumped', hint: 'cc expressed per day', on: on.pump, needs: 'the pump button' },
    { key: 'clock', label: 'When feeds happen', hint: 'Every feed by hour of the day', on: on.feeds, needs: 'a feed button' },
    { key: 'sides', label: 'Nursing by side', hint: 'Left against right, in minutes', on: on.sides, needs: 'a nursing button with a Left/Right choice' },
  ];

  return `
    <div class="section-title">Statistics</div>
    <div class="card">
      <p class="small muted" style="margin-top:0">
        Which charts the Stats screen draws. Switching one off hides the drawing
        and nothing else — the entries behind it are untouched and the headline
        tiles stay. Which nutrient charts appear follows
        <b>Nutrition → Show these nutrients</b>.
      </p>
      ${rows.map((r) => (r.on
        ? switchRow(r.label, r.hint, `stats.charts.${r.key}`, want[r.key] !== false)
        : `<label class="switch" style="opacity:.55">
            <input type="checkbox" disabled ${want[r.key] !== false ? 'checked' : ''}>
            <span class="track"></span>
            <span class="txt"><b>${esc(r.label)}</b>
              <span class="small muted">Needs ${esc(r.needs)} under Tracked metrics</span></span>
          </label>`)).join('')}
    </div>
    ${customChartsCard(cfg)}`;
}

/**
 * A chart for every button that has not got one written by hand.
 *
 * The rows come from each button's own fields, so a button invented this
 * morning is listed here this morning. Buttons you made yourself arrive
 * ticked; the ones that ship with the app arrive unticked, so nobody who never
 * came to this screen finds it has grown three charts of bath times.
 */
function customChartsCard(cfg) {
  const groups = customChartTypes(cfg);
  if (!groups.length) return '';

  return `
    <div class="section-title">Charts from your own buttons</div>
    <div class="card">
      <p class="small muted" style="margin-top:0">
        Every button that has no chart of its own can have one built from the
        fields it records — a number is added up, a duration is totalled, a
        yes/no is counted. Nothing here changes what is recorded.
      </p>
      ${groups.map(({ type, metrics }) => `
        <div class="section-title" style="margin-left:0;font-size:0.8rem">${esc(type.emoji)} ${esc(type.label)}</div>
        ${metrics.map((m) => switchRow(
          // "Entries per day" rather than "How many <label> a day", which needs
          // a plural this has no way to form: "How many bath a day".
          m.kind === 'count' ? 'Entries per day' : m.label,
          {
            count: 'One column per day, counting every entry',
            toggle: `How many entries had "${m.label}" ticked`,
            duration: 'Minutes recorded, added up',
            sum: `Added up${m.unit ? ` · ${m.unit}` : ''}`,
          }[m.kind],
          `stats.buttons.${type.id}.${m.key}`,
          customChartOn(cfg, type, m.key),
        )).join('')}
        ${(type.fields || []).some((f) => f.type === 'select' || f.type === 'color') ? `
          <p class="small muted" style="margin:2px 0 10px">
            Its choice and colour fields are not in this list. Charting one means
            a colour per option, and the chart palette here has two — stepped for
            light and dark and checked for colour-vision deficiency — so those
            stay in the entries and the CSV rather than being drawn in colours
            nobody has checked.
          </p>` : ''}
      `).join('')}
    </div>`;
}

/* --------------------------------------------------------- drag to reorder */

/**
 * Drag-to-reorder for a list of rows carrying `data-reorder-id`.
 *
 * Pointer events rather than HTML5 drag-and-drop, which does not fire on touch
 * at all - and this list is used on a phone more than anywhere else. The grip
 * takes `touch-action: none` in the stylesheet so dragging it does not scroll
 * the page underneath. Arrow keys on a focused grip move the row one place, so
 * the order is reachable without a pointer at all.
 *
 * `commit` is handed the new order of ids, and the id to put focus back on when
 * the keyboard did the moving - saving re-renders the whole screen.
 */
function enableReorder(list, commit) {
  const ROW = '.reorder-row';
  const order = () => [...list.querySelectorAll(ROW)].map((r) => r.dataset.reorderId);
  let drag = null;

  /** Keep the dragged row under the pointer, wherever the DOM has moved it to. */
  const paint = (clientY) => {
    drag.row.style.transform = '';
    const natural = drag.row.getBoundingClientRect().top;
    drag.row.style.transform = `translateY(${(clientY - drag.grab - natural).toFixed(1)}px)`;
  };

  /** Step past any neighbour whose midpoint the dragged row has crossed. */
  const settle = (clientY) => {
    for (let guard = 0; guard < 40; guard += 1) {
      paint(clientY);
      const box = drag.row.getBoundingClientRect();
      const prev = drag.row.previousElementSibling;
      if (prev?.matches(ROW)) {
        const p = prev.getBoundingClientRect();
        if (box.top < p.top + p.height / 2) { list.insertBefore(drag.row, prev); continue; }
      }
      const next = drag.row.nextElementSibling;
      if (next?.matches(ROW)) {
        const n = next.getBoundingClientRect();
        if (box.bottom > n.top + n.height / 2) { list.insertBefore(next, drag.row); continue; }
      }
      return;
    }
  };

  list.addEventListener('pointerdown', (ev) => {
    const grip = ev.target.closest('[data-grip]');
    if (!grip || ev.button > 0) return;
    const row = grip.closest(ROW);
    if (!row) return;
    ev.preventDefault();
    grip.setPointerCapture(ev.pointerId);
    drag = {
      row, id: ev.pointerId, from: order(),
      grab: ev.clientY - row.getBoundingClientRect().top,
    };
    row.classList.add('dragging');
    list.classList.add('reordering');
  });

  list.addEventListener('pointermove', (ev) => {
    if (!drag || ev.pointerId !== drag.id) return;
    ev.preventDefault();
    settle(ev.clientY);
  });

  const drop = (ev) => {
    if (!drag || ev.pointerId !== drag.id) return;
    const { row, from } = drag;
    drag = null;
    row.style.transform = '';
    row.classList.remove('dragging');
    list.classList.remove('reordering');
    const now = order();
    if (now.join() !== from.join()) commit(now, null);
  };
  list.addEventListener('pointerup', drop);
  list.addEventListener('pointercancel', drop);

  list.addEventListener('keydown', (ev) => {
    const grip = ev.target.closest('[data-grip]');
    if (!grip || (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown')) return;
    const row = grip.closest(ROW);
    const up = ev.key === 'ArrowUp';
    const mate = up ? row.previousElementSibling : row.nextElementSibling;
    if (!row || !mate?.matches(ROW)) return;
    ev.preventDefault();
    if (up) list.insertBefore(row, mate); else list.insertBefore(mate, row);
    commit(order(), row.dataset.reorderId);
  });
}

/* ------------------------------------------------------------- nutrition */

/**
 * Setup -> Nutrition. The milk profiles hold label values per 100 mL, so an
 * entry's recorded cc is all it takes to work out what actually went in.
 */
function nutritionCard(cfg) {
  const n = cfg.nutrition || {};
  const milks = n.milks || [];
  const on = nutritionOn(cfg);
  const shown = new Set(n.show || []);
  const fallback = milkById(cfg, n.defaultMilkId);

  return `
    <div class="section-title">Nutrition</div>
    <div class="card">
      ${switchRow('Track nutritional intake', 'Work out nutrients from the cc you log', 'nutrition.enabled', n.enabled !== false)}
      ${on ? `
        <label class="field"><span class="lab">Assume this when nothing is picked</span>
          <div class="preset-row" role="group" aria-label="Default milk">
            ${enabledMilks(cfg).map((m) => `
              <button type="button" class="btn sm" data-act="set-default-milk" data-id="${esc(m.id)}"
                aria-pressed="${m.id === n.defaultMilkId}"
                style="${m.id === n.defaultMilkId ? 'border-color:var(--pink);background:color-mix(in srgb,var(--pink) 22%,var(--surface-2))' : ''}">${esc(m.emoji || '🍼')} ${esc(m.name)}</button>`).join('')}
          </div>
          <span class="small muted">A bottle logged without picking anything counts as
          ${esc(fallback ? fallback.name : 'the first profile')}. Breastfeeds always count as breast milk.</span>
        </label>

        <label class="field"><span class="lab">Show these nutrients</span>
          <div class="nutrient-grid">
            ${NUTRIENTS.map((x) => `
              <label class="chk">
                <input type="checkbox" data-act="toggle-nutrient" data-key="${esc(x.key)}" ${shown.has(x.key) ? 'checked' : ''}>
                <span>${esc(x.emoji)} ${esc(x.label)} <span class="muted">${esc(x.unit)}</span></span>
              </label>`).join('')}
          </div>
        </label>
      ` : ''}
    </div>

    ${on ? `
      <p class="small muted" style="margin:0 4px 10px">
        Untick anything you are not using and it stops being offered on the
        Bottle card and in the default picker above. Entries that already name
        it keep their numbers, so a tin you have finished can be put away
        without rewriting a single feed.
      </p>
      ${milks.map((m) => `
        <div class="list-item" style="${milkEnabled(m) ? '' : 'opacity:.55'}">
          <label class="switch" style="padding:0;min-height:auto" title="${milkEnabled(m) ? 'Offered' : 'Not offered'}">
            <input type="checkbox" data-act="toggle-milk" data-id="${esc(m.id)}" ${milkEnabled(m) ? 'checked' : ''}
                   aria-label="Offer ${esc(m.name)}">
            <span class="track"></span>
          </label>
          <div style="font-size:1.6rem">${esc(m.emoji || '🍼')}</div>
          <div class="grow">
            <b>${esc(m.name)}</b>${m.id === cfg.nutrition.defaultMilkId ? ' <span class="pill">default</span>' : ''}
            <div class="small muted">${milkSummary(m)}${milkEnabled(m) ? '' : ' · not offered'}</div>
          </div>
          <button class="btn sm" data-act="edit-milk" data-id="${esc(m.id)}">Edit</button>
        </div>`).join('')}
      <button class="btn wide" data-act="add-milk">➕ Add a milk or formula</button>
      <p class="small muted" style="margin:10px 4px 0">
        The profiles that ship with the app are label values, rounded, and no
        substitute for the tin in your kitchen — brands reformulate, and a
        European stage 1 is not the same as its American cousin. Open any of
        them and correct the numbers against the panel you actually have.
      </p>
    ` : ''}`;
}

/** Add or edit one milk profile. Every nutrient is per 100 mL of prepared milk. */
export function openMilkSheet(milkId = null) {
  const cfg = config();
  const milk = milkById(cfg, milkId) || {
    id: null, name: '', emoji: '🍼', kind: 'formula', per100: {},
  };

  openSheet(`
    <h3>${milk.id ? 'Edit milk' : 'Add a milk'}</h3>
    <label class="field"><span class="lab">Name</span>
      <input type="text" data-meta="name" value="${esc(milk.name)}" placeholder="Bobbie Organic Original">
    </label>
    <label class="field"><span class="lab">Icon</span>${emojiPicker('emoji', milk.emoji || '🍼', ['🍼', '🤱', '🌿', '🥛', '🧴', '⭐'])}</label>
    ${segField('Kind', 'kind', milk.kind || 'formula', MILK_KINDS)}

    <div class="section-title" style="margin-left:0">Nutrition panel</div>
    ${segField('How your label states them', 'basis', 'ml', [
      { value: 'ml', label: 'per 100 mL' },
      { value: 'kcal', label: 'per 100 Cal' },
      { value: 'bottle', label: 'per 5 fl oz' },
    ])}
    <p class="small muted" style="margin:-6px 0 10px" data-basis-hint>
      Copy the numbers straight off the panel. Leave anything you do not care
      about blank.
    </p>

    <label class="field hidden" data-kcal-row>
      <span class="lab">Calories per fl oz</span>
      <div class="row">
        <input type="number" data-meta="kcalPerOz" inputmode="decimal" min="1" max="60" step="0.5" value="20">
        <span class="muted small">Cal / fl oz</span>
      </div>
      <span class="small muted">Printed near the top of the panel — 20 for most
      standard-dilution infant formulas. Everything below is scaled by it.</span>
    </label>

    ${NUTRIENTS.map((x) => `
      <label class="field" ${x.key === 'kcal' ? 'data-energy-row' : ''}>
        <span class="lab">${esc(x.emoji)} ${esc(x.label)}</span>
        <div class="row">
          <input type="number" data-per100="${esc(x.key)}" inputmode="decimal" min="0" step="0.01"
                 value="${esc(milk.per100?.[x.key] ?? '')}" placeholder="0">
          <span class="muted small" data-unit="${esc(x.key)}">${esc(x.unit)}</span>
        </div>
      </label>`).join('')}
    <p class="small muted" data-converted hidden></p>

    <div class="sheet-actions">
      <button class="btn" data-close type="button">Cancel</button>
      <button class="btn primary" data-save type="button">Save</button>
    </div>
    ${milk.id ? '<button class="btn danger wide" data-delete type="button" style="margin-top:10px">Delete this profile</button>' : ''}
  `, (sheet) => {
    wirePickers(sheet);

    const basisInput = sheet.querySelector('[data-meta="basis"]');
    const kcalRow = sheet.querySelector('[data-kcal-row]');
    const energyRow = sheet.querySelector('[data-energy-row]');
    const hint = sheet.querySelector('[data-basis-hint]');
    const preview = sheet.querySelector('[data-converted]');

    // What a US label means by one bottle: "each 5 fl oz (150 mL) contains 100
    // Calories". The label's own rounding of 5 fl oz, and the number to divide
    // its per-100-Calorie column by.
    const BOTTLE_ML = 150;

    /** Prepared kcal per 100 mL, whichever way the label got there. */
    const kcalPer100ml = () => {
      if (basisInput.value === 'bottle') return (100 / BOTTLE_ML) * 100;
      const perOz = Number(sheet.querySelector('[data-meta="kcalPerOz"]').value) || 20;
      return (perOz / 29.5735) * 100;
    };

    /**
     * Everything is stored per 100 mL.
     *
     * A US panel states nutrients per 100 Calories, so those get scaled by
     * kcal-per-100-mL / 100 on the way in - the step that, done by hand and
     * forgotten, overstates a formula's iron and DHA by about half. The
     * per-bottle basis is the same column read through the label's own
     * equivalence, which makes the factor exactly 100/150.
     *
     * Vitamin D is the other trap: a per-100-Calorie panel prints it in IU
     * where a per-100-mL one prints micrograms, so a label basis divides by 40.
     */
    const readPer100 = () => {
      const perLabel = basisInput.value !== 'ml';
      const energy = perLabel ? kcalPer100ml() : null;
      const factor = perLabel ? energy / 100 : 1;
      const out = {};
      sheet.querySelectorAll('[data-per100]').forEach((el) => {
        const key = el.dataset.per100;
        if (perLabel && key === 'kcal') return;     // 100 per 100 Cal, by definition
        if (el.value === '') return;
        let value = Number(el.value) * factor;
        if (perLabel && key === 'vitaminD') value /= 40;
        out[key] = Math.round(value * 1000) / 1000;
      });
      if (perLabel) out.kcal = Math.round(energy * 10) / 10;
      return out;
    };

    const HINTS = {
      ml: 'Copy the numbers straight off the panel. Leave anything you do not care about blank.',
      kcal: 'US labels state everything per 100 Calories. Type the numbers exactly as printed — this converts them to per 100 mL for you, vitamin D from IU included.',
      bottle: 'For a label that says "diluted: each 5 fl oz (150 mL) contains 100 calories" — one bottle is one 100-Calorie column. Type the numbers exactly as printed; they are stored per 100 mL, and each feed is worked out from the cc you log.',
    };

    const paint = () => {
      const basis = basisInput.value;
      const perLabel = basis !== 'ml';
      kcalRow.classList.toggle('hidden', basis !== 'kcal');
      energyRow.classList.toggle('hidden', perLabel);
      hint.textContent = HINTS[basis] || HINTS.ml;
      // A per-100-Calorie panel prints vitamin D in IU; say so on the field.
      const vitD = sheet.querySelector('[data-unit="vitaminD"]');
      if (vitD) vitD.textContent = perLabel ? 'IU' : 'µg';
      const per100 = readPer100();
      preview.hidden = !perLabel;
      if (perLabel) {
        preview.textContent = `Stored as ${per100.kcal ?? '—'} kcal, ${per100.iron ?? '—'} mg iron, `
          + `${per100.vitaminD ?? '—'} µg vitamin D and ${per100.dha ?? '—'} mg DHA per 100 mL.`;
      }
    };

    // Switching basis re-reads numbers that meant something else a moment ago,
    // so clear them rather than silently rescaling what is already there.
    sheet.addEventListener('seg-change', (ev) => {
      if (ev.detail.group !== 'basis') return;
      sheet.querySelectorAll('[data-per100]').forEach((el) => { el.value = ''; });
      paint();
    });
    sheet.addEventListener('input', paint);
    paint();

    sheet.querySelector('[data-save]').addEventListener('click', async () => {
      const name = sheet.querySelector('[data-meta="name"]').value.trim();
      if (!name) return toast({ icon: '✏️', text: 'Give the milk a name', tone: 'peach' });
      const per100 = readPer100();
      const next = {
        id: milk.id || uid('m'),
        name,
        emoji: sheet.querySelector('[data-meta="emoji"]').value || '🍼',
        kind: sheet.querySelector('[data-meta="kind"]').value,
        builtin: !!milk.builtin,
        enabled: milkEnabled(milk),
        per100,
      };
      closeSheet();
      await saveConfig((draftCfg) => {
        const list = draftCfg.nutrition.milks;
        const i = list.findIndex((m) => m.id === next.id);
        if (i >= 0) list[i] = next;
        else list.push(next);
      });
      sound.play('success');
      toast({ icon: next.emoji, text: `<b>${esc(name)}</b> saved`, tone: 'mint' });
    });

    sheet.querySelector('[data-delete]')?.addEventListener('click', async () => {
      const cfgNow = config();
      if ((cfgNow.nutrition.milks || []).length <= 1) {
        return toast({ icon: '🍼', text: 'Keep at least one milk profile', tone: 'peach' });
      }
      if (!confirm(`Remove ${milk.name}? Entries that named it keep the name in the log.`)) return;
      closeSheet();
      await saveConfig((draftCfg) => {
        draftCfg.nutrition.milks = draftCfg.nutrition.milks.filter((m) => m.id !== milk.id);
        if (draftCfg.nutrition.defaultMilkId === milk.id) {
          draftCfg.nutrition.defaultMilkId = draftCfg.nutrition.milks[0]?.id || null;
        }
      });
    });
  });
}

/** The About card that closes the Setup screen. */
function aboutCard() {
  const app = state.data?.app || {};
  const repo = app.repository || '';
  const readme = app.homepage || (repo ? `${repo}#readme` : '');
  const author = app.author || null;

  return `
    <div class="section-title">About</div>
    <div class="card about">
      <div class="row" style="gap:14px">
        <div class="about-logo">🍼</div>
        <div class="grow" style="flex:1;min-width:0">
          <h2 style="font-size:1.15rem">${esc(app.name || 'Ultimate Baby Tracker')}</h2>
          <div class="small muted">Version ${esc(app.version || '—')}${app.license ? ` · ${esc(app.license)} licence` : ''}</div>
        </div>
      </div>

      <p class="small muted">One-tap tracking for feeds, diapers, sleep and anything else worth
      remembering — built to be usable with one thumb at three in the morning.</p>

      <div class="about-links">
        ${repo ? `<a class="btn wide" href="${esc(repo)}" target="_blank" rel="noreferrer noopener">📦 Source code<span class="small muted">${esc(repo.replace(/^https?:\/\//, ''))}</span></a>` : ''}
        ${readme ? `<a class="btn wide" href="${esc(readme)}" target="_blank" rel="noreferrer noopener">📖 Read the docs<span class="small muted">Setup, alarms, custom buttons, API</span></a>` : ''}
        ${author?.name ? (author.url
          ? `<a class="btn wide" href="${esc(author.url)}" target="_blank" rel="noreferrer noopener">👤 ${esc(author.name)}<span class="small muted">Author</span></a>`
          : `<div class="btn wide">👤 ${esc(author.name)}<span class="small muted">Author</span></div>`) : ''}
      </div>

      <div class="notice">
        <b>🔓 No authentication or encryption.</b>
        This app has none and was never designed to have any — the 4-digit profile
        PINs only stop entries being logged under the wrong name. Run it behind a
        reverse proxy on a segmented network, never exposed to the internet.
      </div>

      <p class="center small muted" style="margin:14px 0 0">Made with 🍼 and very little sleep.</p>
    </div>`;
}

/**
 * Where a toggle writes. A bare name is a key under `settings` (the common
 * case); a dotted one is a path from the root of the config, so a switch can
 * reach somewhere like `nutrition.enabled`.
 */
function writeSetting(cfg, name, value) {
  if (!name.includes('.')) {
    cfg.settings[name] = value;
    return;
  }
  const parts = name.split('.');
  let node = cfg;
  for (const part of parts.slice(0, -1)) {
    if (!node[part] || typeof node[part] !== 'object') node[part] = {};
    node = node[part];
  }
  node[parts[parts.length - 1]] = value;
}

/** Settings toggles/sliders are wired once, on the delegated container. */
export function wireSetup(root) {
  if (!state.backup.loaded) refreshBackupStatus();

  const list = root.querySelector('[data-reorder="types"]');
  if (list) {
    enableReorder(list, async (ids, focusId) => {
      await saveConfig((cfg) => {
        // Tens, so a hand-edited config.json still has room between two cards.
        ids.forEach((id, i) => {
          const t = cfg.eventTypes.find((x) => x.id === id);
          if (t) t.order = (i + 1) * 10;
        });
      });
      sound.play('pop');
      if (focusId) root.querySelector(`[data-reorder-id="${CSS.escape(focusId)}"] [data-grip]`)?.focus();
    });
  }

  root.querySelectorAll('[data-setting]').forEach((el) => {
    el.addEventListener('change', () => {
      saveConfig((cfg) => writeSetting(cfg, el.dataset.setting, el.checked));
      if (el.dataset.setting === 'sound' && el.checked) sound.play('chime');
      // Switching auto-backup on should write one straight away, so "is this
      // working?" is answered on the screen that asked rather than tomorrow.
      if (el.dataset.setting === 'backup.enabled') {
        if (el.checked) runBackupNow(); else refreshBackupStatus();
      }
    });
  });
  root.querySelectorAll('[data-setting-range]').forEach((el) => {
    el.addEventListener('change', () => {
      saveConfig((cfg) => writeSetting(cfg, el.dataset.settingRange, Number(el.value)));
      sound.play('ding');
    });
  });
}

export async function exportCSV() {
  window.location.href = `/api/export.csv?babyId=${encodeURIComponent(state.babyId || 'all')}`;
}

/* ------------------------------------------------------------------ backup */

export function downloadBackup() {
  window.location.href = '/api/backup';
  toast({ icon: '🗜️', text: 'Backup downloading…', tone: 'sky' });
}

function fileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Ask for a file, look inside it on the server, then confirm before replacing. */
export function restoreBackup() {
  const picker = document.createElement('input');
  picker.type = 'file';
  picker.accept = '.gz,.json,application/gzip,application/json';
  picker.addEventListener('change', async () => {
    const file = picker.files?.[0];
    if (!file) return;
    try {
      const { summary } = await api.restore(file, { dryRun: true });
      openRestoreSheet(file, summary);
    } catch (err) {
      sound.play('error');
      toast({ icon: '⚠️', text: err.message, tone: 'peach', ms: 7000 });
    }
  });
  picker.click();
}

function openRestoreSheet(file, summary) {
  const when = summary.exportedAt
    ? new Date(summary.exportedAt).toLocaleString()
    : 'an unknown date';
  const rows = [
    ['Entries', summary.events],
    ['Babies', summary.babies],
    ['People', `${summary.users}${summary.pins ? ` (${summary.pins} with a PIN)` : ''}`],
    ['Buttons', summary.eventTypes],
    ['Alarms', summary.alarms],
    ...(summary.milks ? [['Milk profiles', summary.milks]] : []),
  ];

  const sheet = openSheet(`
    <h3>♻️ Restore this backup?</h3>
    <p class="small muted" style="margin-top:0">
      <b>${esc(file.name)}</b> · ${esc(fileSize(file.size))} · taken ${esc(when)}
      ${summary.appVersion ? ` · app v${esc(summary.appVersion)}` : ''}
    </p>
    <div class="card" style="margin:0 0 12px">
      ${rows.map(([k, v]) => `
        <div class="row" style="justify-content:space-between">
          <span class="small muted">${esc(k)}</span><b>${esc(String(v))}</b>
        </div>`).join('')}
      ${summary.skipped ? `<div class="small muted">${summary.skipped} unreadable entr${summary.skipped === 1 ? 'y' : 'ies'} will be skipped.</div>` : ''}
    </div>
    <div class="notice">
      <b>This replaces everything currently on the server</b> — entries, babies,
      people, buttons, alarms and PINs. The current data is saved to a
      <code>pre-restore-….json</code> file in the data folder first.
    </div>
    <div class="row" style="margin-top:14px">
      <button class="btn wide" data-close>Cancel</button>
      <button class="btn primary wide" data-restore-go>Restore</button>
    </div>`);

  sheet.querySelector('[data-restore-go]').addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Restoring…';
    try {
      const { summary: done } = await api.restore(file);
      closeSheet();
      await refresh();
      sound.play('success');
      toast({ icon: '♻️', text: `Restored ${done.events} entries`, tone: 'mint' });
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Restore';
      sound.play('error');
      toast({ icon: '⚠️', text: err.message, tone: 'peach', ms: 7000 });
    }
  });
}
