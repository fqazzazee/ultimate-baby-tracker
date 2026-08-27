# Manual

Everything the app does, screen by screen. For getting it running see
[install.md](install.md); for the deployment posture see
[SECURITY.md](../SECURITY.md).

## Using it

The five screens — Track, History, Stats, Alarms and Setup — are pinned to the
top of the page, so nothing important sits under your thumb while you tap.

**Track** — the main screen. Every card is one kind of event, and every button
on it logs immediately: tap **Poop** and the time is saved, with a chime, a
stamp on screen and a buzz. A toast offers **Undo** and **Details** for a few
seconds afterwards, so a mis-tap costs nothing.

- Pick the baby and who you are once, from the chips beside the tabs; both
  stick. Babies come first, then people, with a divider between them. Adding a
  baby lives in **Setup**, out of the way of accidental taps.
- **Breastfeed** and **Sleep** are timers: first tap starts, second tap stops
  and saves the duration. A running timer survives a server restart.
- The **⋯** button on any card opens the full form — amount, side, a different
  time, a note.
- On a wide screen the page splits into three columns — buttons on the left, the
  day's figures in the middle, the last few entries on the right — so a laptop
  or a kitchen tablet shows the whole picture without scrolling. A phone keeps
  the single column.

**History** — everything logged, grouped by day, filterable by type, with daily
totals. Tap any entry to edit or delete it. Exports to CSV.

