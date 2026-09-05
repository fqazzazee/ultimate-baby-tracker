/** Entry point: shell chrome, routing, event delegation and the alarm loop. */

import {
  state, config, currentBaby, currentUser, settings,
  refresh, render, setRenderer, saveConfig, toast, closeSheet, sheetOpen,
  quickLog, openLogSheet, stopRunningTimer, cancelRunningTimer, switchFeedSide, applyTheme,
  isUnlocked, lockProfile, onRefresh,
} from './core.js';
import { api, subscribe } from './api.js';
import * as sound from './sound.js';
import { $, esc, store, fmtClock, fmtSpan, babyAge, ringState } from './util.js';
import { toneStyle, typeOf } from './ui.js';
import {
  renderTrack, renderHistory, renderAlarms, openNutrientSheet,
  loadNutrition, nutritionKey,
} from './views.js';
import { renderStats, loadStats, statsKey } from './stats.js';
import { toggleTable, downloadChart } from './charts.js';
import { wireTips } from './tips.js';
import {
  renderSetup, wireSetup, exportCSV, downloadBackup, restoreBackup,
  openBabySheet, openUserSheet, openTypeSheet, openAlarmSheet, openMilkSheet,
  unlockProfile, runBackupNow,
} from './settings.js';

const TABS = [
  { id: 'track', label: 'Track', icon: '🍼' },
  { id: 'history', label: 'History', icon: '📖' },
  { id: 'stats', label: 'Stats', icon: '📊' },
  { id: 'alarms', label: 'Alarms', icon: '⏰' },
  { id: 'setup', label: 'Setup', icon: '⚙️' },
];

/* ------------------------------------------------------------------ chrome */

/** Baby and profile chips, merged into one strip that rides with the tabs. */
function babyChips() {
  const cfg = config();
  return cfg.babies.map((b) => `
    <button class="chip mini" style="${toneStyle(b.tone)}" data-act="pick-baby" data-id="${esc(b.id)}"
      aria-pressed="${b.id === state.babyId}" aria-label="Track ${esc(b.name)}"
      title="${esc(b.name)}${babyAge(b.birthDate) ? ` · ${esc(babyAge(b.birthDate))}` : ''}">
      <span class="avatar">${esc(b.emoji || '👶')}</span><span class="name">${esc(b.name)}</span>
    </button>`).join('');
}

function userChips() {
  const cfg = config();
  return `
    ${cfg.users.map((u) => `
      <button class="chip mini" style="${toneStyle(u.tone)}" data-act="pick-user" data-id="${esc(u.id)}"
        aria-pressed="${u.id === state.userId}" aria-label="Log as ${esc(u.name)}" title="Log as ${esc(u.name)}">
        <span class="avatar">${esc(u.emoji)}</span><span class="name">${esc(u.name)}</span>
        ${u.hasPin ? `<span class="lockmark">${isUnlocked(u.id) ? '🔓' : '🔒'}</span>` : ''}
      </button>`).join('')}
    ${currentUser().hasPin && isUnlocked(state.userId)
      ? '<button class="chip mini" data-act="lock-profile" title="Lock this profile" aria-label="Lock this profile">🔒</button>' : ''}`;
}

function contextStrip() {
  const cfg = config();
  if (!cfg.babies.length) return '';
  return `
    <div class="ctx-strip">
      <div class="ctx-group" role="group" aria-label="Baby">${babyChips()}</div>
      <span class="ctx-div" aria-hidden="true"></span>
      <div class="ctx-group" role="group" aria-label="Who is logging">${userChips()}</div>
    </div>`;
}

function tabbar() {
  const dueCount = (state.data?.alarms || []).filter((a) => ringState(a).ringing).length;
  return `
    <nav class="tabbar">
      ${TABS.map((t) => `
        <button data-act="tab" data-tab="${t.id}" aria-current="${state.tab === t.id ? 'page' : 'false'}">
          <span class="ico">${t.icon}</span>${t.label}
          ${t.id === 'alarms' && dueCount ? `<span class="badge">${dueCount}</span>` : ''}
        </button>`).join('')}
    </nav>`;
}

function viewHTML() {
  switch (state.tab) {
    case 'history': return renderHistory();
    case 'stats': return renderStats();
    case 'alarms': return renderAlarms();
    case 'setup': return renderSetup();
    default: return renderTrack();
  }
}

