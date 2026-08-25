/**
 * Audible feedback, synthesised with the Web Audio API so the app ships no
 * media files. Browsers only allow audio after a user gesture, so the context
 * is created lazily and resumed on the first tap (see unlock()).
 */

let ctx = null;
let master = null;
let enabled = true;
let volume = 0.6;
let ringTimer = null;

function ensureCtx() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = volume;
  master.connect(ctx.destination);
  return ctx;
}

export function configure(opts = {}) {
  if ('sound' in opts) enabled = !!opts.sound;
  if ('volume' in opts) {
    volume = Math.max(0, Math.min(1, Number(opts.volume) || 0));
    if (master) master.gain.value = volume;
  }
}

/** Call from a real user gesture so iOS/Safari will let us make noise later. */
export function unlock() {
  const c = ensureCtx();
  if (c && c.state === 'suspended') c.resume().catch(() => {});
}

/** One soft note. Sine + a touch of triangle reads as "music box", not "beep". */
function note(freq, startAt, dur, gain = 0.25, type = 'sine') {
  const c = ensureCtx();
  if (!c) return;
  const t0 = c.currentTime + startAt;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

/** A short pitch sweep - used for the "bubble"/pop feedback. */
function swoop(from, to, startAt, dur, gain = 0.22) {
  const c = ensureCtx();
  if (!c) return;
  const t0 = c.currentTime + startAt;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(from, t0);
  osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

const RECIPES = {
  // name: (play) => void
  chime: () => { note(880, 0, 0.35); note(1174.7, 0.09, 0.42); },
  ding: () => { note(1318.5, 0, 0.30); },
  bubble: () => { swoop(420, 900, 0, 0.16); },
  pop: () => { swoop(700, 300, 0, 0.13, 0.28); },
  coo: () => { note(659.3, 0, 0.22); note(784, 0.12, 0.28); note(1046.5, 0.24, 0.34); },
  splash: () => { swoop(300, 1200, 0, 0.25, 0.18); note(1568, 0.2, 0.3, 0.12); },
  twinkle: () => { [1046.5, 1318.5, 1568, 2093].forEach((f, i) => note(f, i * 0.07, 0.28, 0.16)); },
  success: () => { note(659.3, 0, 0.18); note(880, 0.1, 0.26); },
  error: () => { note(220, 0, 0.22, 0.3, 'triangle'); note(180, 0.12, 0.3, 0.3, 'triangle'); },
  undo: () => { swoop(600, 320, 0, 0.18, 0.22); },
};

export const SOUND_NAMES = Object.keys(RECIPES);

export function play(name = 'chime') {
  if (!enabled) return;
  unlock();
  (RECIPES[name] || RECIPES.chime)();
}

/** A rising 4-note phrase, repeated - deliberately hard to sleep through. */
function alarmPhrase() {
  const seq = [523.3, 659.3, 784, 1046.5, 784, 1046.5];
  seq.forEach((f, i) => note(f, i * 0.16, 0.30, 0.34, i % 2 ? 'triangle' : 'sine'));
}

export function startRinging() {
  if (!enabled || ringTimer) return;
  unlock();
  alarmPhrase();
  ringTimer = setInterval(alarmPhrase, 1600);
}

export function stopRinging() {
  if (ringTimer) clearInterval(ringTimer);
  ringTimer = null;
}

export function isRinging() {
  return ringTimer !== null;
}

export function buzz(pattern = 18) {
  try { navigator.vibrate?.(pattern); } catch { /* unsupported */ }
}
