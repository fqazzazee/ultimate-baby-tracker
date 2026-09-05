/**
 * Default configuration seeded on first run.
 *
 * Everything here is user-editable from the Settings screen and is persisted to
 * data/config.json as pretty-printed, hand-editable JSON.
 */

export const POOP_COLORS = [
  { name: 'Meconium', hex: '#1c1a1a', note: 'Normal in the first days' },
  { name: 'Dark green', hex: '#2f4f2a' },
  { name: 'Green', hex: '#5c8a3c' },
  { name: 'Mustard', hex: '#d9a520' },
  { name: 'Yellow', hex: '#f2c94c' },
  { name: 'Tan', hex: '#c9a678' },
  { name: 'Brown', hex: '#8b5e3c' },
  { name: 'Orange', hex: '#e08a3c' },
  { name: 'Red / blood', hex: '#b02b2b', alert: 'Call your pediatrician about red or bloody stool.' },
  { name: 'White / clay', hex: '#ece4d8', alert: 'Call your pediatrician about pale, white or clay-coloured stool.' },
  { name: 'Black (after day 4)', hex: '#111111', alert: 'Black stool after the first days should be checked by a doctor.' },
];

/**
 * Nutrition profiles for what goes in a bottle, per 100 mL of *prepared* milk.
 *
 * These are approximate label values gathered from the manufacturers' own
 * nutrition panels, rounded, and offered only as a starting point: recipes get
 * reformulated, and a scoop measured at 3 a.m. is not a laboratory. Check the
 * tin and correct the numbers in Setup -> Nutrition; every profile is editable
 * and you can add your own.
 *
 * MIND THE BASIS. A US infant formula label declares nutrients per 100
 * *Calories* (21 CFR 107.10), not per 100 mL - so a panel reading "1.2 mg iron"
 * means 1.2 mg per 100 kcal, which at 20 kcal/fl oz is 0.81 mg per 100 mL.
 * Multiply a per-100-kcal figure by kcal-per-100-mL / 100 before it belongs
 * here. The milk editor in Setup will do that conversion for you.
 *
 * Keys must match NUTRIENTS in public/js/nutrition.js, which supplies the
 * label, unit and rounding for each one.
 */
