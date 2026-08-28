/**
 * Nutrition: turn a recorded volume into nutrients.
 *
 * Every milk profile in config.nutrition.milks carries its label values per
 * 100 mL of prepared milk, so an entry with an `amount` in cc scales linearly:
 * 90 cc of something at 68 kcal/100 mL is 61.2 kcal. Entries with no volume -
 * a breastfeed timed but not measured - contribute nothing and are counted
 * separately so the totals can say so out loud.
 */

import { esc } from './util.js';

/**
 * The nutrients a profile may carry. `dp` is how many decimals to show; `key`
 * must match the per100 keys written by lib/defaults.js.
 */
export const NUTRIENTS = [
  { key: 'kcal', label: 'Energy', unit: 'kcal', dp: 0, emoji: '🔥' },
  { key: 'protein', label: 'Protein', unit: 'g', dp: 1, emoji: '🥚' },
  { key: 'fat', label: 'Fat', unit: 'g', dp: 1, emoji: '🧈' },
  { key: 'carbs', label: 'Carbs', unit: 'g', dp: 1, emoji: '🌾' },
  { key: 'iron', label: 'Iron', unit: 'mg', dp: 2, emoji: '🩸' },
  { key: 'calcium', label: 'Calcium', unit: 'mg', dp: 0, emoji: '🦴' },
  { key: 'vitaminD', label: 'Vitamin D', unit: 'µg', dp: 1, emoji: '☀️' },
  { key: 'dha', label: 'DHA', unit: 'mg', dp: 0, emoji: '🧠' },
  { key: 'sodium', label: 'Sodium', unit: 'mg', dp: 0, emoji: '🧂' },
];

export const MILK_KINDS = [
  { value: 'formula', label: '🍼 Formula' },
  { value: 'breastmilk', label: '🤱 Breast milk' },
  { value: 'cowmilk', label: '🥛 Cow / plant milk' },
];

export const nutrientMeta = (key) => NUTRIENTS.find((n) => n.key === key) || null;

export function nutritionOn(cfg) {
  return cfg?.nutrition?.enabled !== false && (cfg?.nutrition?.milks || []).length > 0;
}

/** The nutrients the user asked to see, in NUTRIENTS order. */
export function shownNutrients(cfg) {
  const want = new Set(cfg?.nutrition?.show || []);
  return NUTRIENTS.filter((n) => want.has(n.key));
}

export function milkById(cfg, id) {
  return (cfg?.nutrition?.milks || []).find((m) => m.id === id) || null;
}

/**
 * A profile switched off in Setup -> Nutrition. The flag only stops it being
 * *offered*: entries logged against it keep their numbers, so switching a
 * formula off when a tin runs out never rewrites history.
 */
export const milkEnabled = (milk) => milk?.enabled !== false;

/** The profiles still on offer, in the order Setup lists them. */
export function enabledMilks(cfg) {
  return (cfg?.nutrition?.milks || []).filter(milkEnabled);
}

/**
 * Which milk an entry counts as. The picker stores the profile's name, so
 * match on that first; a breastfeed with no picker falls back to whatever
 * profile is marked as breast milk, and everything else to the chosen default.
 */
export function milkFor(cfg, event) {
  const milks = cfg?.nutrition?.milks || [];
  const live = enabledMilks(cfg);
  const picked = event?.data?.milk;
  // An explicit choice wins even if that profile has since been switched off -
  // it is what was actually in the bottle.
  if (picked) {
    const hit = milks.find((m) => m.name === picked || m.id === picked);
    if (hit) return hit;
  }
  if (event?.typeId === 'breast') {
    const bm = live.find((m) => m.kind === 'breastmilk') || milks.find((m) => m.kind === 'breastmilk');
    if (bm) return bm;
  }
  const fallback = milkById(cfg, cfg?.nutrition?.defaultMilkId);
  if (fallback && milkEnabled(fallback)) return fallback;
  return live[0] || fallback || milks[0] || null;
}

