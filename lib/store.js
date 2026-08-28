/**
 * Plain-text persistence.
 *
 *   data/config.json    pretty JSON  - babies, users, event types, alarms, settings
 *   data/events.log     JSON Lines   - append-only journal of add/edit/delete ops
 *   data/timers.json    pretty JSON  - running timers (survive a restart)
 *   data/alarms.json    pretty JSON  - alarm firing state (last fired / snoozed until)
 *
 * Every file is human-readable and hand-editable. The event journal is append-only
 * so a crash mid-write can never corrupt earlier entries.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { defaultConfig, defaultMilks } from './defaults.js';

/** Bumped when a stored config needs migrating; see migrate(). */
const CONFIG_VERSION = 4;

const DATA_DIR = path.resolve(process.env.BT_DATA_DIR || './data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const EVENTS_FILE = path.join(DATA_DIR, 'events.log');
const TIMERS_FILE = path.join(DATA_DIR, 'timers.json');
const ALARMS_FILE = path.join(DATA_DIR, 'alarms.json');

export const bus = new EventEmitter();
bus.setMaxListeners(0);

let config = null;
let events = new Map();   // id -> event
let timers = [];
let alarmState = {};      // alarmId -> { lastFiredAt, snoozedUntil, lastAckAt }
let revision = 0;
let journalLines = 0;
let journalOverhead = 0;  // edit/delete lines, used to decide when to compact

/* ------------------------------------------------------------------ helpers */

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

/** Write via a temp file + rename so readers never observe a half-written file. */
function writeAtomic(file, text) {
  ensureDir();
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
}

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn(`[store] ${path.basename(file)} unreadable (${err.message}); using defaults`);
      try {
        fs.copyFileSync(file, `${file}.corrupt-${Date.now()}`);
      } catch { /* best effort */ }
    }
    return fallback;
  }
}

