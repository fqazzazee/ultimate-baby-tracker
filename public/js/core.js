/**
 * App core: shared state, server sync, user feedback (sound/visual/haptic),
 * the bottom-sheet framework, and the logging actions the views call.
 */

import { api } from './api.js';
import * as sound from './sound.js';
import {
  $, esc, store, setTimeFormat, toLocalInput, fromLocalInput,
} from './util.js';
import {
  typeOf, userOf, babyOf, toneStyle, fieldsHTML, collectFields, wireFieldControls,
} from './ui.js';

export const state = {
  data: null,                                   // last /api/state payload
  babyId: store.get('babyId', null),
  userId: store.get('userId', null),
  tab: store.get('tab', 'track'),
  historyType: 'all',
  historyDays: 7,
  statsDays: store.get('statsDays', 14),
  // The nutrition card on Track reads a rolling window rather than the calendar
  // day, and a month of it is more than /api/state carries - so, like the
  // Statistics screen, it keeps its own slice of the log.
  nutritionHours: store.get('nutritionHours', 24),
  nutrition: { key: null, hours: 24, events: [], loading: true, error: null },
  // The Statistics screen reads a longer window than /api/state carries, so it
  // keeps its own slice of the log, fetched only while that tab is open.
  stats: { days: 0, events: [], loading: true, error: null },
  connected: true,
  ringingKey: null,
};

let renderFn = () => {};
export function setRenderer(fn) { renderFn = fn; }
export function render() { renderFn(); }

export const config = () => state.data?.config || { babies: [], users: [], eventTypes: [], alarms: [], settings: {} };
export const settings = () => config().settings || {};
export const currentBaby = () => babyOf(config(), state.babyId);
export const currentUser = () => userOf(config(), state.userId);

/* --------------------------------------------------------------- server sync */

let refreshing = null;

/**
 * Work that has to follow a successful refresh but cannot live in this module -
 * the Statistics screen fetches its own, longer slice of the log, and importing
 * it here would close an import cycle. app.js registers it at boot.
 */
const afterRefresh = [];
export function onRefresh(fn) { afterRefresh.push(fn); }

export async function refresh() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const data = await api.state(state.babyId || 'all', state.historyDays);
      state.data = data;
      state.connected = true;
      reconcileSelections();
      applySettings();
      for (const fn of afterRefresh) {
        try { await fn(); } catch (err) { console.warn('[refresh hook]', err.message); }
      }
      render();
    } catch (err) {
      state.connected = false;
      console.warn('[refresh]', err.message);
      render();
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/** Keep the selected baby/person pointing at something that still exists. */
function reconcileSelections() {
  const cfg = config();
  if (!cfg.babies.some((b) => b.id === state.babyId)) {
    state.babyId = cfg.babies[0]?.id || null;
    store.set('babyId', state.babyId);
  }
  if (!cfg.users.some((u) => u.id === state.userId)) {
    state.userId = cfg.users[0]?.id || null;
    store.set('userId', state.userId);
  }
}

function applySettings() {
  const s = settings();
  sound.configure({ sound: s.sound !== false, volume: s.volume ?? 0.6 });
  setTimeFormat(s.timeFormat || '12h');
  applyTheme(s.theme || 'auto');
}

/** Persist a config change. `mutate` receives a deep copy to edit in place. */
export async function saveConfig(mutate) {
  const next = structuredClone(config());
  mutate(next);
  state.data = { ...state.data, config: next }; // optimistic
  applySettings();
  render();
  try {
    await api.saveConfig(next);
  } catch (err) {
    toast({ icon: '⚠️', text: `Could not save: ${err.message}`, tone: 'peach' });
  }
  return refresh();
}

/* ---------------------------------------------------------------- theming */

let themeMedia = null;

export function applyTheme(pref) {
  const resolve = () => {
    if (pref === 'light' || pref === 'dark') return pref;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  };
  document.documentElement.dataset.theme = resolve();
  const meta = $('meta[name="theme-color"]');
  if (meta) {
    meta.content = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#fdf7f4';
  }
  if (!themeMedia && window.matchMedia) {
    themeMedia = window.matchMedia('(prefers-color-scheme: dark)');
    themeMedia.addEventListener('change', () => {
      if ((settings().theme || 'auto') === 'auto') applyTheme('auto');
    });
  }
}

/* ----------------------------------------------------------- profile locks */

/**
 * A person may protect their profile with a 4-digit PIN so entries are not
 * logged under their name by accident. An unlock lasts for the browser tab's
 * session; closing the tab re-locks it.
 */
const UNLOCK_KEY = 'bt.unlocked';

function unlockedIds() {
  try { return JSON.parse(sessionStorage.getItem(UNLOCK_KEY) || '[]'); } catch { return []; }
}

function writeUnlocked(ids) {
  try { sessionStorage.setItem(UNLOCK_KEY, JSON.stringify(ids)); } catch { /* private mode */ }
}

/** True when this profile needs no PIN, or has already been unlocked here. */
export function isUnlocked(userId) {
  const user = (config().users || []).find((u) => u.id === userId);
  if (!user || !user.hasPin) return true;
  return unlockedIds().includes(userId);
}

export function markUnlocked(userId) {
  const ids = unlockedIds();
  if (!ids.includes(userId)) writeUnlocked([...ids, userId]);
}

export function lockProfile(userId) {
  writeUnlocked(unlockedIds().filter((id) => id !== userId));
}

/* --------------------------------------------------------------- feedback */

export function toast({ icon = '✅', text, tone = 'mint', actions = [], ms = 5000 }) {
  const host = $('#toasts');
  if (!host) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.style.cssText = toneStyle(tone);
  el.innerHTML = `
    <span class="ico">${esc(icon)}</span>
    <span class="grow" style="flex:1">${text}</span>
    ${actions.map((a, i) => `<button class="btn sm" data-toast-action="${i}">${esc(a.label)}</button>`).join('')}
  `;
  const close = () => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 250);
  };
  el.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-toast-action]');
    if (!btn) return;
    close();
    actions[Number(btn.dataset.toastAction)]?.run();
  });
  host.appendChild(el);
  setTimeout(close, ms);
  return close;
}

