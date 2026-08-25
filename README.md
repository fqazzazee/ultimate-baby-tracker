# 🍼 Ultimate Baby Tracker

One-tap tracking for a newborn: feeds, diapers, sleep, baths, medicine — and
anything else you care to invent. Built for 3 a.m. operation with one thumb.

- **No accounts, no login.** Open the page and start tapping.
- **No dependencies, no build step.** Plain Node, plain HTML/CSS/JS.
- **Plain-text storage.** Everything lives in `data/` as JSON you can read,
  edit and back up. It survives restarts and reboots.
- **Multiple babies**, each with its own profile, colour and age.
- **Multiple people** — every entry records who did it ("Mom fed 60 cc at 2:04 PM").
- **Programmable alarms** — "tell me if she hasn't fed in 3 hours".
- **Light and dark nursery themes**, big buttons, sound and vibration feedback.

## Run it

```bash
node server.js
# → http://localhost:8080
```

That's the whole install. Node 18 or newer, nothing to `npm install`.

| Variable | Default | What it does |
| --- | --- | --- |
| `BT_PORT` | `8080` | Port to listen on |
| `BT_HOST` | `0.0.0.0` | Bind address — the default lets phones on your Wi-Fi connect |
| `BT_DATA_DIR` | `./data` | Where the plain-text files are kept |

```bash
BT_PORT=3000 BT_DATA_DIR=/srv/baby node server.js
```

Open `http://<your-computer's-IP>:8080` on a phone and add it to the home
screen — it installs as a standalone app.

> There is no authentication, on purpose. Run it on a network you trust; don't
> expose it directly to the internet.

## Using it

**Track** — the main screen. Every card is one kind of event, and every button
on it logs immediately: tap **Poop** and the time is saved, with a chime, a
stamp on screen and a buzz. A toast offers **Undo** and **Details** for a few
seconds afterwards, so a mis-tap costs nothing.

- Pick the baby (top strip) and who you are ("Logging as") once; both stick.
- **Breastfeed** and **Sleep** are timers: first tap starts, second tap stops
  and saves the duration. A running timer survives a server restart.
- The **⋯** button on any card opens the full form — amount, side, poop colour,
  a different time, a note.

**History** — everything logged, grouped by day, filterable by type, with daily
totals. Tap any entry to edit or delete it. Exports to CSV.

**Alarms** — see below.

**Setup** — babies, people, buttons, theme and sound.

## Alarms

Three kinds, each configurable per baby:

| Mode | Behaviour | Good for |
| --- | --- | --- |
| **After last** | Rings `N` minutes after the last matching entry. Logging one resets the countdown. | "Feed if it's been 3 hours" |
| **Every** | Fixed cadence regardless of activity. | Pumping every 2 hours |
| **At time** | Wall-clock times, e.g. `08:00` and `20:00`. | Vitamin D, medication |

When one fires you get a full-screen card with three choices: **log it now**
(which records the event and resets the alarm), **snooze**, or **dismiss**.
Quiet hours keep it silent overnight. Allow notifications and it will nudge you
even when the tab is in the background.

The countdown is computed by the server but evaluated in the browser every
second, so an alarm rings on time rather than at the next poll.

## Custom buttons

Setup → Buttons → **New button** builds a tracked event from scratch:

- **Fields** to record — number (with a unit like `cc` or `°C`), text, choice,
  yes/no, colour swatches, or duration. A field can be conditional on another
  (poop colour only appears when "Poop" is ticked).
- **Buttons on the card** — each one is a preset that fills in some fields, so a
  single tap can mean "60 cc of formula" or "wet only". Leave a field blank to
  be asked later.
- **One tap** or **timer** mode, plus its own colour and sound.

The built-in buttons are ordinary entries in the same config, so you can edit
or hide any of them.

## Where the data lives

```
data/
├── config.json    babies, people, buttons, alarms, settings (pretty JSON)
├── events.log     one JSON object per line, append-only
├── timers.json    timers currently running
└── alarms.json    snooze / last-fired state
```

`events.log` is a journal: new entries are appended, edits and deletions are
appended as further lines, and the file is replayed at startup. A crash can
never corrupt earlier entries, and the log is compacted automatically once
tombstones pile up. Back it up by copying the folder.

## HTTP API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/state?babyId=&days=` | Everything the UI needs in one call |
| `GET` | `/api/stream` | Server-sent events; pushes on every change |
| `GET` | `/api/events`, `POST /api/events` | List / create entries |
| `PATCH`/`DELETE` | `/api/events/:id` | Edit / remove an entry |
| `PUT` | `/api/config` | Replace the whole config |
| `POST` | `/api/timers`, `/api/timers/:id/stop` | Start / stop a timer |
| `POST` | `/api/alarms/:key/{snooze,dismiss,arm}` | Alarm control |
| `GET` | `/api/export.csv?babyId=` | Spreadsheet export |

## Keeping it running

```ini
# /etc/systemd/system/baby-tracker.service
[Unit]
Description=Ultimate Baby Tracker
After=network.target

[Service]
ExecStart=/usr/bin/node /opt/baby-tracker/server.js
Environment=BT_PORT=8080 BT_DATA_DIR=/var/lib/baby-tracker
Restart=always
User=baby

[Install]
WantedBy=multi-user.target
```

## A note on poop colours

The colour swatches flag red, white/clay and (after the first few days) black
stool with a reminder to call your pediatrician. That's a prompt to ask a
professional, not medical advice — this app is a notebook, nothing more.
