/**
 * Unattended backups for the self-hosted server.
 *
 * The manual "Download backup" button hands one file to whichever browser asked
 * for it and forgets about it. This keeps a rolling set on the machine that
 * runs the app, on a schedule, with nobody present.
 *
 * WHY THIS EXISTS WHEN THE DATA FOLDER IS RIGHT THERE.
 *
 * The honest objection is in the browser build's api.js, which used to answer
 * that a server needs none of this: the data directory is already on the
 * machine, and copying it is the backup. That is true, and it assumes the thing
 * it should not — that whoever installed this also set up a copy. The Android
 * build exists because that assumption fails. It fails on a home server too,
 * and it fails silently, which is the worst way for a backup to fail.
 *
 * WHERE IT WRITES.
 *
 * `data/backups/` by default, so a bundle lands beside the journal it came from
 * and gets carried along by whatever already copies the data directory. Set
 * `BT_BACKUP_DIR` to somewhere else - a NAS mount, a Syncthing folder, a
 * removable disk - and the copies leave the machine on their own, which is what
 * makes them a backup rather than a second copy of a disk that can fail once.
 *
 * The file is the same gzipped bundle the download button produces and the same
 * one `POST /api/restore` accepts, from this app or from the Android one. There
 * is no separate format to go stale.
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import * as store from './store.js';

const PREFIX = 'baby-tracker-backup-';
const SUFFIX = '.json.gz';

/** How often the scheduler wakes to ask whether anything is due. */
const CHECK_EVERY_MS = 15 * 60_000;

const DEFAULTS = { enabled: false, everyHours: 24, keep: 14 };

let timer = null;
let appInfo = {};

/* ---------------------------------------------------------------- settings */

/** The `backup` block of the config, clamped to what this will actually honour. */
export function settingsOf(config) {
  const b = (config && config.backup) || {};
  const int = (v, fallback, lo, hi) => {
    // null, undefined and '' mean "not set" and take the default. Without this
    // they become Number(v) === 0 and clamp to the floor, so a config with
    // `keep: null` in it would silently keep one backup instead of fourteen.
    if (v === null || v === undefined || v === '') return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : fallback;
  };
  return {
    enabled: b.enabled === true,
    everyHours: int(b.everyHours, DEFAULTS.everyHours, 1, 24 * 30),
    keep: int(b.keep, DEFAULTS.keep, 1, 200),
  };
}

/* ------------------------------------------------------------- destination */

/** Where the copies go. `BT_BACKUP_DIR` wins; otherwise `<data>/backups`. */
export function targetDir() {
  return process.env.BT_BACKUP_DIR
    ? path.resolve(process.env.BT_BACKUP_DIR)
    : path.join(store.dataDir(), 'backups');
}

/** True when the destination came from the environment rather than the default. */
const usingCustomDir = () => !!process.env.BT_BACKUP_DIR;

/* -------------------------------------------------------------- the state */

/*
 * Kept beside the data rather than in the config: `lastRunAt` is a fact about
 * this machine, and carrying it inside a backup would tell a freshly restored
 * install that it had already backed itself up somewhere it has never written.
 * The schedule itself does travel, in the config, exactly as it does on Android.
 */
const stateFile = () => path.join(store.dataDir(), 'backup-state.json');

function readState() {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    return s && typeof s === 'object' ? s : {};
  } catch {
    return {};
  }
}

function writeState(patch) {
  const next = { ...readState(), ...patch };
  try {
    fs.mkdirSync(store.dataDir(), { recursive: true });
    const tmp = `${stateFile()}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, stateFile());
  } catch (err) {
    console.warn(`[backup] could not record state: ${err.message}`);
  }
  return next;
}

/* ------------------------------------------------------------ the filename */

/**
 * The same name the download button uses, so a directory of these sorts and
 * reads the way the ones people already have do.
 */
export function backupFilename(now = new Date()) {
  const stamp = `${now.toISOString().slice(0, 10)}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  return `${PREFIX}${stamp}${SUFFIX}`;
}

/* --------------------------------------------------------------- the write */

/**
 * Write one bundle now, then prune.
 *
 * Written to a temporary name and renamed into place, so a reader - or the
 * pruner on the next run - never sees a half-written file that looks like a
 * usable backup.
 */
function write(settings) {
  const dir = targetDir();
  fs.mkdirSync(dir, { recursive: true });

  const name = backupFilename();
  const file = path.join(dir, name);
  const tmp = `${file}.tmp-${process.pid}`;
  const body = zlib.gzipSync(
    Buffer.from(`${JSON.stringify(store.exportBundle(appInfo), null, 2)}\n`, 'utf8'),
  );

  try {
    fs.writeFileSync(tmp, body);
    fs.renameSync(tmp, file);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* nothing to clean up */ }
    throw err;
  }
  prune(dir, settings.keep);
  return { name, bytes: body.length };
}