function brandRow() {
  const app = state.data?.app || {};
  const theme = settings().theme || 'auto';
  const icon = theme === 'dark' ? '🌙' : theme === 'light' ? '☀️' : '🌗';
  return `
    <div class="topbar-inner">
      <div class="brand">
        <span class="logo">🍼</span>
        <span class="brand-name">${esc(app.name || 'Ultimate Baby Tracker')}</span>
        ${app.version ? `<span class="ver">v${esc(app.version)}</span>` : ''}
      </div>
      <div class="spacer"></div>
      <button class="icon-btn" data-act="theme-cycle" title="Theme (${esc(theme)})"
        aria-label="Switch theme">${icon}</button>
    </div>`;
}

function renderAll() {
  if (!state.data) return;
  const scrollY = window.scrollY;
  const ctxScroll = $('.ctx-strip')?.scrollLeft ?? null;
  $('#chrome').innerHTML = `
    ${brandRow()}
    <div class="navbar">
      ${tabbar()}
      ${contextStrip()}
    </div>`;
  $('#view').innerHTML = viewHTML();
  if (state.tab === 'setup') wireSetup($('#view'));
  measureHeader();
  window.scrollTo(0, scrollY);
  restoreChipScroll(ctxScroll);
  tick();
}

/**
 * Keep the chip strip where the reader left it, and open on the baby in use.
 *
 * The header is rewritten wholesale on every render - including the one the
 * background refresh fires every twenty seconds - which resets the strip to
 * `scrollLeft: 0`. With three babies that is its own small betrayal: you scroll
 * across to reach Grandmother, the poll lands, and the strip snaps back under
 * your thumb. The page's own scroll position is already preserved a few lines
 * up for exactly this reason; the strip gets the same treatment.
 *
 * `null` means there was no strip to read - the first paint, or a baby was just
 * added - and that is the one time the strip is positioned rather than
 * restored: on the selected baby, which is otherwise off the right-hand edge
 * with no indication that the app is pointed at it.
 */
function restoreChipScroll(previous) {
  const strip = $('.ctx-strip');
  if (!strip) return;
  if (previous !== null) {
    strip.scrollLeft = previous;
    return;
  }
  const chip = strip.querySelector('[data-act="pick-baby"][aria-pressed="true"]');
  if (!chip) return;
  const box = strip.getBoundingClientRect();
  const it = chip.getBoundingClientRect();
  if (it.left >= box.left && it.right <= box.right) return;
  // Nudge by the smallest amount that brings it fully inside, with a little
  // air on the leading edge so it does not read as clipped.
  strip.scrollLeft += (it.left < box.left)
    ? it.left - box.left - 8
    : it.right - box.right + 8;
}

/* ------------------------------------------------------------------ header */

/** Sticky day headings need to know how tall the pinned header actually is. */
function measureHeader() {
  document.documentElement.style.setProperty('--header-h', `${$('#chrome').offsetHeight}px`);
}

/**
 * Shrink the header once reading has started, and restore it at the top.
 *
 * The two thresholds are deliberately different: compacting the header removes
 * a row of its own height, and a single boundary would sit right where that
 * removal puts you, flipping the class on every frame.
 */
function watchHeaderScroll() {
  const chrome = $('#chrome');
  let compact = false;
  const onScroll = () => {
    const next = window.scrollY > (compact ? 24 : 72);
    if (next === compact) return;
    compact = next;
    chrome.classList.toggle('compact', compact);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  // The header changes height while the transition runs, so measure it as it
  // moves rather than once at either end.
  new ResizeObserver(measureHeader).observe(chrome);
  onScroll();
}

/* ----------------------------------------------------- one-second heartbeat */

function tick() {
  const now = Date.now();
  document.querySelectorAll('[data-clock]').forEach((el) => {
    el.textContent = fmtClock(now - new Date(el.dataset.clock).getTime());
  });
  document.querySelectorAll('[data-countdown]').forEach((el) => {
    const target = new Date(el.dataset.countdown).getTime();
    el.textContent = target > now ? fmtSpan(target - now) : `${fmtSpan(now - target)} ago`;
    el.classList.toggle('over', target <= now);
  });
  checkAlarms();
}

/* ------------------------------------------------------------------ alarms */

function ringingInstance() {
  return (state.data?.alarms || []).find((a) => ringState(a).ringing) || null;
}

function checkAlarms() {
  const inst = ringingInstance();
  const key = inst ? `${inst.key}|${inst.dueAt}` : null;
  if (key === state.ringingKey) return;
  state.ringingKey = key;
  if (inst) startRing(inst); else stopRing();
}

let notified = null;

function startRing(inst) {
  sound.startRinging();
  sound.buzz([200, 120, 200, 120, 400]);
  showRingOverlay(inst);
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted' && notified !== inst.key) {
    notified = inst.key;
    try {
      const n = new Notification(`${inst.emoji} ${inst.label}`, {
        body: `${inst.babyName} — it's time.`,
        tag: inst.key,
        requireInteraction: true,
      });
      n.onclick = () => { window.focus(); n.close(); };
    } catch { /* notifications unavailable */ }
  }
}

