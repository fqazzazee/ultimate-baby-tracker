/**
 * Metric and US measurements, as a display layer over one stored form.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE: what is written down never changes.
 *
 * A bottle logged as 90 cc is 90 cc for ever. Switching the app to US units
 * does not rewrite it to 3.04 and it does not reinterpret the 90 as ounces - it
 * shows the same quantity in a different notation, the way a clock shows the
 * same instant in 12- or 24-hour form. That is the only version of this feature
 * that is safe: a toggle that converted stored numbers would, on its second
 * flip, be converting numbers it had already converted, and a mistimed flip
 * would silently multiply a month of feeds by 29.6.
 *
 * So every event, every milk profile and every baby's weight stays in the unit
 * `lib/defaults.js` declares - millilitres, kilograms, centimetres, minutes -
 * and everything a person reads or types passes through here.
 *
 * WHAT IS NOT CONVERTED, AND WHY.
 *
 * Grams, milligrams, micrograms and calories are left alone. They are the units
 * a nutrition panel is printed in on both sides of the Atlantic: a US formula
 * tin states protein in grams, and turning that into ounces would make the
 * number unrecognisable against the tin it was copied from. Minutes are minutes.
 * Anything with no entry here is passed through untouched, which is also what
 * makes a unit somebody invents for their own field safe.
 *
 * UNITS SOMEBODY DEFINES THEMSELVES.
 *
 * The five pairs below are the ones a baby app cannot do without. They are not
 * the only ones anybody wants: a field for solids wants grams and ounces, one
 * for a walk wants kilometres and miles, one for a room wants millimetres of
 * rain if that is what you are recording. Setup -> Measurements lets a pair be
 * declared, and `setCustomUnits` hands the list to this module.
 *
 * A registry rather than a parameter threaded through forty call sites, and the
 * same shape `util.js` already uses for the 12/24-hour clock: one setter called
 * from `applySettings()` in core.js, on every refresh and every config save,
 * before anything renders. The rule the top of this file states holds for these
 * exactly as it does for the built-ins - the metric side is what gets stored,
 * always, and declaring or deleting a pair changes notation and never a number.
 */

/** The two systems, for a segmented control. */
export const UNIT_SYSTEMS = [
  { value: 'metric', label: 'Metric', hint: 'ml, kg, cm' },
  { value: 'us', label: 'US', hint: 'fl oz, lb, in' },
];

/**
 * Canonical unit -> how the US system writes it.
 *
 * `to` and `from` rather than a single factor because temperature is affine,
 * and a factor alone would put freezing at 0 °F.
 */
const US = {
  cc: { unit: 'fl oz', to: (v) => v / 29.5735295625, from: (v) => v * 29.5735295625, dp: 1, step: 0.5 },
  ml: { unit: 'fl oz', to: (v) => v / 29.5735295625, from: (v) => v * 29.5735295625, dp: 1, step: 0.5 },
  kg: { unit: 'lb', to: (v) => v * 2.2046226218, from: (v) => v / 2.2046226218, dp: 2, step: 0.05 },
  cm: { unit: 'in', to: (v) => v / 2.54, from: (v) => v * 2.54, dp: 1, step: 0.1 },
  '°C': { unit: '°F', to: (v) => v * 1.8 + 32, from: (v) => (v - 32) / 1.8, dp: 1, step: 0.1 },
  C: { unit: '°F', to: (v) => v * 1.8 + 32, from: (v) => (v - 32) / 1.8, dp: 1, step: 0.1 },
};

/**
 * Decimals a canonical unit is worth showing in metric.
 *
 * Not the same question as the US table answers. Millilitres are whole numbers;
 * a weight in kilograms is not, and rounding 5.34 kg to "5 kg" would throw away
 * most of a month's growth on the way to the screen.
 */
const METRIC_DP = { cc: 0, ml: 0, kg: 2, cm: 1, '°C': 1, C: 1 };

/* --------------------------------------------------------- custom pairs */

/**
 * Pairs declared in Setup, as `metric unit (lowercased) -> compiled rule`.
 *
 * Rebuilt wholesale by `setCustomUnits` rather than patched, so a pair deleted
 * in Setup stops converting the moment the config is saved rather than
 * lingering until a reload.
 */