export function newId(prefix = 'e') {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function touch() {
  revision += 1;
  bus.emit('change', revision);
  return revision;
}

export function getRevision() {
  return revision;
}

export function dataDir() {
  return DATA_DIR;
}

/* ------------------------------------------------------------------- config */

/**
 * Bring a config written by an older release up to date.
 *
 * v1 -> v2: nutrition tracking arrived. New installs get a milk picker on the
 * bottle button from the defaults; a config that predates it gets the same
 * field appended once. The old free-text "Contents" field is left alone -
 * entries already logged against it stay readable.
 */
function migrate(cfg) {
  const from = Number(cfg.version) || 1;
  if (from < 2) {
    const bottle = (cfg.eventTypes || []).find((t) => t.id === 'bottle');
    const hasMilk = (cfg.eventTypes || []).some((t) => (t.fields || []).some((f) => f.optionsFrom === 'milks'));
    if (bottle && !hasMilk) {
      bottle.fields = [...(bottle.fields || []), { key: 'milk', label: 'What is in it', type: 'select', optionsFrom: 'milks' }];
    }
  }
  if (from < 3) {
    // The shipped Bobbie profile had its iron, DHA and vitamin D entered as the
    // per-100-kcal figures Bobbie publishes, without converting to per 100 mL -
    // overstating each by about half. Correct it only where the numbers are
    // still untouched, so anyone who fixed or tuned their own copy keeps it.
    const WRONG = { kcal: 68, protein: 1.4, fat: 3.6, carbs: 7.3, iron: 1.2, calcium: 51, vitaminD: 1.5, dha: 20, sodium: 18 };
    const milk = (cfg.nutrition?.milks || []).find((m) => m.id === 'bobbie-original');
    if (milk && milk.builtin && JSON.stringify(milk.per100) === JSON.stringify(WRONG)) {
      const fresh = defaultMilks().find((m) => m.id === 'bobbie-original');
      if (fresh) milk.per100 = { ...fresh.per100 };
    }
  }
  if (from < 4) {
    // The Bobbie profiles now come straight off Bobbie's own panels, which
    // state "each 5 fl oz (150 mL) contains 100 calories" - so the per-100-
    // Calorie column divides by 1.5, not by the 20 kcal/fl oz this used to
    // assume. Correct it only where the shipped numbers are still untouched,
    // so anyone who typed in the tin in their kitchen keeps their own.
    const V3 = { kcal: 67.6, protein: 1.4, fat: 3.6, carbs: 7.3, iron: 0.81, calcium: 51, vitaminD: 1.27, dha: 13.5, sodium: 18 };
    const milks = cfg.nutrition?.milks;
    const bobbie = (milks || []).find((m) => m.id === 'bobbie-original');
    const fresh = defaultMilks();
    if (bobbie && bobbie.builtin && JSON.stringify(bobbie.per100) === JSON.stringify(V3)) {
      bobbie.per100 = { ...fresh.find((m) => m.id === 'bobbie-original').per100 };
    }
    // The whole-milk recipe is new. Offer it next to the original rather than
    // at the end of a list somebody may have put in their own order.
    if (Array.isArray(milks) && !milks.some((m) => m.id === 'bobbie-whole-milk')) {
      const add = fresh.find((m) => m.id === 'bobbie-whole-milk');
      const at = milks.findIndex((m) => m.id === 'bobbie-original');
      milks.splice(at >= 0 ? at + 1 : milks.length, 0, { ...add });
    }
  }
  cfg.version = CONFIG_VERSION;
  return cfg;
}

/** Merge a stored config over the defaults so new releases can add keys safely. */
function mergeConfig(stored) {
  const base = defaultConfig();
  if (!stored || typeof stored !== 'object') return base;
  const nutrition = stored.nutrition && typeof stored.nutrition === 'object' ? stored.nutrition : {};
  return migrate({
    ...base,
    ...stored,
    settings: { ...base.settings, ...(stored.settings || {}) },
    nutrition: {
      ...base.nutrition,
      ...nutrition,
      show: Array.isArray(nutrition.show) ? nutrition.show : base.nutrition.show,
      milks: Array.isArray(nutrition.milks) && nutrition.milks.length ? nutrition.milks : base.nutrition.milks,
    },
    stats: {
      ...base.stats,
      ...(stored.stats && typeof stored.stats === 'object' ? stored.stats : {}),
      charts: { ...base.stats.charts, ...(stored.stats?.charts || {}) },
    },
    babies: Array.isArray(stored.babies) ? stored.babies : base.babies,
    users: Array.isArray(stored.users) && stored.users.length ? stored.users : base.users,
    eventTypes: Array.isArray(stored.eventTypes) && stored.eventTypes.length ? stored.eventTypes : base.eventTypes,
    alarms: Array.isArray(stored.alarms) ? stored.alarms : base.alarms,
  });
}

export function getConfig() {
  return config;
}

export function saveConfig(next) {
  const prevPins = new Map(
    (config?.users || []).filter((u) => u.pin).map((u) => [u.id, u.pin]),
  );
  config = mergeConfig(next);
  // Clients never receive PIN material, so carry it over rather than losing it
  // when the browser saves the config it was given.
  for (const u of config.users) {
    delete u.hasPin;
    if (!u.pin && prevPins.has(u.id)) u.pin = prevPins.get(u.id);
  }
  config.version = CONFIG_VERSION;
  writeAtomic(CONFIG_FILE, `${JSON.stringify(config, null, 2)}\n`);
  return touch();
}

/**
 * The config as clients may see it: PIN hashes are replaced by a plain flag.
 */
export function publicConfig() {
  return {
    ...config,
    users: (config.users || []).map(({ pin, ...rest }) => ({ ...rest, hasPin: !!pin })),
  };
}

/* --------------------------------------------------------------------- PINs */

/**
 * Optional 4-digit profile locks. A short PIN can never be strong, so this is
 * a guard against someone else logging entries as you - not real security.
 * The API itself is unauthenticated by design; keep the app on a trusted LAN.
 */

const PIN_ATTEMPTS = new Map(); // userId -> { fails, until }
const MAX_FAILS = 5;
const LOCKOUT_MS = 30_000;

function hashPin(pin, salt) {
  return crypto.scryptSync(String(pin), salt, 32);
}

export function setPin(userId, pin) {
  const user = (config.users || []).find((u) => u.id === userId);
  if (!user) return false;
  if (pin === null || pin === undefined || pin === '') {
    delete user.pin;
  } else {
    const salt = crypto.randomBytes(16).toString('hex');
    user.pin = { salt, hash: hashPin(pin, salt).toString('hex') };
  }
  PIN_ATTEMPTS.delete(userId);
  saveConfig(config);
  return true;
}

export function hasPin(userId) {
  return !!(config.users || []).find((u) => u.id === userId)?.pin;
}

/** Returns { ok } or { ok: false, retryAfter } while locked out. */
export function verifyPin(userId, pin) {
  const user = (config.users || []).find((u) => u.id === userId);
  if (!user) return { ok: false };
  if (!user.pin) return { ok: true };

  const record = PIN_ATTEMPTS.get(userId);
  if (record && record.until > Date.now()) {
    return { ok: false, retryAfter: Math.ceil((record.until - Date.now()) / 1000) };
  }

  const expected = Buffer.from(user.pin.hash, 'hex');
  const actual = hashPin(pin ?? '', user.pin.salt);
  const ok = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);

  if (ok) {
    PIN_ATTEMPTS.delete(userId);
    return { ok: true };
  }
  const fails = (record?.fails || 0) + 1;
  PIN_ATTEMPTS.set(userId, {
    fails,
    until: fails >= MAX_FAILS ? Date.now() + LOCKOUT_MS : 0,
  });
  return {
    ok: false,
    remaining: Math.max(0, MAX_FAILS - fails),
    retryAfter: fails >= MAX_FAILS ? LOCKOUT_MS / 1000 : 0,
  };
}