function stopRing() {
  sound.stopRinging();
  notified = null;
  document.querySelector('.ring-overlay')?.remove();
}

function showRingOverlay(inst) {
  document.querySelector('.ring-overlay')?.remove();
  const cfg = config();
  const firstType = inst.typeIds?.[0] ? typeOf(cfg, inst.typeIds[0]) : null;
  const el = document.createElement('div');
  el.className = 'ring-overlay';
  el.innerHTML = `
    <div class="ring-box">
      <div class="big">${esc(inst.emoji)}</div>
      <h2 style="margin:12px 0 4px">${esc(inst.label)}</h2>
      <p class="muted" style="margin:0">${esc(inst.babyName)} · due <span data-countdown="${esc(inst.dueAt)}">now</span></p>
      <div class="ring-actions">
        ${firstType ? `<button class="btn primary wide" data-ring="done">${esc(firstType.emoji)} Log ${esc(firstType.label)} now</button>` : ''}
        <button class="btn wide" data-ring="snooze">😴 Snooze ${inst.snoozeMinutes} min</button>
        <button class="btn wide" data-ring="dismiss">Dismiss</button>
      </div>
    </div>`;

  el.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-ring]');
    if (!btn) return;
    const action = btn.dataset.ring;
    sound.stopRinging();
    el.remove();
    try {
      if (action === 'snooze') {
        await api.snoozeAlarm(inst.key, inst.snoozeMinutes);
        toast({ icon: '😴', text: `Snoozed ${inst.snoozeMinutes} min`, tone: 'lavender' });
      } else {
        await api.dismissAlarm(inst.key, inst.dueAt);
        if (action === 'done' && firstType) {
          const prevBaby = state.babyId;
          state.babyId = inst.babyId;         // log against the alarm's baby
          await quickLog(firstType.id, firstType.presets?.[0]?.id);
          state.babyId = prevBaby;
        }
      }
    } catch (err) {
      toast({ icon: '⚠️', text: esc(err.message), tone: 'peach' });
    }
    state.ringingKey = null;
    await refresh();
  });

  document.body.appendChild(el);
}

/* -------------------------------------------------------------- delegation */

/** The line printed under an exported chart, so the file explains itself. */
function chartFooter() {
  const baby = currentBaby();
  const days = state.statsDays;
  return `${baby ? `${baby.name} · ` : ''}last ${days} day${days === 1 ? '' : 's'}`
    + ` · exported ${new Date().toLocaleDateString()} · ${state.data?.app?.name || 'Ultimate Baby Tracker'}`;
}

/** Fetch the Statistics slice if what we hold is for another baby or range. */
async function ensureStats() {
  if (state.tab !== 'stats' || state.stats.key === statsKey()) return;
  state.stats = { ...state.stats, loading: true, error: null };
  render();
  await loadStats();
  render();
}

/** The same, for the window the Nutrition card on Track is showing. */
async function ensureNutrition() {
  if (state.tab !== 'track' || state.nutrition.key === nutritionKey()) return;
  state.nutrition = { ...state.nutrition, loading: true, error: null };
  render();
  await loadNutrition();
  render();
}