let CUSTOM = new Map();

/**
 * How a stored pair is read.
 *
 * `per` is "how many of the metric unit make one US unit", which is the
 * question a person can answer without thinking about which way the division
 * goes: 28.35 g make one oz, 1.609 km make one mile. `offset` is added
 * afterwards and exists for the one shape a factor cannot express - a scale
 * whose zero is somewhere else, as °F's is. Both directions are derived from
 * the same two numbers, so they cannot drift apart.
 */
function compile(pair) {
  const metric = String(pair?.metric || '').trim();
  const us = String(pair?.us || '').trim();
  const per = Number(pair?.per);
  const offset = Number(pair?.offset) || 0;
  // A `per` of zero or less is not a slightly wrong conversion, it is a divide
  // by zero or a mirror; refuse it rather than plotting Infinity.
  if (!metric || !us || !Number.isFinite(per) || per <= 0) return null;
  const dp = clampDp(pair?.usDp, 1);
  return {
    metric,
    unit: us,
    to: (v) => v / per + offset,
    from: (v) => (v - offset) * per,
    dp,
    step: stepFromDp(dp),
    metricDp: clampDp(pair?.metricDp, 0),
    metricStep: stepFromDp(clampDp(pair?.metricDp, 0)),
    per,
    offset,
  };
}

/** Decimal places, held to something a screen can show. */
function clampDp(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(4, Math.max(0, Math.round(n)));
}

/**
 * A stepper increment matched to the precision on show.
 *
 * A step finer than the displayed rounding makes the buttons look broken - two
 * taps and the number has not changed - so it is derived from the decimals
 * rather than asked for separately.
 */
const stepFromDp = (dp) => 10 ** -dp;

/**
 * Install the pairs from the config. Called from `applySettings()`.
 *
 * Anything that does not compile is dropped silently: this runs on every
 * refresh, a hand-edited config.json is a supported way to work here, and a
 * toast on every poll would be worse than the missing conversion.
 */
export function setCustomUnits(list) {
  const next = new Map();
  for (const pair of Array.isArray(list) ? list : []) {
    const compiled = compile(pair);
    // Never over a built-in: `cc` and `kg` are what the shipped buttons store,
    // and a pair that redefined one would silently rescale the whole history.
    if (!compiled || isBuiltinUnit(compiled.metric)) continue;
    next.set(compiled.metric.toLowerCase(), compiled);
  }
  CUSTOM = next;
}

/** Which system the config asks for. Anything unrecognised means metric. */
export function unitSystem(config) {
  return config?.settings?.units === 'us' ? 'us' : 'metric';
}

/** Built-in or user-declared, whichever knows this unit. Built-ins win. */
function pairFor(unit) {
  if (!unit) return null;
  const lower = String(unit).toLowerCase();
  return US[unit] || US[lower] || CUSTOM.get(lower) || null;
}

/** The conversion for a unit, or null when there is nothing to convert. */
function rule(unit, system) {
  if (system !== 'us') return null;
  return pairFor(unit);
}

/** True when this unit reads differently in the two systems. */
export function isConvertible(unit) {
  return !!pairFor(unit);
}

/**
 * Whether the units module owns this name itself.
 *
 * The five built-in pairs are what the shipped buttons store in, so a declared
 * pair may not shadow one: a `kg` redefined here would rescale every weight
 * ever recorded on the way to the screen. `setCustomUnits` refuses such a pair
 * outright; this is so Setup can say why before it is saved rather than letting
 * it vanish silently.
 */
export function isBuiltinUnit(unit) {
  const key = String(unit || '');
  return !!(US[key] || US[key.toLowerCase()]);
}

/**
 * Every unit that converts, for offering rather than making somebody guess.
 *
 * The field editor's unit box is free text and stays that way - a unit nobody
 * anticipated has to remain typeable - but a list of the ones that will convert
 * turns "will this chart in ounces?" from an experiment into a glance.
 */
