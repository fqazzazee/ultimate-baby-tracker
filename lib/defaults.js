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
        { key: 'content', label: 'Contents', type: 'select', options: ['Breast milk', 'Formula', 'Mixed'] },
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