/* ------------------------------------------------------------------- events */

function applyOp(op) {
  if (!op || typeof op !== 'object') return;
  if (op.op === 'add' && op.e && op.e.id) {
    events.set(op.e.id, op.e);
  } else if (op.op === 'edit' && op.id) {
    const cur = events.get(op.id);
    if (cur) events.set(op.id, { ...cur, ...op.patch, id: op.id });
    journalOverhead += 1;
  } else if (op.op === 'del' && op.id) {
    events.delete(op.id);
    journalOverhead += 1;
  }
}

function loadEvents() {
  events = new Map();
  journalLines = 0;
  journalOverhead = 0;
  let raw;
  try {
    raw = fs.readFileSync(EVENTS_FILE, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    return;
  }
  let bad = 0;
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    journalLines += 1;
    try {
      applyOp(JSON.parse(trimmed));
    } catch {
      bad += 1; // a torn final line from an unclean shutdown: skip it
    }
  }
  if (bad) console.warn(`[store] skipped ${bad} unreadable line(s) in events.log`);
}

function appendOp(op) {
  ensureDir();
  fs.appendFileSync(EVENTS_FILE, `${JSON.stringify(op)}\n`, 'utf8');
  journalLines += 1;
}

/** Rewrite the journal as one `add` per surviving event. Called on boot only. */
function compactIfNeeded() {
  if (journalLines < 2000 || journalOverhead < journalLines * 0.3) return;
  const body = sortedEvents()
    .map((e) => `${JSON.stringify({ op: 'add', e })}\n`)
    .join('');
  writeAtomic(EVENTS_FILE, body);
  journalLines = events.size;
  journalOverhead = 0;
  console.log(`[store] compacted events.log to ${events.size} entries`);
}