**Stats** — see [Statistics](#statistics).

**Alarms** — see below.

**Setup** — babies, people, tracked metrics, nutrition, theme and sound, plus an
**About** card at the bottom with the version, links back to this repository and
the docs, and a reminder of the security posture above.

## Tracked metrics

Nobody needs every card. **Setup → Tracked metrics** is a list of tick boxes,
one per button: untick **Sleep** and the sleep card leaves the Track screen and
the History filters, and that is the end of it. Nothing already logged is
deleted, nothing is hidden from the export or a backup, and ticking the box
again brings the card back exactly as it was.

It works on the buttons you invent as well as the eight that ship with the app.

## Nutrition

Every bottle already records how many cc went in. Give the app the nutrition
panel off the tin and it can say what those cc actually amounted to.

**Setup → Nutrition** holds the milk profiles. Eight ship with the app — breast
milk, Bobbie, Similac, Enfamil, Kirkland, Earth's Best, HiPP and whole cow's
milk — each carrying its label values per 100 mL of *prepared* feed. Add your
own with **➕ Add a milk or formula**, or open any of them and correct the
numbers.

> Treat the built-in profiles as a starting point, not gospel. They are rounded
> label values, brands reformulate without warning, and a European stage 1 is
> not the same product as its American cousin. The tin in your kitchen wins.

**Mind the basis when you type numbers in.** A US infant formula label declares
nutrients **per 100 Calories**, not per 100 mL — so a panel reading "1.2 mg
iron" means 1.2 mg per 100 kcal, which at 20 Cal/fl oz works out to 0.81 mg per
100 mL. Getting that wrong overstates a formula's iron and DHA by about half.
The milk editor has a **per 100 mL / per 100 Cal** switch for exactly this: pick
*per 100 Cal*, give it the Calories per fl oz off the panel, then type every
number exactly as printed and it converts them for you. European tins usually
print per 100 mL of made-up feed, so those go in as they are.

Once it is on:

- The **Bottle** card grows a *What is in it* picker listing your profiles.
  Breastfeeds count as breast milk without being asked.
- A **Nutrition today** card appears on the Track screen with running totals.
- **Setup → Nutrition → Show these nutrients** decides which of the nine —
  energy, protein, fat, carbs, iron, calcium, vitamin D, DHA and sodium — get a
  tile. The rest stay recorded and simply are not shown.
- Put a weight on the baby in **Setup → Babies** and you also get the per-kilo
  figures, which is usually the form the question gets asked in.
- **Tap any tile** for the whole story on that nutrient: how much has gone in,
  the reference intake for a baby that age, which milks contributed it, and why
  that reference is not a target. Hovering gives the one-line version.

Only feeds with a recorded volume can be counted — a nursing session you timed
but did not measure has no cc to scale — so both the card and the charts say
how many feeds they had to leave out rather than quietly implying a smaller day.
Switch the whole thing off with one toggle and nothing else changes.

## Statistics

The **Stats** screen answers the questions that come up at a check-up. One range
picker at the top — **1, 3, 7, 14, 30 or 90 days** — scopes everything below it.
At one day the charts switch from daily columns to **hour by hour**, and the
headline row shows today's running totals instead of a daily average; hours that
have not happened yet are left off rather than drawn as zeros.

| Chart | The question it answers |
| --- | --- |
| **Milk in** | Is intake holding up? With cc/kg/day when a weight is set |
| **Feeds** | How often, regardless of volume |
| **Diapers** | Wet and dirty side by side — the everyday hydration check |
| **Sleep** | Total from timed sleeps, plus the longest stretch |
| **Nutrients** | One chart per nutrient you chose to show, each with the reference intake for a baby that age drawn across it |
| **When feeds happen** | The shape of the day, and whether nights are settling |

Above them sits a row of daily averages. Today is deliberately left out of those
averages — a day that is still filling up drags the mean down and makes the
number lie.

**Charts follow Setup.** Untick *Sleep* in **Tracked metrics** and its chart and
headline tile disappear along with its card on the Track screen; the same goes
for diapers and for feeds. A line under the charts says which ones are hidden
and why. Which nutrient charts appear follows **Setup → Nutrition → Show these
nutrients**.

Every chart carries three things: a **Table** button that unfolds the same values
as text, a **⬇️ download** button that saves it as a PNG with its title, subtitle
and a footer naming the baby and range — the thing to actually hand to a
pediatrician — and keyboard-focusable bars. Nothing is reachable by colour or
hover alone. The two series colours are chosen for colour-vision separation
against both themes rather than to match the nursery pastels, which are far too
pale to read as data.

The reference lines on the nutrient charts are references, not targets: for the
first six months most are Adequate Intakes, the observed average of exclusively
breastfed infants. A formula-fed baby will sit well above the iron line by
design. Tap any tile on **Nutrition today** for the whole story.

None of it is a diagnosis, and a reference note under a chart is not a target to
hit. It is your own log, added up.

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

Give a custom button a **choice** field fed from your milk profiles and it counts
as a feed everywhere else — the nutrition totals, the intake charts, the feed
counts. A button that merely happens to record an amount (medicine in ml, a bath
temperature) does not, so nothing gets quietly counted as milk.

## Profile locks

Any person can set a 4-digit PIN in **Setup → People → Edit**. Once set, the PIN
is asked for before you can switch to that person, edit their profile, or start
the app as them — so entries don't get logged under the wrong name. An unlock
lasts until the browser tab is closed, and the 🔒 chip at the end of the
people chips re-locks immediately.

PINs are stored as salted scrypt hashes and are never sent to the browser; the
server only answers "yes" or "no", and five wrong guesses trigger a 30-second
lockout. Even so, a four-digit code is a courtesy lock between people who
already trust each other, not a security boundary — see the
[SECURITY.md](../SECURITY.md).

See [SECURITY.md](../SECURITY.md) for what a four-digit PIN is and is not.

## Backup and restore

**Setup → Data** has both halves:

- **Download backup** writes a gzipped bundle —
  `baby-tracker-backup-2026-08-25-1430.json.gz` — holding the config and every
  entry, timer and alarm state. It is ordinary JSON inside, so `gunzip -c` on
  it gives you something readable and greppable.
- **Restore from backup** takes that file back. The server unpacks it, reports
  what is inside (entries, babies, people, buttons, alarms) and waits for you
  to confirm before **replacing everything currently stored**. A plain `.json`
  file works too, if you unzipped or hand-edited one.

Two things worth knowing. The bundle contains the salted PIN hashes, so keep
the file as private as the data folder itself. And before a restore overwrites
anything, the current state is written to `data/pre-restore-<timestamp>.json`
in the same format.

Either half works from the command line as well:

```sh
curl -OJ http://localhost:8477/api/backup
curl -X POST --data-binary @baby-tracker-backup-2026-08-25-1430.json.gz \
     'http://localhost:8477/api/restore?dryRun=1'     # look inside, change nothing
curl -X POST --data-binary @baby-tracker-backup-2026-08-25-1430.json.gz \
     http://localhost:8477/api/restore                # actually restore
```

## Where the data lives

```
data/
├── config.json    babies, people, buttons, alarms, milk profiles, settings
├── events.log     one JSON object per line, append-only
├── timers.json    timers currently running
└── alarms.json    snooze / last-fired state
```

`events.log` is a journal: new entries are appended, edits and deletions are
appended as further lines, and the file is replayed at startup. A crash can
never corrupt earlier entries, and the log is compacted automatically once
tombstones pile up. Copying the folder is still the simplest backup there is.

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
| `GET` | `/api/backup` | Gzipped bundle of everything |
| `POST` | `/api/restore?dryRun=` | Restore a bundle, or just report what is in it |