/** Nutrients in one entry, or null when there is no volume to scale by. */
export function nutrientsOf(cfg, event) {
  const ml = Number(event?.data?.amount) || 0;
  if (ml <= 0) return null;
  const milk = milkFor(cfg, event);
  if (!milk) return null;
  const factor = ml / 100;
  const values = {};
  for (const n of NUTRIENTS) {
    const per = Number(milk.per100?.[n.key]);
    if (Number.isFinite(per)) values[n.key] = per * factor;
  }
  return { milk, ml, values };
}

/**
 * Which buttons count as milk going into the baby.
 *
 * The two built-ins, plus anything carrying a milk picker - so a custom "Night
 * bottle" button with a `milk` field counts, while a custom button that merely
 * happens to record an amount (medicine in ml, a bath temperature) does not.
 * Pumping is milk coming *out* and never counts.
 */
export function milkTypeIds(cfg) {
  const ids = new Set(['breast', 'bottle']);
  for (const t of cfg?.eventTypes || []) {
    if ((t.fields || []).some((f) => f.optionsFrom === 'milks')) ids.add(t.id);
  }
  ids.delete('pump');
  return ids;
}

/** A feed with a volume on it - the only kind this can turn into nutrients. */
export function isIntake(cfg, event) {
  return milkTypeIds(cfg).has(event?.typeId) && Number(event?.data?.amount) > 0;
}

/**
 * Roll a list of entries into one nutrient total.
 *
 * `unmeasured` counts the feeds that recorded no volume: a nursing session
 * timed but not weighed is real intake this cannot see, and the UI says so
 * rather than quietly implying the baby ate less.
 */
export function totalNutrients(cfg, events) {
  const totals = {};
  const feeding = milkTypeIds(cfg);
  let ml = 0;
  let counted = 0;
  let unmeasured = 0;

  for (const e of events) {
    if (!feeding.has(e.typeId)) continue;
    const n = Number(e.data?.amount) > 0 ? nutrientsOf(cfg, e) : null;
    if (!n) { unmeasured += 1; continue; }
    counted += 1;
    ml += n.ml;
    for (const [k, v] of Object.entries(n.values)) totals[k] = (totals[k] || 0) + v;
  }
  return { totals, ml, counted, unmeasured };
}

export function fmtNutrient(key, value) {
  const meta = nutrientMeta(key);
  if (!meta || !Number.isFinite(value)) return '—';
  return `${value.toFixed(meta.dp)} ${meta.unit}`;
}

/** One line describing a milk, for lists and pickers. */
export function milkSummary(milk) {
  const per = milk.per100 || {};
  const bits = [`${Number(per.kcal) || 0} kcal`];
  if (Number.isFinite(Number(per.protein))) bits.push(`${per.protein} g protein`);
  if (Number.isFinite(Number(per.iron))) bits.push(`${per.iron} mg iron`);
  return `${esc(bits.join(' · '))} <span class="muted">per 100 mL</span>`;
}

/* ------------------------------------------------------- reference intakes */

/**
 * Infant reference intakes, from the US Dietary Reference Intakes (Institute
 * of Medicine / NASEM).
 *
 * Two things about these numbers matter more than the numbers themselves.
 *
 * For 0-6 months almost all of them are an *Adequate Intake*: the observed
 * average of what healthy, exclusively breastfed infants actually take in.
 * It is a description of well-fed babies, not a bar to clear - being under it
 * is not a deficiency, and there is no prize for being over it.
 *
 * And they are population figures. This app can only see feeds where somebody
 * wrote down a volume, so a nursed baby's real intake is invisible to it. The
 * comparison is a talking point for an appointment, never a verdict.
 */
const YOUNG = '0-6 months';
const OLDER = '7-12 months';

