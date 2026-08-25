# 🍼 Ultimate Baby Tracker

One-tap tracking for a newborn: feeds, diapers, sleep, baths, medicine — and
anything else you care to invent. Built for 3 a.m. operation with one thumb.

- **No accounts, no login.** Open the page and start tapping.
- **No dependencies, no build step.** Plain Node, plain HTML/CSS/JS.
- **Plain-text storage.** Everything lives in `data/` as JSON you can read,
  edit and back up. It survives restarts and reboots.
- **Multiple babies**, each with its own profile, colour and age.
- **Multiple people** — every entry records who did it ("Mom fed 60 cc at 2:04 PM"),
  each with an optional 4-digit profile PIN.
- **Programmable alarms** — "tell me if she hasn't fed in 3 hours".
- **Light and dark nursery themes**, big buttons, sound and vibration feedback.

## Run it

```bash
node server.js
# → http://localhost:8477
```

That's the whole install. Node 18 or newer, nothing to `npm install`.

| Variable | Default | What it does |
| --- | --- | --- |
| `BT_PORT` | `8477` | Port to listen on |
| `BT_HOST` | `0.0.0.0` | Bind address — the default lets phones on your Wi-Fi connect |
| `BT_DATA_DIR` | `./data` | Where the plain-text files are kept |

```bash
BT_PORT=3000 BT_DATA_DIR=/srv/baby node server.js
```

Open `http://<your-computer's-IP>:8477` on a phone and add it to the home
screen — it installs as a standalone app.

> No authentication, no encryption — see the [security notice](#security-notice).
> Put it behind a reverse proxy on a segmented network.

## Using it

The four screens — Track, History, Alarms and Setup — are pinned to the top of
the page, so nothing important sits under your thumb while you tap.

**Track** — the main screen. Every card is one kind of event, and every button
on it logs immediately: tap **Poop** and the time is saved, with a chime, a
stamp on screen and a buzz. A toast offers **Undo** and **Details** for a few
seconds afterwards, so a mis-tap costs nothing.

- Pick the baby (top strip) and who you are ("Logging as") once; both stick.
  Adding a baby lives in **Setup**, out of the way of accidental taps.
- **Breastfeed** and **Sleep** are timers: first tap starts, second tap stops
  and saves the duration. A running timer survives a server restart.
- The **⋯** button on any card opens the full form — amount, side, a different
  time, a note.

**History** — everything logged, grouped by day, filterable by type, with daily
totals. Tap any entry to edit or delete it. Exports to CSV.

**Alarms** — see below.

**Setup** — babies, people, buttons, theme and sound, plus an **About** card at
the bottom with the version, links back to this repository and the docs, and a
reminder of the security posture above.

## Profile locks

Any person can set a 4-digit PIN in **Setup → People → Edit**. Once set, the PIN
is asked for before you can switch to that person, edit their profile, or start
the app as them — so entries don't get logged under the wrong name. An unlock
lasts until the browser tab is closed, and the 🔒 chip beside the people row
re-locks immediately.

PINs are stored as salted scrypt hashes and are never sent to the browser; the
server only answers "yes" or "no", and five wrong guesses trigger a 30-second
lockout. Even so, a four-digit code is a courtesy lock between people who
already trust each other, not a security boundary — see the
[security notice](#security-notice).

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
  yes/no, colour swatches, or duration. A field can be conditional on another,
  so it only appears once a related yes/no field is ticked.
- **Buttons on the card** — each one is a preset that fills in some fields, so a
  single tap can mean "60 cc of formula" or "wet only". Leave a field blank to
  be asked later.
- **One tap** or **timer** mode, plus its own colour and sound.

The built-in buttons are ordinary entries in the same config, so you can edit
or hide any of them.

## Security notice

**This application has no authentication and no encryption, and was not
designed with either in mind.** There are no accounts, no sessions, no
passwords and no TLS. Every HTTP endpoint is open to anyone who can reach the
port, and all data — including the event log and config — is stored and served
as plain text.

The optional 4-digit profile PINs are not a security control. They only stop
family members from logging entries under each other's names; they do not
protect the API, which will happily answer unauthenticated requests.

Deploy it accordingly:

- Put it **behind a reverse proxy** (nginx, Caddy, Traefik) and let the proxy
  terminate TLS and handle any authentication you need — basic auth, an
  identity-aware proxy, mTLS, a VPN, whatever suits you.
- Apply **proper network segmentation**: bind it to a trusted VLAN or a
  WireGuard/Tailscale interface, and use firewall rules so only the proxy can
  reach the app port. Setting `BT_HOST=127.0.0.1` keeps it off the network
  entirely when a proxy is running on the same host.
- **Never expose it directly to the internet**, and don't port-forward to it.

It is a family notebook on a trusted LAN. Treat it as one.

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
| `POST` | `/api/users/:id/{verify,pin}` | Check a profile PIN / set or clear one |
| `GET` | `/api/export.csv?babyId=` | Spreadsheet export |

## Keeping it running

```ini
# /etc/systemd/system/baby-tracker.service
[Unit]
Description=Ultimate Baby Tracker
After=network.target

[Service]
ExecStart=/usr/bin/node /opt/baby-tracker/server.js
Environment=BT_PORT=8477 BT_DATA_DIR=/var/lib/baby-tracker
Restart=always
User=baby

[Install]
WantedBy=multi-user.target
```

Bind to localhost and let a proxy face the network:

```ini
Environment=BT_HOST=127.0.0.1 BT_PORT=8477 BT_DATA_DIR=/var/lib/baby-tracker
```

```nginx
# /etc/nginx/conf.d/baby-tracker.conf
server {
    listen 443 ssl;
    server_name baby.home.lan;

    ssl_certificate     /etc/ssl/certs/home.crt;
    ssl_certificate_key /etc/ssl/private/home.key;

    # Whatever authentication you want, added here rather than in the app.
    auth_basic           "Baby Tracker";
    auth_basic_user_file /etc/nginx/baby.htpasswd;

    # Only the trusted subnet may reach the proxy at all.
    allow 10.10.20.0/24;
    deny  all;

    location / {
        proxy_pass http://127.0.0.1:8477;
        proxy_http_version 1.1;

        # /api/stream is server-sent events: keep it open and unbuffered.
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 1h;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```