export function convertibleUnits() {
  const out = [];
  for (const [key, r] of Object.entries(US)) {
    // `C` is only there so a field that spells the degree sign out of its unit
    // still converts. Offering it beside `°C` would suggest they differ.
    if (key === 'C') continue;
    out.push({ metric: key, us: r.unit, builtin: true });
  }
  for (const r of CUSTOM.values()) out.push({ metric: r.metric, us: r.unit, builtin: false });
  return out;
}

/**
 * What this unit is called on the other side, or null when it has no other
 * side. For telling somebody, at the moment they type a unit, whether it will
 * follow the Metric/US switch or simply stand still.
 */
export function usNameFor(unit) {
  return pairFor(unit)?.unit ?? null;
}

/** How the unit is written in this system: `cc` -> `fl oz`. */
export function displayUnit(unit, system) {
  return rule(unit, system)?.unit ?? unit;
}

/** A stored number, in the unit a person is being shown. */
export function toDisplay(value, unit, system) {
  const r = rule(unit, system);
  const n = Number(value);
  if (!r || !Number.isFinite(n)) return n;
  return r.to(n);
}

/** A number somebody typed, back into the unit it is stored in. */
export function fromDisplay(value, unit, system) {
  const r = rule(unit, system);
  const n = Number(value);
  if (!r || !Number.isFinite(n)) return n;
  return r.from(n);
}

/** Decimals worth showing. Millilitres are whole; fluid ounces are not. */
export function decimalsFor(unit, system, fallback = 0) {
  const r = rule(unit, system);
  if (r) return r.dp;
  const key = unit in METRIC_DP ? unit : String(unit || '').toLowerCase();
  if (key in METRIC_DP) return METRIC_DP[key];
  // A declared pair says how precise its metric side is too - grams are whole
  // numbers, kilometres are not - and that half is on show in metric.
  return CUSTOM.get(String(unit || '').toLowerCase())?.metricDp ?? fallback;
}

/**
 * A sensible stepper increment in the displayed unit.
 *
 * A step written on the field wins over the unit's own, in both systems: it is
 * the more specific statement, and the shipped bottle field asks for 5 cc a tap
 * rather than the 1 cc that millilitres alone would suggest.
 */
export function stepFor(unit, system, fieldStep = undefined) {
  // A step is written in the unit the field stores, so in US it is the wrong
  // size by exactly the conversion factor and the pair's own step is used.
  const converted = rule(unit, system);
  if (converted) return converted.step;
  const own = Number(fieldStep);
  if (Number.isFinite(own) && own > 0) return own;
  return CUSTOM.get(String(unit || '').toLowerCase())?.metricStep ?? 1;
}

/**
 * Round a displayed number for storage.
 *
 * Two decimals past the precision the stored side is shown at: enough that
 * typing 4 fl oz stores a value that reads back as 4 fl oz, without writing
 * 118.29411764705883 into a file somebody is invited to open in a text editor.
 *
 * Derived rather than fixed at three, which is what it used to be. Three is
 * right for millilitres and generous for kilograms, and it silently truncated
 * any pair somebody declared whose metric side wants more than one decimal.
 */
export function roundCanonical(value, unit, system) {
  const r = rule(unit, system);
  if (!r || !Number.isFinite(value)) return value;
  const factor = 10 ** (decimalsFor(unit, 'metric', 1) + 2);
  return Math.round(value * factor) / factor;
}

/** "90 cc" or "3 fl oz" - a quantity with its unit, in the current system. */
export function fmtQty(value, unit, system, fallbackDp = 0) {
  const n = toDisplay(value, unit, system);
  if (!Number.isFinite(n)) return '';
  const dp = decimalsFor(unit, system, fallbackDp);
  const shown = Number(n.toFixed(dp));
  const u = displayUnit(unit, system);
  return u ? `${shown} ${u}` : String(shown);
}

/**
 * The unit a per-body-weight figure is quoted against: cc/kg becomes fl oz/lb.
 *
 * Returned as a pair so a caller can divide by the right number as well as
 * print the right label - the two must not be able to disagree.
 */
export function perWeight(system) {
  return system === 'us'
    ? { unit: 'lb', of: (kg) => kg * 2.2046226218 }
    : { unit: 'kg', of: (kg) => kg };
}