const REFERENCE_INTAKES = {
  // Energy is the odd one out: it scales with body mass, so it is quoted per
  // kilo and needs a weight on the baby's profile before it means anything.
  kcal: {
    perKg: { young: 100, older: 80 },
    kind: 'Estimated requirement',
    note: 'Energy needs fall per kilo as a baby grows, and vary a lot between babies of the same size.',
  },
  protein: { young: 9.1, older: 11, kind: { young: 'Adequate Intake', older: 'RDA' } },
  fat: { young: 31, older: 30, kind: 'Adequate Intake' },
  carbs: { young: 60, older: 95, kind: 'Adequate Intake' },
  iron: {
    young: 0.27, older: 11, kind: { young: 'Adequate Intake', older: 'RDA' },
    note: 'Expect a formula-fed baby to read far above the 0-6 month figure, and do not read anything into it: that figure is the amount in breast milk, and formula is iron-fortified on purpose. The jump at six months is real, though — babies are born with an iron store that runs down around then, which is why iron-rich first foods get talked about so much.',
  },
  calcium: { young: 200, older: 260, kind: 'Adequate Intake' },
  vitaminD: {
    young: 10, older: 10, kind: 'Adequate Intake',
    note: 'Milk on its own rarely reaches this, which is why a vitamin D supplement for infants is such a common recommendation. Worth raising at your next visit.',
  },
  dha: {
    young: null, older: null,
    note: 'There is no US reference intake for DHA in infancy. Formulas that add it typically land near the amount found in breast milk, which is roughly what the figures in these profiles reflect.',
  },
  sodium: {
    young: 110, older: 370, kind: 'Adequate Intake',
    note: 'Infant sodium comes almost entirely from milk. The reference is a floor rather than a limit to stay under.',
  },
};

/** Age in whole days, or null when no birthday is set. */
export function ageDays(baby) {
  if (!baby?.birthDate) return null;
  const born = new Date(`${baby.birthDate}T00:00:00`);
  if (Number.isNaN(born.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - born.getTime()) / 86_400_000));
}

const pick = (v, band) => (v && typeof v === 'object' && !Array.isArray(v) ? v[band] : v);

/**
 * The reference figure for one nutrient at this baby's age, or null when there
 * is not one. `assumed` flags that no birthday was set and the younger band
 * was used, so the UI can say so rather than quietly guessing.
 */
export function referenceFor(key, baby) {
  const ref = REFERENCE_INTAKES[key];
  const meta = nutrientMeta(key);
  if (!ref || !meta) return null;

  const days = ageDays(baby);
  const band = days === null || days < 183 ? 'young' : 'older';
  const weight = Number(baby?.weightKg) || 0;

  let value = null;
  let basis = band === 'young' ? YOUNG : OLDER;
  if (ref.perKg) {
    const perKg = ref.perKg[band];
    value = weight ? perKg * weight : null;
    basis = weight
      ? `${perKg} ${meta.unit}/kg at ${basis} · ${weight} kg`
      : `${perKg} ${meta.unit}/kg at ${basis} — add a weight in Setup for a daily figure`;
  } else {
    value = ref[band];
  }

  return {
    key,
    label: meta.label,
    unit: meta.unit,
    value: Number.isFinite(value) ? value : null,
    kind: pick(ref.kind, band) || null,
    basis,
    note: ref.note || null,
    assumedAge: days === null,
    // Distinguishes "needs a weight" from "no such figure exists".
    perKgOnly: !!ref.perKg,
    band,
  };
}

/** Reference figures read better without the trailing zeros of a data value. */
export function tidy(n, dp = 2) {
  return Number(n.toFixed(dp)).toString();
}

/**
 * The one-line version, for a hover tip. `when` names the window the figure
 * came from, so a 7-day card says "a day on average" rather than "today".
 */
export function referenceLine(key, taken, baby, when = 'so far today') {
  const ref = referenceFor(key, baby);
  const meta = nutrientMeta(key);
  if (!meta) return '';
  const got = `${taken.toFixed(meta.dp)} ${meta.unit} ${when}`;
  if (!ref) return got;
  if (ref.value === null) {
    // Two different silences: energy needs a weight, DHA has no figure at all.
    return `${got} · ${ref.perKgOnly ? 'add a weight in Setup for a daily figure' : 'no reference figure exists for infants'}`;
  }
  const pct = Math.round((taken / ref.value) * 100);
  return `${got} · about ${pct}% of the ${ref.kind || 'reference'} for ${ref.band === 'young' ? YOUNG : OLDER} (${tidy(ref.value)} ${meta.unit})`;
}