export function defaultMilks() {
  return [
    {
      id: 'breast-milk', name: 'Breast milk', emoji: '\u{1F931}', kind: 'breastmilk', builtin: true,
      per100: { kcal: 67, protein: 1.0, fat: 3.9, carbs: 7.2, iron: 0.03, calcium: 25, vitaminD: 0.05, dha: 20, sodium: 17 },
    },
    {
      // Straight off Bobbie's own panel for the 14.1 oz can, which states
      // "Diluted: each 5 fl oz (150 mL) contains 100 calories" over a per-100-
      // Calorie table: protein 2.05 g, fat 5.5 g, carbohydrate 10.4 g, calcium
      // 78 mg, iron 1.2 mg, vitamin D 75 IU, sodium 25 mg. Every figure here is
      // that column divided by 1.5, the label's own bottle-to-100-mL ratio, and
      // vitamin D converted from IU (40 IU = 1 ug). DHA is not on the panel;
      // 20 mg/100 kcal comes from Bobbie's spec sheet for healthcare
      // professionals. The 24 oz and 12.7 oz cans are a different recipe -
      // check the tin and correct these in Setup if that is what you have.
      id: 'bobbie-original', name: 'Bobbie Organic Original', emoji: '\u{1F37C}', kind: 'formula', builtin: true,
      per100: { kcal: 66.7, protein: 1.37, fat: 3.67, carbs: 6.93, iron: 0.8, calcium: 52, vitaminD: 1.25, dha: 13.3, sodium: 16.7 },
    },
    {
      // Bobbie's whole-milk recipe, from the panel on the 14.1 oz can, read the
      // same way. Bobbie declares the same nutrient column as the Original -
      // what differs is where the fat and protein come from, not the numbers.
      id: 'bobbie-whole-milk', name: 'Bobbie Organic Whole Milk', emoji: '\u{1F37C}', kind: 'formula', builtin: true,
      per100: { kcal: 66.7, protein: 1.37, fat: 3.67, carbs: 6.93, iron: 0.8, calcium: 52, vitaminD: 1.25, dha: 13.3, sodium: 16.7 },
    },
    {
      id: 'similac-360', name: 'Similac 360 Total Care', emoji: '\u{1F37C}', kind: 'formula', builtin: true,
      per100: { kcal: 68, protein: 1.4, fat: 3.65, carbs: 7.5, iron: 1.22, calcium: 56, vitaminD: 1.0, dha: 11, sodium: 16 },
    },
    {
      id: 'enfamil-neuropro', name: 'Enfamil NeuroPro', emoji: '\u{1F37C}', kind: 'formula', builtin: true,
      per100: { kcal: 68, protein: 1.4, fat: 3.6, carbs: 7.5, iron: 1.2, calcium: 53, vitaminD: 1.4, dha: 17, sodium: 18 },
    },
    {
      id: 'kirkland-procare', name: 'Kirkland Signature ProCare', emoji: '\u{1F37C}', kind: 'formula', builtin: true,
      per100: { kcal: 68, protein: 1.45, fat: 3.6, carbs: 7.4, iron: 1.2, calcium: 57, vitaminD: 1.35, dha: 17, sodium: 16 },
    },
    {
      id: 'earths-best', name: "Earth's Best Organic Dairy", emoji: '\u{1F33F}', kind: 'formula', builtin: true,
      per100: { kcal: 68, protein: 1.45, fat: 3.4, carbs: 7.5, iron: 1.2, calcium: 56, vitaminD: 1.0, dha: 11, sodium: 17 },
    },
    {
      id: 'hipp-dutch', name: 'HiPP Dutch Stage 1', emoji: '\u{1F33F}', kind: 'formula', builtin: true,
      per100: { kcal: 66, protein: 1.25, fat: 3.5, carbs: 7.3, iron: 0.53, calcium: 51, vitaminD: 1.2, dha: 12, sodium: 17 },
    },
    {
      id: 'whole-milk', name: "Whole cow's milk", emoji: '\u{1F95B}', kind: 'cowmilk', builtin: true,
      per100: { kcal: 61, protein: 3.2, fat: 3.3, carbs: 4.8, iron: 0.03, calcium: 113, vitaminD: 1.3, dha: 0, sodium: 43 },
    },
  ];
}

/**
 * Give a timer button that records a side somewhere to put the split.
 *
 * Lives here rather than in a migration because all three editions need it and
 * only one of them can run `lib/store.js`: the server migrates with it, the
 * demo's ported `migrate()` calls it, and the Android overlay applies it before
 * stamping a config version - which without this would mark a config as
 * migrated that had never gained the fields.
 *
 * Additive and idempotent: it is safe to run on every save, adds nothing to a
 * button that already has the fields, and leaves the order of a hand-arranged
 * config alone apart from the two it inserts.
 *
 * Keyed off the fields rather than off the id `breast`, because that is what
 * the feature itself keys off - see supportsSides() in public/js/feeding.js.
 * A renamed or duplicated nursing button gets the same treatment.
 */
export function ensureSideFields(config) {
  for (const type of config?.eventTypes || []) {
    if (type.mode !== 'timer') continue;
    const fields = type.fields || [];
    const side = fields.find((f) => f.key === 'side');
    const names = (side?.options || []).map((o) => (typeof o === 'string' ? o : o?.name));
    if (!names.includes('Left') || !names.includes('Right')) continue;
    if (fields.some((f) => f.key === 'leftMin' || f.key === 'rightMin')) continue;
    const at = fields.findIndex((f) => f.key === 'duration');
    fields.splice(at >= 0 ? at + 1 : fields.length, 0,
      { key: 'leftMin', label: 'Left side', abbr: 'L', type: 'duration', unit: 'min' },
      { key: 'rightMin', label: 'Right side', abbr: 'R', type: 'duration', unit: 'min' });
    type.fields = fields;
  }
  return config;
}