function sortedEvents() {
  return [...events.values()].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

export function addEvent(input) {
  const e = {
    id: newId('e'),
    at: input.at || new Date().toISOString(),
    babyId: input.babyId,
    userId: input.userId,
    typeId: input.typeId,
    presetId: input.presetId || null,
    data: input.data && typeof input.data === 'object' ? input.data : {},
    note: typeof input.note === 'string' ? input.note : '',
    createdAt: new Date().toISOString(),
  };
  events.set(e.id, e);
  appendOp({ op: 'add', e });
  touch();
  return e;
}

export function editEvent(id, patch) {
  const cur = events.get(id);
  if (!cur) return null;
  const allowed = ['at', 'babyId', 'userId', 'typeId', 'presetId', 'data', 'note'];
  const clean = {};
  for (const k of allowed) if (k in patch) clean[k] = patch[k];
  const next = { ...cur, ...clean, id, updatedAt: new Date().toISOString() };
  events.set(id, next);
  appendOp({ op: 'edit', id, patch: { ...clean, updatedAt: next.updatedAt } });
  journalOverhead += 1;
  touch();
  return next;
}

export function deleteEvent(id) {
  if (!events.has(id)) return false;
  events.delete(id);
  appendOp({ op: 'del', id });
  journalOverhead += 1;
  touch();
  return true;
}

export function getEvent(id) {
  return events.get(id) || null;
}

export function listEvents({ babyId, since, until, typeId, limit = 500 } = {}) {
  let out = sortedEvents();
  if (babyId && babyId !== 'all') out = out.filter((e) => e.babyId === babyId);
  if (typeId) out = out.filter((e) => e.typeId === typeId);
  if (since) out = out.filter((e) => e.at >= since);
  if (until) out = out.filter((e) => e.at <= until);
  out.reverse(); // newest first
  return limit > 0 ? out.slice(0, limit) : out;
}

export function lastEventOf(babyId, typeIds) {
  const ids = new Set(typeIds);
  for (const e of sortedEvents().reverse()) {
    if (ids.has(e.typeId) && (babyId === 'all' || e.babyId === babyId)) return e;
  }
  return null;
}

export function eventCount() {
  return events.size;
}

/**
 * When the log begins, for one baby or all of them.
 *
 * The Track screen offers windows up to a month wide and has to be able to say
 * "not enough data" rather than average a 30-day range over six days of entries
 * and call the answer a month.
 */
export function firstEventAt(babyId = 'all') {
  for (const e of sortedEvents()) {
    if (babyId === 'all' || e.babyId === babyId) return e.at;
  }
  return null;
}

/* ------------------------------------------------------------------- timers */

function saveTimers() {
  writeAtomic(TIMERS_FILE, `${JSON.stringify(timers, null, 2)}\n`);
}

export function listTimers() {
  return timers;
}

export function startTimer(input) {
  const t = {
    id: newId('t'),
    babyId: input.babyId,
    userId: input.userId,
    typeId: input.typeId,
    presetId: input.presetId || null,
    data: input.data || {},
    startedAt: input.startedAt || new Date().toISOString(),
  };
  timers = timers.filter((x) => !(x.babyId === t.babyId && x.typeId === t.typeId));
  timers.push(t);
  saveTimers();
  touch();
  return t;
}

/** Stop a running timer and turn it into a logged event with a duration in minutes. */
export function stopTimer(id, extra = {}) {
  const t = timers.find((x) => x.id === id);
  if (!t) return null;
  timers = timers.filter((x) => x.id !== id);
  saveTimers();
  const minutes = Math.max(0, Math.round((Date.now() - new Date(t.startedAt).getTime()) / 60000));
  return addEvent({
    at: t.startedAt,
    babyId: t.babyId,
    userId: extra.userId || t.userId,
    typeId: t.typeId,
    presetId: t.presetId,
    data: { ...t.data, ...(extra.data || {}), duration: minutes },
    note: extra.note || '',
  });
}

export function cancelTimer(id) {
  const before = timers.length;
  timers = timers.filter((x) => x.id !== id);
  if (timers.length === before) return false;
  saveTimers();
  touch();
  return true;
}

/* -------------------------------------------------------------- alarm state */

export function getAlarmState() {
  return alarmState;
}

export function setAlarmState(id, patch) {
  alarmState[id] = { ...(alarmState[id] || {}), ...patch };
  writeAtomic(ALARMS_FILE, `${JSON.stringify(alarmState, null, 2)}\n`);
  return touch();
}

/* ------------------------------------------------------------------- backup */

/**
 * A full snapshot of everything on disk, as one object.
 *
 * PIN hashes travel with it: a restore that dropped them would silently unlock
 * every profile. They are salted scrypt hashes rather than the PINs themselves,
 * but the file is still as sensitive as the data directory - treat it that way.
 */
export const BACKUP_FORMAT = 'ultimate-baby-tracker-backup';
export const BACKUP_VERSION = 1;

export function exportBundle(app = {}) {
  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    app: { name: app.name, version: app.version },
    config,
    events: sortedEvents(),
    timers,
    alarmState,
  };
}