/**
 * Drop everything past the newest `keep`.
 *
 * By modification time rather than by filename. The name carries a UTC date and
 * a local-clock time, which is not monotonic across a timezone whose offset
 * puts the two on different days - so sorting by name can, in some timezones
 * for one hour a day, decide the newest file is the oldest and delete the
 * backup that was just written. The filesystem knows the answer already.
 *
 * Only this app's own files are ever considered, because `BT_BACKUP_DIR` may
 * well be a folder with other things in it.
 */
function prune(dir, keep) {
  let entries;
  try {
    entries = fs.readdirSync(dir)
      .filter((n) => n.startsWith(PREFIX) && n.endsWith(SUFFIX))
      .map((n) => {
        try {
          return { name: n, at: fs.statSync(path.join(dir, n)).mtimeMs };
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch (err) {
    console.warn(`[backup] could not list ${dir}: ${err.message}`);
    return;
  }
  for (const old of entries.sort((a, b) => b.at - a.at).slice(keep)) {
    try {
      fs.unlinkSync(path.join(dir, old.name));
    } catch (err) {
      console.warn(`[backup] could not remove ${old.name}: ${err.message}`);
    }
  }
}

/** Run a backup, recording what happened either way. Never throws. */
export function run() {
  const settings = settingsOf(store.getConfig());
  try {
    const { name, bytes } = write(settings);
    writeState({ lastRunAt: new Date().toISOString(), lastFile: name, lastError: null });
    console.log(`[backup] wrote ${name} (${bytes} bytes) to ${targetDir()}`);
    return { ok: true };
  } catch (err) {
    // The time is recorded on failure too: a destination that has gone away -
    // an unmounted NAS - should not mean re-running the whole export every
    // fifteen minutes for as long as it stays away.
    writeState({ lastRunAt: new Date().toISOString(), lastError: err.message });
    console.error(`[backup] failed: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

/** Run only if switched on and the interval has elapsed. Safe to call often. */
export function runIfDue() {
  const settings = settingsOf(store.getConfig());
  if (!settings.enabled) return { ok: false, skipped: 'off' };

  const last = Date.parse(readState().lastRunAt || '');
  if (Number.isFinite(last) && Date.now() < last + settings.everyHours * 3_600_000) {
    return { ok: false, skipped: 'not due' };
  }
  return run();
}

/* -------------------------------------------------------------- the status */

/**
 * What the Setup screen shows. Deliberately the same shape the Android bridge
 * answers with, so one card in the shared web layer serves both.
 */
export function status() {
  const s = readState();
  return {
    available: true,
    defaultAvailable: true,
    // No folder picker on a server; the environment chooses instead.
    canPickFolder: false,
    usingFolder: usingCustomDir(),
    folder: targetDir(),
    lastRunAt: s.lastRunAt || null,
    lastFile: s.lastFile || null,
    lastError: s.lastError || null,
  };
}

/* ----------------------------------------------------------- the scheduler */

/**
 * Start checking. Called once at boot.
 *
 * A quarter-hour tick rather than a timer set to the exact due moment: the due
 * moment moves whenever the interval is changed in Setup, and a long
 * `setTimeout` would have to be torn down and rebuilt to notice. Asking a cheap
 * question four times an hour is simpler and cannot drift.
 */
export function start(app = {}) {
  appInfo = app;
  if (timer) clearInterval(timer);
  runIfDue();
  timer = setInterval(runIfDue, CHECK_EVERY_MS);
  timer.unref?.();
  return timer;
}

export function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}