/** Field types understood by the renderer: number, text, select, toggle, color, duration. */
export function defaultEventTypes() {
  return [
    {
      id: 'breast',
      sound: 'coo',
      label: 'Breastfeed',
      emoji: '🤱',
      tone: 'pink',
      mode: 'timer',
      order: 10,
      builtin: true,
      archived: false,
      fields: [
        { key: 'side', label: 'Side', type: 'select', options: ['Left', 'Right', 'Both'] },
        { key: 'duration', label: 'Duration', type: 'duration', unit: 'min' },
        // Filled in by the timer as the sides are switched, and editable
        // afterwards like any other field. `duration` stays the wall clock for
        // the whole session, so these two are a breakdown of it and not a
        // second, competing total.
        { key: 'leftMin', label: 'Left side', abbr: 'L', type: 'duration', unit: 'min' },
        { key: 'rightMin', label: 'Right side', abbr: 'R', type: 'duration', unit: 'min' },
        { key: 'amount', label: 'Amount', type: 'number', unit: 'cc', min: 0, max: 500, step: 5 },
      ],
      presets: [
        { id: 'left', label: 'Left', emoji: '🤱', data: { side: 'Left' } },
        { id: 'right', label: 'Right', emoji: '🤱', data: { side: 'Right' } },
        { id: 'both', label: 'Both', emoji: '🤱', data: { side: 'Both' } },
      ],
    },
    {
      id: 'bottle',
      sound: 'coo',
      label: 'Bottle',
      emoji: '🍼',
      tone: 'sky',
      mode: 'instant',
      order: 20,
      builtin: true,
      archived: false,
      fields: [
        { key: 'amount', label: 'Amount', type: 'number', unit: 'cc', min: 0, max: 500, step: 5, default: 60 },
        // optionsFrom pulls the choices from config.nutrition.milks at render
        // time, so adding a formula in Setup adds it here without a migration.
        { key: 'milk', label: 'What is in it', type: 'select', optionsFrom: 'milks' },
      ],
      presets: [
        { id: 'b30', label: '30 cc', emoji: '🍼', data: { amount: 30 } },
        { id: 'b60', label: '60 cc', emoji: '🍼', data: { amount: 60 } },
        { id: 'b90', label: '90 cc', emoji: '🍼', data: { amount: 90 } },
      ],
    },
    {
      id: 'diaper',
      sound: 'bubble',
      label: 'Diaper',
      emoji: '🧷',
      tone: 'mint',
      mode: 'instant',
      order: 30,
      builtin: true,
      archived: false,
      fields: [
        { key: 'pee', label: 'Wet (pee)', type: 'toggle' },
        { key: 'poop', label: 'Poop', type: 'toggle' },
        { key: 'color', label: 'Poop colour', type: 'color', options: POOP_COLORS, showIf: 'poop' },
        { key: 'texture', label: 'Texture', type: 'select', options: ['Runny', 'Seedy', 'Soft', 'Firm', 'Hard'], showIf: 'poop' },
      ],
      presets: [
        { id: 'pee', label: 'Wet', emoji: '💦', data: { pee: true } },
        { id: 'poop', label: 'Poop', emoji: '💩', data: { poop: true, color: 'Mustard' } },
        { id: 'both', label: 'Both', emoji: '💦💩', data: { pee: true, poop: true, color: 'Mustard' } },
      ],
    },
    {
      id: 'sleep',
      sound: 'twinkle',
      label: 'Sleep',
      emoji: '😴',
      tone: 'lavender',
      mode: 'timer',
      order: 40,
      builtin: true,
      archived: false,
      fields: [{ key: 'duration', label: 'Duration', type: 'duration', unit: 'min' }],
      presets: [{ id: 'nap', label: 'Nap', emoji: '😴', data: {} }],
    },
    {
      id: 'bath',
      sound: 'splash',
      label: 'Bath',
      emoji: '🛁',
      tone: 'sky',
      mode: 'instant',
      order: 50,
      builtin: true,
      archived: false,
      fields: [{ key: 'note', label: 'Note', type: 'text' }],
      presets: [{ id: 'bath', label: 'Bath', emoji: '🛁', data: {} }],
    },
    {
      id: 'pump',
      sound: 'ding',
      label: 'Pump',
      emoji: '🫙',
      tone: 'lemon',
      mode: 'instant',
      order: 60,
      builtin: true,
      archived: false,
      fields: [
        { key: 'side', label: 'Side', type: 'select', options: ['Left', 'Right', 'Both'] },
        { key: 'amount', label: 'Amount', type: 'number', unit: 'cc', min: 0, max: 500, step: 5 },
      ],
      presets: [{ id: 'pump', label: 'Pump', emoji: '🫙', data: {} }],
    },
    {
      id: 'medicine',
      sound: 'ding',
      label: 'Medicine',
      emoji: '💊',
      tone: 'peach',
      mode: 'instant',
      order: 70,
      builtin: true,
      archived: false,
      fields: [
        { key: 'name', label: 'Medicine', type: 'text' },
        { key: 'dose', label: 'Dose', type: 'text' },
      ],
      presets: [{ id: 'dose', label: 'Dose', emoji: '💊', data: {} }],
    },
    {
      id: 'note',
      sound: 'pop',
      label: 'Note',
      emoji: '📝',
      tone: 'lavender',
      mode: 'instant',
      order: 80,
      builtin: true,
      archived: false,
      fields: [{ key: 'note', label: 'Note', type: 'text' }],
      presets: [{ id: 'note', label: 'Note', emoji: '📝', data: {} }],
    },
  ];
}