/** What a bundle holds, for the "restore this?" prompt. Throws if unusable. */
export function inspectBundle(bundle) {
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
    throw new Error('That file is not a backup bundle.');
  }
  if (bundle.format !== BACKUP_FORMAT) {
    throw new Error('That file was not written by this app.');
  }
  if (Number(bundle.formatVersion) > BACKUP_VERSION) {
    throw new Error(`That backup needs a newer version of the app (format ${bundle.formatVersion}).`);
  }
  const cfg = bundle.config;
  if (!cfg || typeof cfg !== 'object' || !Array.isArray(cfg.babies) || !Array.isArray(cfg.users)) {
    throw new Error('The backup has no usable config in it.');
  }
  if (!Array.isArray(bundle.events)) {
    throw new Error('The backup has no event list in it.');
  }
  const events = bundle.events.filter((e) => e && e.id && e.at && e.typeId);
  return {
    exportedAt: bundle.exportedAt || null,
    appVersion: bundle.app?.version || null,
    babies: cfg.babies.length,
    users: cfg.users.length,
    eventTypes: (cfg.eventTypes || []).length,
    alarms: (cfg.alarms || []).length,
    events: events.length,
    skipped: bundle.events.length - events.length,
    timers: Array.isArray(bundle.timers) ? bundle.timers.length : 0,
    milks: (cfg.nutrition?.milks || []).length,
    pins: cfg.users.filter((u) => u && u.pin).length,
  };
}

/**
 * Replace everything on disk with the bundle's contents.
 *
 * The current state is written to data/pre-restore-<stamp>.json first, so a
 * restore of the wrong file is an annoyance rather than a loss.
 */
export function importBundle(bundle, app = {}) {
  const summary = inspectBundle(bundle);

  ensureDir();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safetyFile = path.join(DATA_DIR, `pre-restore-${stamp}.json`);
  writeAtomic(safetyFile, `${JSON.stringify(exportBundle(app), null, 2)}\n`);

  const incoming = bundle.events.filter((e) => e && e.id && e.at && e.typeId);
  writeAtomic(EVENTS_FILE, incoming.map((e) => `${JSON.stringify({ op: 'add', e })}\n`).join(''));

  timers = Array.isArray(bundle.timers) ? bundle.timers : [];
  saveTimers();
  alarmState = bundle.alarmState && typeof bundle.alarmState === 'object' ? bundle.alarmState : {};
  writeAtomic(ALARMS_FILE, `${JSON.stringify(alarmState, null, 2)}\n`);

  // saveConfig() carries PINs over from the config being replaced, which is the
  // wrong direction here: the bundle's own PINs must win. Write it directly.
  config = mergeConfig(bundle.config);
  for (const u of config.users) delete u.hasPin;
  config.version = CONFIG_VERSION;
  writeAtomic(CONFIG_FILE, `${JSON.stringify(config, null, 2)}\n`);
  PIN_ATTEMPTS.clear(); // lockout counters belong to the config we just replaced

  loadEvents();
  touch();
  return { ...summary, safetyCopy: path.basename(safetyFile) };
}

/* --------------------------------------------------------------------- init */

export function init() {
  ensureDir();
  config = mergeConfig(readJSON(CONFIG_FILE, null));
  if (!fs.existsSync(CONFIG_FILE)) saveConfig(config);
  loadEvents();
  compactIfNeeded();
  timers = readJSON(TIMERS_FILE, []);
  if (!Array.isArray(timers)) timers = [];
  alarmState = readJSON(ALARMS_FILE, {});
  if (!alarmState || typeof alarmState !== 'object') alarmState = {};
  console.log(`[store] ${DATA_DIR} - ${events.size} events, ${config.babies.length} babies, ${timers.length} running timer(s)`);
}
