# 🍼 Ultimate Baby Tracker

[![Live demo — tap the app in your browser](https://img.shields.io/badge/%F0%9F%8D%BC%20Live%20demo-tap%20it%20in%20your%20browser-f2a0bd?style=for-the-badge&labelColor=46313f)](https://ultimate-baby-tracker.safeqbit.com/demo/)
[![Website — help and FAQ](https://img.shields.io/badge/Website-help%20%26%20FAQ-8fc4f0?style=for-the-badge&labelColor=46313f)](https://ultimate-baby-tracker.safeqbit.com)

[![Ultimate Baby Tracker: one tap at 3am, answers at the check-up — the Track screen on a laptop and a phone, a month of daily intake in Stats, and editable formula profiles in Setup](docs/slide/slide.png)](https://fqazzazee.github.io/ultimate-baby-tracker/docs/slide/)


One-tap tracking for a newborn: feeds, diapers, sleep, baths, medicine, and
anything else you care to invent. Renders and works on modern web browsers from your notebook, 
workstation and phone.

**Self-hosted**, **offline**, No accounts, no cloud, no build step, no dependencies. Your entries stay on your
machine as plain text you can read.

## Preview - Mobile Phone View

https://github.com/user-attachments/assets/19796da7-176f-440a-afb3-2f360b609352

### Or try it yourself, having installed nothing

**[ultimate-baby-tracker.safeqbit.com](https://ultimate-baby-tracker.safeqbit.com)**
runs the whole application in your browser, on six weeks of invented data for
two newborns and a toddler. Not a video and not screenshots — every screen is
live. Log a feed and watch it reach the charts, read the statistics, export the
CSV and open it in a spreadsheet.

It keeps what you tap in that one browser tab and nowhere else. No account, no
server, nothing shared with anybody, and closing the tab forgets all of it.

## Compatibility

Two separate questions: which machine **runs** it, and which device you **use**
it from.

**Running it.** One machine on your network holds the data and serves the app.

| | Install | In the background |
| --- | --- | --- |
| **Linux** | `./scripts/install.sh install` | systemd **user** service — no root, survives a logout, starts at boot |
| **macOS** | `./scripts/install.sh install` | no service; the install works and then prints the command to start it yourself |
| **Windows** | `.\scripts\install.cmd install` | scheduled task under your own account — starts when you log in, no administrator rights |
| **Anything else with Node 18+** | `node server.js` | by hand, or write your own unit — see [SECURITY.md](SECURITY.md#putting-it-behind-a-proxy) |
| **iOS · Android** | — | not supported — a phone is a client here, never the host |

**Using it.** A browser, over the network.

| | Browser | Installable app |
| --- | --- | --- |
| **Desktop · laptop** | any modern browser | Chrome and Edge can install the page as an app |
| **Android** | Chrome — the layout is built for the phone | **not yet** |
| **iPhone · iPad** | Safari — the layout is built for the phone | **not yet** |

**There is no Android or iOS app yet.** Phones are supported as browser
clients and nothing more for now — open the address, and the screen you get is
the one in the preview above.

A phone only has to reach the server, and on the same Wi-Fi it already does.
Away from home, put both ends on a VPN — WireGuard or Tailscale — or behind a
reverse proxy that adds authentication, and the phone reaches it from anywhere.
**Do not simply forward a port to it:** it has no authentication and no
encryption of its own, so anyone who finds the address is already inside. See
[SECURITY.md](SECURITY.md).

Nothing is cached for offline use either — the server has to be reachable when
you open it.

## Install

Node 18 or newer is the only prerequisite.
*(Fedora: `sudo dnf install nodejs` · Debian/Ubuntu: `sudo apt install nodejs` ·
macOS: `brew install node` · Windows: `winget install OpenJS.NodeJS.LTS`)*

### Linux and macOS

```bash
git clone https://github.com/fqazzazee/ultimate-baby-tracker.git
cd ultimate-baby-tracker
./scripts/install.sh install
```

Or without cloning first:

```bash
curl -fsSL https://raw.githubusercontent.com/fqazzazee/ultimate-baby-tracker/main/scripts/install.sh | bash -s -- install
```

On Linux that sets it up as a background service that starts with your machine.
**No `sudo`, no root** — it is a systemd *user* service.

### Windows

```powershell
git clone https://github.com/fqazzazee/ultimate-baby-tracker.git
cd ultimate-baby-tracker
.\scripts\install.cmd install
```

Or without cloning first:

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/fqazzazee/ultimate-baby-tracker/main/scripts/install.ps1))) install
```

Runs in the background from the moment you log in. **No administrator rights** —
it registers a scheduled task under your own account, not a system service.

<sub>Use `install.cmd`, not `install.ps1`. Windows blocks unsigned PowerShell
script files by default, so running the `.ps1` directly fails with *"running
scripts is disabled on this system"*. The `.cmd` is a two-line launcher that
passes <code>-ExecutionPolicy&nbsp;Bypass</code> for that one run — it changes
nothing on your machine and still needs no admin. The one-liner above sidesteps
it differently, by never writing a script file at all.</sub>

### Just try it, install nothing

```bash
node server.js     # → http://localhost:8477
```

## Then

The installer prints the address when it is done. Open it in a browser on any
device that can reach the machine, phones included.

Same three commands on either platform — `install.sh` on Linux and macOS,
`install.cmd` on Windows:

| | |
| --- | --- |
| `status` | where it is installed, and whether it is running |
| `update` | pull the newest version and restart |
| `uninstall` | remove it; add `--purge` / `-Purge` to drop your entries too |

Your entries live outside the application folder and are snapshotted before
every update, so updating cannot touch them.

## What it does

| | |
| --- | --- |
| **Track** | One tap per event. Breastfeeds and sleeps are timers. A toast offers Undo for a few seconds after every tap. |
| **History** | Everything logged, grouped by day, filterable, editable. Exports to CSV. |
| **Stats** | Intake, feeds, diapers, sleep, pumping and nutrients over 1–90 days, with the figures a check-up asks for. Pick which charts you want. Each one downloads as an image. |
| **Alarms** | "Tell me if she hasn't fed in three hours." Rings on time, even in a background tab. |
| **Setup** | Babies, people, which metrics to track and in what order, which milks to offer, which charts to draw, custom buttons, backup and restore. |

Also: multiple babies and multiple carers (every entry records who did it),
optional 4-digit profile PINs, nutrition worked out from the cc you already log
over a rolling 24 hours to a month,
light and dark themes, and spacing that grows with your system text size.

## Where your data goes

Plain text, on your machine, in one folder you can copy anywhere:

```
config.json    babies, people, buttons, alarms, milk profiles, settings
events.log     one JSON object per line, append-only
timers.json    timers currently running
alarms.json    snooze / last-fired state
```

**Setup → Data** downloads the lot as one compressed file and restores it again.

## Read more

- **[Manual](docs/manual.md)** — how to use manual that includes setting up the screen,
  nutrition, statistics, custom, buttons, backup and restore, the HTTP API
- **[Installing](docs/install.md)** — every installer flag, the service on each
  platform, what an update does
- **[Security](SECURITY.md)** — **read this before exposing it to anything**
- **[Changelog](CHANGELOG.md)** — **version changes**
- **[Website and live demo](https://ultimate-baby-tracker.safeqbit.com)** — the
  app running in a browser, and the manual and FAQ as searchable pages

> **No authentication and no encryption.** It was never designed to have any.
> Keep it on a trusted network — see [SECURITY.md](SECURITY.md).

Licensed under the [PolyForm Strict License 1.0.0](LICENSE) — free for any noncommercial
use; it does not permit redistribution or modified versions. Made with 🍼 and very
little sleep.