export function defaultUsers() {
  return [
    { id: 'mom', name: 'Mom', emoji: '🤱', tone: 'pink' },
    { id: 'dad', name: 'Dad', emoji: '🧔', tone: 'sky' },
    { id: 'caregiver', name: 'Caregiver', emoji: '🧑‍🍼', tone: 'mint' },
  ];
}

export function defaultAlarms() {
  return [
    {
      id: 'feed-reminder',
      label: 'Feeding time',
      emoji: '🍼',
      enabled: false,
      mode: 'sinceLast',        // sinceLast | interval | timeOfDay
      typeIds: ['breast', 'bottle'],
      babyId: 'all',
      everyMinutes: 180,
      times: [],
      leadMinutes: 0,
      snoozeMinutes: 10,
      sound: 'chime',
      repeat: true,
      quietHours: null,          // e.g. { from: '23:00', to: '06:00' }
    },
    {
      id: 'diaper-reminder',
      label: 'Diaper check',
      emoji: '🧷',
      enabled: false,
      mode: 'sinceLast',
      typeIds: ['diaper'],
      babyId: 'all',
      everyMinutes: 240,
      times: [],
      leadMinutes: 0,
      snoozeMinutes: 15,
      sound: 'bubble',
      repeat: true,
      quietHours: null,
    },
  ];
}

export function defaultConfig() {
  return {
    version: 1,
    babies: [],
    users: defaultUsers(),
    eventTypes: defaultEventTypes(),
    alarms: defaultAlarms(),
    nutrition: {
      enabled: true,
      defaultMilkId: 'breast-milk',
      // Which nutrients get their own row on screen. The rest stay in the
      // profile and are still exported - they are simply not shown.
      show: ['kcal', 'protein', 'fat', 'carbs', 'iron', 'dha'],
      milks: defaultMilks(),
    },
    // Which history charts the Statistics screen draws. A metric that is not
    // tracked never draws one whatever this says, so a switch here only hides
    // a chart - nothing stops being recorded, and ticking it back brings the
    // whole history with it.
    stats: {
      charts: {
        intake: true, feeds: true, diapers: true, sleep: true, pump: true, clock: true,
        sides: true,
      },
      // Charts built from a button's own fields, as
      // `buttons[typeId][metricKey] = false` to switch one off. Empty here
      // because the keys name buttons that do not exist yet: a button you make
      // yourself is charted unless you say otherwise, one that ships with the
      // app is not until you ask. See customChartOn() in public/js/stats.js.
      buttons: {},
      // Which buttons put their metrics on one chart instead of one each, as
      // `combine[typeId] = true`. Off by default: only you know that a "Left"
      // and a "Right" you invented are two halves of one thing.
      combine: {},
      // Which of those combined pairs are stacked into a total rather than set
      // side by side, as `stack[typeId] = true`. A stronger claim than
      // combining - that the parts add up - so it is its own switch.
      stack: {},
    },
    // Unattended backups, off until somebody turns them on. The schedule
    // travels in a backup; where the copies go does not, because that is a fact
    // about one machine. See lib/autobackup.js.
    backup: {
      enabled: false,
      everyHours: 24,
      keep: 14,
    },
    settings: {
      theme: 'auto',            // auto | light | dark
      sound: true,
      volume: 0.6,
      haptics: true,
      volumeUnit: 'cc',
      refreshSeconds: 20,
      timeFormat: '12h',        // 12h | 24h
      confirmDelete: true,
    },
  };
}
