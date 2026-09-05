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

/** Which system the config asks for. Anything unrecognised means metric. */
export function unitSystem(config) {
  return config?.settings?.units === 'us' ? 'us' : 'metric';
}

/** The conversion for a unit, or null when there is nothing to convert. */
function rule(unit, system) {
  if (system !== 'us' || !unit) return null;
  return US[unit] || US[String(unit).toLowerCase()] || null;
}

/** True when this unit reads differently in the two systems. */
export function isConvertible(unit) {
  return !!(US[unit] || US[String(unit || '').toLowerCase()]);
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
  return key in METRIC_DP ? METRIC_DP[key] : fallback;
}

/** A sensible stepper increment in the displayed unit. */
export function stepFor(unit, system, canonicalStep = 1) {
  return rule(unit, system)?.step ?? canonicalStep;
}

/**
 * Round a displayed number for storage.
 *
 * Two decimals past the display precision: enough that typing 4 fl oz stores a
 * value that reads back as 4 fl oz, without writing 118.29411764705883 into a
 * file somebody is invited to open in a text editor.
 */
export function roundCanonical(value, unit, system) {
  const r = rule(unit, system);
  if (!r || !Number.isFinite(value)) return value;
  return Math.round(value * 1000) / 1000;
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