/** Big stamped emoji so a tap is unmistakable from across the room. */
export function splash(mark) {
  const el = document.createElement('div');
  el.className = 'splash';
  el.innerHTML = `<div class="mark">${esc(mark)}</div>`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 750);
}

export function feedback({ mark, soundName }) {
  if (mark) splash(mark);
  if (soundName) sound.play(soundName);
  if (settings().haptics !== false) sound.buzz([14, 40, 14]);
}

/* ------------------------------------------------------------------ sheets */

let sheetCleanup = null;

export function openSheet(html, onMount) {
  closeSheet();
  const back = document.createElement('div');
  back.className = 'sheet-backdrop';
  back.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div>`;
  back.addEventListener('click', (ev) => { if (ev.target === back) closeSheet(); });
  document.body.appendChild(back);
  document.body.style.overflow = 'hidden';
  const sheet = back.querySelector('.sheet');
  sheetCleanup = () => {
    sheet.dispatchEvent(new CustomEvent('sheet-closed'));
    back.remove();
    document.body.style.overflow = '';
  };
  onMount?.(sheet);
  sheet.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeSheet));
  return sheet;
}

export function closeSheet() {
  sheetCleanup?.();
  sheetCleanup = null;
}

export function sheetOpen() {
  return sheetCleanup !== null;
}

/* ------------------------------------------------------------ log actions */

/** Defaults declared on the type's fields, used when logging in one tap. */
function defaultsFor(type) {
  const out = {};
  for (const f of type.fields || []) if (f.default !== undefined) out[f.key] = f.default;
  return out;
}

export function runningTimer(typeId) {
  return (state.data?.timers || []).find(
    (t) => t.typeId === typeId && t.babyId === state.babyId,
  ) || null;
}

/**
 * The one-tap path. Instant types log immediately; timer types start (and the
 * second tap stops) a running timer. Everything gives sound + splash + toast.
 */
export async function quickLog(typeId, presetId) {
  const cfg = config();
  const type = typeOf(cfg, typeId);
  const preset = (type.presets || []).find((p) => p.id === presetId) || type.presets?.[0] || { id: null, label: type.label, data: {} };
  const baby = currentBaby();
  const user = currentUser();

  if (!baby) {
    toast({ icon: '👶', text: 'Add a baby first', tone: 'peach' });
    return;
  }

  if (type.mode === 'timer') {
    const running = runningTimer(typeId);
    if (running) return stopRunningTimer(running.id);
    try {
      await api.startTimer({
        babyId: baby.id, userId: user.id, typeId, presetId: preset.id, data: { ...preset.data },
      });
      feedback({ mark: '⏱️', soundName: 'ding' });
      toast({ icon: '⏱️', text: `<b>${esc(type.label)}</b> started${preset.label && preset.label !== type.label ? ` · ${esc(preset.label)}` : ''}`, tone: type.tone });
      await refresh();
    } catch (err) {
      toast({ icon: '⚠️', text: esc(err.message), tone: 'peach' });
    }
    return;
  }

  const data = { ...defaultsFor(type), ...(preset.data || {}) };
  try {
    const { event } = await api.addEvent({
      babyId: baby.id, userId: user.id, typeId, presetId: preset.id, data,
    });
    feedback({ mark: preset.emoji || type.emoji, soundName: type.sound || 'chime' });
    toast({
      icon: preset.emoji || type.emoji,
      text: `<b>${esc(preset.label || type.label)}</b> · ${esc(user.name)} · ${esc(baby.name)}`,
      tone: type.tone,
      actions: [
        { label: 'Details', run: () => openLogSheet({ event }) },
        { label: 'Undo', run: () => undoEvent(event.id) },
      ],
    });
    await refresh();
  } catch (err) {
    sound.play('error');
    toast({ icon: '⚠️', text: esc(err.message), tone: 'peach' });
  }
}

export async function undoEvent(id) {
  try {
    await api.deleteEvent(id);
    sound.play('undo');
    toast({ icon: '↩️', text: 'Removed', tone: 'lavender', ms: 2500 });
    await refresh();
  } catch (err) {
    toast({ icon: '⚠️', text: esc(err.message), tone: 'peach' });
  }
}

export async function stopRunningTimer(id) {
  try {
    const { event } = await api.stopTimer(id, { userId: state.userId });
    const type = typeOf(config(), event.typeId);
    const mins = event.data?.duration ?? 0;
    feedback({ mark: '✅', soundName: 'success' });
    toast({
      icon: type.emoji,
      text: `<b>${esc(type.label)}</b> · ${mins} min`,
      tone: type.tone,
      actions: [{ label: 'Details', run: () => openLogSheet({ event }) }],
    });
    await refresh();
  } catch (err) {
    toast({ icon: '⚠️', text: esc(err.message), tone: 'peach' });
  }
}

export async function cancelRunningTimer(id) {
  await api.cancelTimer(id);
  sound.play('undo');
  await refresh();
}

/**
 * The full editor for one entry - opened from "Details", from a history row,
 * or from the "+ more" button on a card (with `event` omitted for a new one).
 */
export function openLogSheet({ event = null, typeId = null, presetId = null }) {
  const cfg = config();
  const tid = event?.typeId || typeId;
  const type = typeOf(cfg, tid);
  const preset = (type.presets || []).find((p) => p.id === (event?.presetId ?? presetId));
  const data = event?.data || { ...defaultsFor(type), ...(preset?.data || {}) };
  const isNew = !event;
  const chosenUser = event?.userId || state.userId;
  const chosenBaby = event?.babyId || state.babyId;

  const html = `
    <h3>${esc(type.emoji)} ${esc(isNew ? `Log ${type.label}` : `Edit ${type.label}`)}</h3>

    <label class="field">
      <span class="lab">Who</span>
      <div class="preset-row" data-choices="userId">
        ${cfg.users.map((u) => `
          <button type="button" class="btn sm" data-choose="userId" data-value="${esc(u.id)}"
            aria-pressed="${u.id === chosenUser}"
            style="${u.id === chosenUser ? 'border-color:var(--pink);background:color-mix(in srgb,var(--pink) 22%,var(--surface-2))' : ''}">
            ${esc(u.emoji)} ${esc(u.name)}
          </button>`).join('')}
      </div>
      <input type="hidden" data-meta="userId" value="${esc(chosenUser || '')}">
    </label>

    ${cfg.babies.length > 1 ? `
    <label class="field">
      <span class="lab">Baby</span>
      <div class="preset-row" data-choices="babyId">
        ${cfg.babies.map((b) => `
          <button type="button" class="btn sm" data-choose="babyId" data-value="${esc(b.id)}"
            aria-pressed="${b.id === chosenBaby}"
            style="${b.id === chosenBaby ? 'border-color:var(--pink);background:color-mix(in srgb,var(--pink) 22%,var(--surface-2))' : ''}">
            ${esc(b.emoji || '👶')} ${esc(b.name)}
          </button>`).join('')}
      </div>
      <input type="hidden" data-meta="babyId" value="${esc(chosenBaby || '')}">
    </label>` : `<input type="hidden" data-meta="babyId" value="${esc(chosenBaby || '')}">`}

    <label class="field">
      <span class="lab">When</span>
      <input type="datetime-local" data-meta="at" value="${toLocalInput(event?.at)}">
      <div class="preset-row" style="margin-top:8px">
        <button type="button" class="btn sm" data-nudge="-15">−15m</button>
        <button type="button" class="btn sm" data-nudge="-5">−5m</button>
        <button type="button" class="btn sm" data-nudge="now">Now</button>
        <button type="button" class="btn sm" data-nudge="5">+5m</button>
      </div>
    </label>

    <div data-fields>${fieldsHTML(type, data, cfg)}</div>

    <label class="field">
      <span class="lab">Note</span>
      <textarea data-meta="note" placeholder="Anything worth remembering…">${esc(event?.note || '')}</textarea>
    </label>

    <div class="sheet-actions">
      <button class="btn" data-close type="button">Cancel</button>
      <button class="btn primary" data-save type="button">${isNew ? 'Log it' : 'Save'}</button>
    </div>
    ${isNew ? '' : '<button class="btn danger wide" data-delete type="button" style="margin-top:10px">Delete entry</button>'}
  `;

  openSheet(html, (sheet) => {
    wireFieldControls(sheet);

    // Chip groups that write into a hidden [data-meta] input.
    sheet.addEventListener('click', (ev) => {
      const choose = ev.target.closest('[data-choose]');
      if (choose && ['userId', 'babyId'].includes(choose.dataset.choose)) {
        const key = choose.dataset.choose;
        sheet.querySelector(`[data-meta="${key}"]`).value = choose.dataset.value;
        sheet.querySelectorAll(`[data-choose="${key}"]`).forEach((b) => {
          const on = b.dataset.value === choose.dataset.value;
          b.setAttribute('aria-pressed', String(on));
          b.style.borderColor = on ? 'var(--pink)' : '';
          b.style.background = on ? 'color-mix(in srgb,var(--pink) 22%,var(--surface-2))' : '';
        });
      }

      const nudge = ev.target.closest('[data-nudge]');
      if (nudge) {
        const input = sheet.querySelector('[data-meta="at"]');
        if (nudge.dataset.nudge === 'now') {
          input.value = toLocalInput();
        } else {
          const base = input.value ? new Date(input.value) : new Date();
          input.value = toLocalInput(new Date(base.getTime() + Number(nudge.dataset.nudge) * 60000).toISOString());
        }
      }
    });

    sheet.querySelector('[data-save]').addEventListener('click', async () => {
      const payload = {
        babyId: sheet.querySelector('[data-meta="babyId"]').value,
        userId: sheet.querySelector('[data-meta="userId"]').value,
        typeId: type.id,
        presetId: event?.presetId ?? presetId ?? null,
        at: fromLocalInput(sheet.querySelector('[data-meta="at"]').value),
        note: sheet.querySelector('[data-meta="note"]').value.trim(),
        data: collectFields(sheet.querySelector('[data-fields]')),
      };
      try {
        if (isNew) {
          await api.addEvent(payload);
          feedback({ mark: type.emoji, soundName: type.sound || 'chime' });
        } else {
          await api.editEvent(event.id, payload);
          sound.play('success');
        }
        closeSheet();
        toast({ icon: type.emoji, text: `<b>${esc(type.label)}</b> saved`, tone: type.tone, ms: 2500 });
        await refresh();
      } catch (err) {
        toast({ icon: '⚠️', text: esc(err.message), tone: 'peach' });
      }
    });

    sheet.querySelector('[data-delete]')?.addEventListener('click', async () => {
      if (settings().confirmDelete !== false && !confirm('Delete this entry?')) return;
      closeSheet();
      await undoEvent(event.id);
    });
  });
}