const ACTIONS = {
  tab: (el) => {
    state.tab = el.dataset.tab;
    store.set('tab', state.tab);
    render();
    window.scrollTo(0, 0);
    return Promise.all([ensureStats(), ensureNutrition()]);
  },
  'stats-range': (el) => {
    state.statsDays = Number(el.dataset.days);
    store.set('statsDays', state.statsDays);
    return ensureStats();
  },
  /** How far back the Nutrition card on Track looks: 24h, 3d, 7d or 30d. */
  'nutrition-range': (el) => {
    state.nutritionHours = Number(el.dataset.hours);
    store.set('nutritionHours', state.nutritionHours);
    sound.play('pop');
    return ensureNutrition();
  },
  'pick-baby': async (el) => {
    state.babyId = el.dataset.id;
    store.set('babyId', state.babyId);
    sound.play('pop');
    await refresh();
    await Promise.all([ensureStats(), ensureNutrition()]);
  },
  'pick-user': (el) => {
    const id = el.dataset.id;
    const select = () => {
      state.userId = id;
      store.set('userId', id);
      sound.play('pop');
      render();
    };
    if (isUnlocked(id)) return select();
    unlockProfile(id, select);
  },
  'lock-profile': () => {
    lockProfile(state.userId);
    sound.play('undo');
    toast({ icon: '🔒', text: 'Profile locked', tone: 'lavender', ms: 2000 });
    render();
  },
  'theme-cycle': () => {
    const order = ['auto', 'light', 'dark'];
    const next = order[(order.indexOf(settings().theme || 'auto') + 1) % order.length];
    saveConfig((cfg) => { cfg.settings.theme = next; });
    applyTheme(next);
    sound.play('pop');
  },
  'set-theme': (el) => {
    saveConfig((cfg) => { cfg.settings.theme = el.dataset.value; });
    applyTheme(el.dataset.value);
  },
  'set-timefmt': (el) => saveConfig((cfg) => { cfg.settings.timeFormat = el.dataset.value; }),

  quick: (el) => quickLog(el.dataset.type, el.dataset.preset || null),
  details: (el) => openLogSheet({ typeId: el.dataset.type }),
  'edit-event': (el) => {
    const ev = (state.data?.events || []).find((x) => x.id === el.dataset.id);
    if (ev) openLogSheet({ event: ev });
  },
  'stop-timer': (el) => stopRunningTimer(el.dataset.id),
  'cancel-timer': (el) => cancelRunningTimer(el.dataset.id),
  'switch-side': (el) => switchFeedSide(el.dataset.id, el.dataset.side),

  'filter-type': (el) => { state.historyType = el.dataset.type; render(); },
  range: async (el) => { state.historyDays = Number(el.dataset.days); await refresh(); },
  'viz-table': (el) => toggleTable($('#view'), el.dataset.vizTable),
  'viz-download': async (el) => {
    await downloadChart($('#view'), el.dataset.vizDownload, { footer: chartFooter() });
    toast({ icon: '⬇️', text: 'Chart saved as a PNG', tone: 'sky', ms: 2500 });
  },
  'nutrient-info': (el) => openNutrientSheet(el.dataset.key),

  export: () => exportCSV(),
  backup: () => downloadBackup(),
  restore: () => restoreBackup(),

  'backup-run': () => runBackupNow(),
  'backup-every': (el) => saveConfig((cfg) => {
    cfg.backup = { ...cfg.backup, everyHours: Number(el.dataset.value) };
  }),
  'backup-keep': (el) => saveConfig((cfg) => {
    cfg.backup = { ...cfg.backup, keep: Number(el.dataset.value) };
  }),

  'add-baby': () => openBabySheet(),
  'edit-baby': (el) => openBabySheet(el.dataset.id),
  'add-user': () => openUserSheet(),
  'edit-user': (el) => {
    const id = el.dataset.id;
    if (isUnlocked(id)) return openUserSheet(id);
    unlockProfile(id, () => openUserSheet(id));
  },
  'add-type': () => openTypeSheet(),
  'edit-type': (el) => openTypeSheet(el.dataset.id),
  /** The tracked-metric tick: `archived` is what hides a card everywhere else. */
  'toggle-type': (el) => {
    const tracked = el.checked;
    sound.play(tracked ? 'pop' : 'undo');
    return saveConfig((cfg) => {
      const t = cfg.eventTypes.find((x) => x.id === el.dataset.id);
      if (t) t.archived = !tracked;
    });
  },
  /**
   * Whether a profile is still offered. Switching one off leaves every entry
   * that named it alone; it only stops appearing on the Bottle card.
   */
  'toggle-milk': (el) => {
    const on = el.checked;
    const milks = config().nutrition?.milks || [];
    if (!on && milks.filter((m) => m.enabled !== false).length <= 1) {
      el.checked = true;
      return toast({ icon: '🍼', text: 'Keep at least one milk on offer', tone: 'peach' });
    }
    sound.play(on ? 'pop' : 'undo');
    return saveConfig((cfg) => {
      const milk = cfg.nutrition.milks.find((m) => m.id === el.dataset.id);
      if (!milk) return;
      milk.enabled = on;
      // The fallback has to be something a bottle can actually be logged as.
      if (!on && cfg.nutrition.defaultMilkId === milk.id) {
        cfg.nutrition.defaultMilkId = cfg.nutrition.milks.find((m) => m.enabled !== false)?.id || null;
      }
    });
  },
  'add-milk': () => openMilkSheet(),
  'edit-milk': (el) => openMilkSheet(el.dataset.id),
  'set-default-milk': (el) => saveConfig((cfg) => { cfg.nutrition.defaultMilkId = el.dataset.id; }),
  'toggle-nutrient': (el) => {
    const key = el.dataset.key;
    const on = el.checked;
    return saveConfig((cfg) => {
      const shown = new Set(cfg.nutrition.show || []);
      if (on) shown.add(key); else shown.delete(key);
      cfg.nutrition.show = [...shown];
    });
  },

  'add-alarm': () => openAlarmSheet(),
  'edit-alarm': (el) => openAlarmSheet(el.dataset.id),
  'toggle-alarm': (el) => {
    const on = el.checked;
    saveConfig((cfg) => {
      const a = cfg.alarms.find((x) => x.id === el.dataset.id);
      if (a) a.enabled = on;
    }).then(() => {
      // Arming from "off" restarts the countdown from now.
      if (!on) return;
      const insts = (state.data?.alarms || []).filter((i) => i.alarmId === el.dataset.id);
      return Promise.all(insts.map((i) => api.armAlarm(i.key))).then(refresh);
    });
    if (on && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
    sound.play(on ? 'success' : 'undo');
  },
  'snooze-alarm': async (el) => {
    await api.snoozeAlarm(el.dataset.key, Number(el.dataset.min) || 10);
    state.ringingKey = null;
    sound.stopRinging();
    await refresh();
  },
  'reset-alarm': async (el) => {
    await api.armAlarm(el.dataset.key);
    state.ringingKey = null;
    sound.stopRinging();
    sound.play('ding');
    await refresh();
  },
  'ask-notify': async () => {
    if (!('Notification' in window)) return toast({ icon: '🔕', text: 'This browser has no notifications', tone: 'peach' });
    const res = await Notification.requestPermission();
    toast({ icon: res === 'granted' ? '🔔' : '🔕', text: `Notifications ${res}`, tone: res === 'granted' ? 'mint' : 'peach' });
    render();
  },
};

function onClick(ev) {
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  const fn = ACTIONS[el.dataset.act];
  if (!fn) return;
  // Checkbox actions must keep their native toggle behaviour.
  if (el.tagName !== 'INPUT') ev.preventDefault();
  Promise.resolve(fn(el)).catch((err) => {
    console.error(err);
    toast({ icon: '⚠️', text: esc(err.message || 'Something went wrong'), tone: 'peach' });
  });
}

/**
 * If the remembered profile is PIN-locked, ask for it before anything can be
 * logged under that name. Cancelling falls back to an unlocked profile; when
 * every profile has a PIN there is nowhere to fall back to, so the pad stays.
 */
function ensureProfileUnlocked() {
  const cfg = config();
  if (!cfg.users.length || isUnlocked(state.userId)) return;
  const open = cfg.users.find((u) => !u.hasPin);
  unlockProfile(state.userId, render, () => {
    if (!open) return ensureProfileUnlocked();
    state.userId = open.id;
    store.set('userId', open.id);
    render();
  });
}

/* -------------------------------------------------------------------- boot */

async function boot() {
  setRenderer(renderAll);
  applyTheme('auto');
  onRefresh(() => (state.tab === 'stats' ? loadStats() : null));
  onRefresh(() => (state.tab === 'track' ? loadNutrition() : null));

  document.addEventListener('click', (ev) => {
    const input = ev.target.closest('input[data-act]');
    if (input) return; // handled by the change listener below
    onClick(ev);
  });
  document.addEventListener('change', (ev) => {
    if (ev.target.matches('input[data-act]')) onClick(ev);
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && sheetOpen()) closeSheet();
  });
  // Charts are laid out in CSS pixels, so a width change needs a redraw.
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    if (state.tab !== 'stats') return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(render, 150);
  });
  // Browsers need a gesture before they will let us make a sound.
  document.addEventListener('pointerdown', () => sound.unlock(), { once: true });
  wireTips();

  await refresh();
  if (!config().babies.length) state.tab = 'track';
  render();
  watchHeaderScroll();
  ensureProfileUnlocked();

  setInterval(tick, 1000);
  subscribe({
    onChange: refresh,
    onStatus: (ok) => {
      if (ok !== state.connected) {
        state.connected = ok;
        render();
      }
    },
    pollSeconds: settings().refreshSeconds || 20,
  });
}

boot();
