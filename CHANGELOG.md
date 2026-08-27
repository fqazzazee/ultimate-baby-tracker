# Changelog

Notable changes, newest first. Versions follow [semantic versioning](https://semver.org),
and the version in `package.json` is what the header and the About card display.

## 1.4.3 — 2026-08-27

### Fixed

- **The Windows installer aborted on a clone that had actually worked.** `git`
  writes ordinary progress to stderr — "Cloning into …" is not an error — and
  with `$ErrorActionPreference = 'Stop'` in force, `2>&1` turned that into a
  terminating `NativeCommandError`. Reported as
  `install.ps1:128 … NotSpecified: (Cloning into 'C...Tracker\app'…) NativeCommandError`.
  Every external command now runs through one helper that captures stderr as
  plain text and judges success by the **exit code**, keeping the captured text
  for the message when something really did fail. A bad `--branch` now says
  *"Remote branch not found in upstream origin"* instead of nothing useful.
- The bug was specific to **Windows PowerShell 5.1**; PowerShell 7 does not
  raise it, which is why `install.cmd` preferring `pwsh` masked it. The fix
  works on both.
- Native arguments are passed as explicit arrays. Loose tokens like `-C` and
  `--depth` are candidates for PowerShell's own parameter binder before they
  ever reach `git`.
- A missing `LOCALAPPDATA` now says so, rather than failing inside `Join-Path`
  with *"Cannot bind argument to parameter 'Path' because it is null"*.
- `Get-ScheduledTask`, `Get-CimInstance` and `Get-NetIPAddress` are guarded.
  A cmdlet that does not exist raises a command-not-found error, which
  `-ErrorAction SilentlyContinue` cannot suppress, so their absence took the
  whole script down instead of degrading to "no service registered".
- The hints printed on screen name `install.cmd`, which is what the docs tell
  people to run.

### Testing

`install.ps1` is no longer unverified. It now runs start to finish under a real
PowerShell — parse check, `install`, `status`, the installed app answering on
its port, `update`, and a deliberately broken `--branch` to confirm failures are
still caught and explained.

## 1.4.2 — 2026-08-27

### Fixed

- **The Windows installer could not actually be run.** PowerShell's execution
  policy is `Restricted` for a standard user, so `.\install.ps1` failed with
  *"running scripts is disabled on this system"* before it did anything — and a
  `.ps1` that arrived over the internet carries a mark-of-the-web that even
  `RemoteSigned` rejects. The README's advice was to change the machine's policy
  first, which is both an extra step and more than the job needs.
- **New `scripts/install.cmd`**, a two-line launcher that calls the script with
  `-ExecutionPolicy Bypass`. That applies to the single invocation, changes
  nothing on the machine, and still needs no administrator rights. It prefers
  PowerShell 7 and falls back to Windows PowerShell 5.1; the script only uses
  cmdlets both have.
- The Windows install instructions now lead with `install.cmd`, and offer a
  no-clone one-liner that runs the script as a scriptblock — never writing a
  file, so the policy never applies to it.
- Added `.gitattributes`, so `.cmd`, `.ps1` and `.vbs` check out with CRLF and
  `.sh` with LF. A shell script with CRLF endings does not run at all, and a
  batch file with bare LF endings can confuse `cmd.exe`.

## 1.4.1 — 2026-08-27

### Documentation

- **The README is short again** — 446 lines down to 113. It now covers what the
  tool is, how to install it on each platform in three commands, what the five
  screens do, and where your data lives. Everything else moved rather than went:
  - **[SECURITY.md](SECURITY.md)** — the security notice, what a 4-digit PIN
    actually is, why a backup file is as sensitive as the data folder, and the
    worked reverse-proxy setup.
  - **[docs/manual.md](docs/manual.md)** — every screen in detail, tracked
    metrics, nutrition, statistics, alarms, custom buttons, backup and restore,
    the data files, the HTTP API.
  - **[docs/install.md](docs/install.md)** — the full installer reference: every
    flag, where things land on each platform, and what an update does.
- Install instructions are per-platform and copy-pasteable, including a
  `curl … | bash` one-liner and the Node prerequisite for Fedora, Debian,
  macOS and Windows.

### Fixed

- `install.sh` printed unrunnable hints when piped from `curl`, because `$0` is
  `bash` there — every "run this next" line said `bash update`. It names the
  script properly now, and the piped path is tested end to end.

## 1.4.0 — 2026-08-27

### Install it as a service

- `scripts/install.sh` for Linux and macOS, `scripts/install.ps1` for Windows.
  Both handle `install`, `update`, `service add`, `service remove`, `status`,
  `start`/`stop`/`restart`, `logs` and `uninstall`. **Neither needs
  administrator rights.**
- On Linux the service is a **systemd user unit** in `~/.config/systemd/user/`,
  which no root can be asked for. Lingering is enabled so it survives a logout
  and starts at boot; where the policy refuses, the script says so and prints
  the one command that fixes it. `--system` installs a machine-wide unit under
  its own unprivileged account, hardened with `ProtectSystem=strict` and
  `ReadWritePaths` limited to the data directory. Both units pass
  `systemd-analyze verify`.
- On Windows a real Service needs administrator rights, so the installer
  registers a **per-user Scheduled Task** that starts at logon and restarts on
  failure. A small `.cmd` sets the environment and redirects the log, and a
  one-line `.vbs` starts it with no console window — quoting stays in the batch
  file, where it behaves.
- `update` snapshots the data directory, stops the service, fast-forwards to the
  latest revision on the branch, rewrites the unit or launcher in case the Node
  path moved, restarts, and prints the commits it pulled in. The last ten
  snapshots are kept.
- Your entries never live inside the application directory, so an update cannot
  reach them in the first place. The snapshot is belt and braces.
- Where git is present the app is a shallow clone and updating is a fetch;
  without it the installer falls back to the branch archive and says that
  updates will re-download the lot.
- The installer refuses to install under `/tmp` unless told twice: it is cleared
  on reboot, and the app — and possibly the entries — would go with it.
- Once a unit exists it is the record of the port, host and paths, so `status`,
  `restart` and `update` need no flags repeated at them and cannot report a port
  the service is not actually on.
- The user unit deliberately omits `PrivateTmp`. It gives the unit its own
  `/tmp` namespace, which hides the application directory from itself and fails
  as a baffling `200/CHDIR`; the system unit, which installs to `/opt`, keeps
  it.

## 1.3.4 — 2026-08-27

### Charts

- **A chart per nutrient.** Whatever you tick in *Setup → Nutrition → Show these
  nutrients* now gets its own daily chart, each with the reference intake for a
  baby that age drawn across it. Energy keeps its kcal/kg line.
- **Ranges down to one day.** The picker is now 1 / 3 / 7 / 14 / 30 / 90 days.
  At one day the charts switch to hour-by-hour buckets and the headline row
  shows today's running totals rather than a daily average. Hours that have not
  happened yet are left off instead of drawn as zeros — a flat run of empty
  columns to midnight reads as "the baby stopped eating".
- **Charts follow Setup.** Untick a metric in *Tracked metrics* and its chart
  and its headline tile go with it, with a line underneath saying which ones are
  hidden and why. Ticking it back brings them and their history straight back.
- **Every chart has a download button** that saves a PNG carrying the title,
  subtitle and a footer naming the baby, the range and the export date. The plot
  is styled entirely by the stylesheet, so the export inlines the computed paint
  of every mark — a serialised `<svg>` on its own would come out blank.
- Reference and average lines can now share a plot, with labels nudged apart
  when the two land close together.
- A nutrient's own caveat now rides on its chart, not just in the tile's sheet.
  Iron sitting far above its line is the formula being fortified on purpose, and
  the chart says so where the alarming picture is.

### Fixes

- **Daylight saving could drop a whole day.** The daily buckets were walked with
  `Date.now() - i * 86_400_000`, which is not a day when the clocks change: in a
  week spanning the US spring-forward it skipped 8 March entirely and drew 5
  March twice. Buckets are walked as calendar dates now.
- **The energy chart's average disagreed with the headline tile.** The tile
  divided by days-with-data, the chart's average line by every day in the range
  bar today. All per-day figures now come from one function with one
  denominator, so they cannot drift apart.
- **Nutrition counted things that were not milk.** Any entry with an `amount`
  was multiplied by the default milk profile, so a custom button recording
  30 ml of anything added phantom calories. Only the built-in feeds and buttons
  carrying a milk picker count now — and pumping, which is milk going the other
  way, never did.
- The Track screen's hero and the Statistics screen now share that definition of
  "a feed", so their counts agree.
- **Axis ticks land on readable numbers.** A count axis topping out at 10 was
  labelled 0 / 2.5 / 5 / 7.5 / 10; it is 0 / 2 / 4 / 6 / 8 / 10 now, and an axis
  with a ceiling of 1 gets 0 / 1 rather than fifths. A ceiling of 12 is 12
  rather than 12.5.
- The average label on a count chart shows one decimal (`avg 7.5`) while its
  bars stay whole.
- Tooltip listeners are attached once at boot rather than on every render of the
  Statistics screen, which had been accumulating a set per refresh.

## 1.3.0 — 2026-08-27

Built and released together with 1.3.4, which follows it here — the two are kept
apart because they describe different work, not because 1.3.0 ever shipped on
its own. There were no 1.3.1–1.3.3.

### Tracked metrics

- **Setup → Tracked metrics** replaces the plain "Buttons" list with a tick box
  per metric. Untick **Sleep** and its card leaves the Track screen and the
  History filters; nothing logged is deleted, and ticking it back restores the
  card as it was. Custom buttons work the same way.
- The old **Hide**/**Show** pair on a built-in button is gone — the tick box is
  the one control, and the tick and the **Edit** button now sit on every row.

### Nutrition

- New **Setup → Nutrition** section. Milk profiles carry label values per 100 mL
  of prepared feed, so the cc already recorded on a bottle scale straight into
  nutrients. Nine are tracked: energy, protein, fat, carbs, iron, calcium,
  vitamin D, DHA and sodium.
- Eight profiles ship with the app — breast milk, Bobbie Organic Original,
  Similac 360 Total Care, Enfamil NeuroPro, Kirkland Signature ProCare, Earth's
  Best Organic Dairy, HiPP Dutch Stage 1 and whole cow's milk. All are rounded
  label values and all are editable; add your own with **Add a milk or formula**.
- The **Bottle** button grows a *What is in it* picker fed from those profiles,
  so adding a formula in Setup adds it to the picker with no migration.
  Breastfeeds count as breast milk without being asked.
- A **Nutrition today** card on the Track screen shows running totals, and
  **Show these nutrients** decides which of the nine get a tile.
- Babies gained an optional **weight**, which turns on the per-kilo figures
  (cc/kg/day, kcal/kg/day) that a pediatrician usually asks for.
- Feeds logged without a volume cannot be scaled, so the card and the charts
  report how many they had to leave out rather than implying a smaller day.
- The whole feature is behind one toggle and is off the screen entirely when
  switched off.

### Statistics

- New **Stats** tab: milk in per day, feeds per day, wet and dirty diapers,
  sleep per day, energy per day, and feeds by hour of the day — the questions a
  check-up actually turns on. One range picker (7/14/30/90 days) scopes them all.
- A row of daily averages sits above the charts. Today is left out of them: a
  day still filling up drags the mean down and makes the number lie.
- Every chart has a **Table** button that unfolds the same values as text, and
  the bars are keyboard focusable, so nothing is reachable by colour or hover
  alone. The two series colours are stepped per theme and checked for
  colour-vision separation against the card surface.
- Charts are hand-built SVG. No charting library, no build step — same as
  everything else here.

### Layout

- On a screen wide enough for it (1080px and up) the Track screen lays its three
  bands out side by side — the buttons on the left, how the day is going in the
  middle, what just happened on the right — instead of one long scroll. Below
  that width nothing changes.
- Fixed a rule from the 700px breakpoint that let the **⋯** button stretch like
  a preset instead of staying a fixed-width affordance. It only showed once the
  cards had to share a row with something else.

### Spacing and chrome

- Spacing is now a small named scale (`--sp-1` … `--sp-6`, plus `--gap-card`,
  `--gap-row`, `--pad-card` and friends) held in **rem**, so every gap, gutter
  and card padding grows with the reader's text size instead of staying put
  while the words get bigger. Tile grids take their minimum widths in rem too.
  Radii and minimum tap targets stay in px on purpose — one is decoration, the
  other is a physical finger, and neither is typography.
- The rhythm is consistent as a result: cards, timer cards, type cards and
  alarm cards all sit the same distance apart, as do the rows of every list.
- The header is thinner: 161px → 141px on a phone, 115px → 98px on a desktop.
- The header chrome scales with the text too. Tab min-heights, icons, badges and
  chips were in px, so the slack inside a tab shrank away as the label grew;
  they are in `em` now, over a px floor that keeps the touch target honest. The
  header is 141/205px at 16/24px text where it used to be 139/211px with the
  tabs cramped at the larger size.
- The Track screen has room under the header, so the first card no longer starts
  hard against it, and the header background is opaque enough (82% → 93%) that a
  card scrolling underneath does not read through it.
- **It shrinks further once you scroll.** Past the first screenful the brand
  drops its version, the logo and theme button shrink, the tabs turn from
  stacked to side by side and the chips tighten — 141px → 112px on a phone,
  98px → 74px on a desktop, and proportionally the same at any text size. Scroll back to the top and it returns. The two
  thresholds differ (72px down, 24px up) so a header that changes its own
  height cannot flip-flop across a single boundary.
- A `ResizeObserver` keeps `--header-h` in step while that transition runs, so
  the sticky day headings in History stay glued to the header's bottom edge
  rather than jumping once it settles.

### Nutrition tips

- The tiles on **Nutrition today** are now buttons. Hover one and it says how
  much has gone in and how that compares with the reference intake for a baby
  this age; tap one and a sheet gives the full picture — the figure, where it
  comes from, which milks contributed it, and why it is not a target.
- Reference intakes come from the US Dietary Reference Intakes, split at six
  months. Energy is per-kilo and needs a weight on the baby's profile; DHA has
  no infant reference and says so rather than inventing one.
- Three notes worth having in the app rather than in a search box: iron reads
  far above the 0–6 month figure for any formula-fed baby *by design* (that
  figure is the amount in breast milk, and formula is fortified), the iron jump
  at six months is real, and milk alone rarely reaches the vitamin D figure.
- Every sheet carries the same framing: for the first six months these are
  Adequate Intakes — the observed average of healthy, exclusively breastfed
  babies — so being under one is not a deficiency, and only feeds with a
  recorded volume can be counted at all.
- The comparison bar in the sheet is a single hue with no severity colouring.
  A short bar in red would turn a description of well-fed babies into a verdict
  on one.

### Interaction

- Cards, entries, list rows and stat tiles highlight under the pointer. Guarded
  by `hover: hover` so a touchscreen never leaves a highlight stuck on the last
  thing tapped, and drawn with a shadow rather than a transform, which would
  nudge the text and shimmer.
- Tooltips moved into one delegated module wired once at boot. They now work
  anywhere in the app, not just on the charts — and this fixes a leak the Stats
  screen had, where every re-render added another set of listeners.

### Nutrition data fixes

- **Corrected the Bobbie Organic Original profile.** Its iron, DHA and vitamin D
  had been entered as the per-100-kcal figures Bobbie publishes (20 mg DHA,
  1.2 mg iron, 75 IU vitamin D per 100 Calories) without converting to per
  100 mL — overstating each by about half. At 20 Cal/fl oz they are 13.5 mg,
  0.81 mg and 1.27 µg per 100 mL. Energy is 67.6 rather than 68 for the same
  reason.
- A stored config is migrated to match, but **only where the Bobbie numbers are
  still untouched** — anyone who already corrected or tuned their own copy keeps
  it. (`config.json` is version 3.)
- **The milk editor can take label numbers as printed.** A new *per 100 mL /
  per 100 Cal* switch: pick per 100 Cal, give it the Calories per fl oz off the
  panel, and every nutrient you type is converted on the way in, with a live
  preview of what will be stored. US labels are always per 100 Calories
  (21 CFR 107.10); European tins are usually per 100 mL.
- Switching the basis clears the nutrient fields rather than silently rescaling
  numbers that meant something else a moment ago.

### Under the hood

- `config.json` is now version 2. A stored v1 config is migrated on load: the
  nutrition block is seeded and the milk picker is appended to the bottle
  button. The old free-text *Contents* field is left in place, so entries logged
  against it stay readable.
- Backups carry the nutrition block, and the restore prompt now counts milk
  profiles alongside entries, babies and people.
- Setup toggles can address a nested config path (`nutrition.enabled`), not
  just a key under `settings`.

## 1.2.0 — 2026-08-25

- **Download backup** in **Setup → Data** writes a gzipped bundle of everything
  — config, every entry, running timers and alarm state. Plain JSON inside, so
  `gunzip -c` gives you something readable.
- **Restore from backup** reads one back. The server unpacks the file and
  reports what is in it — entries, babies, people, buttons, alarms — and waits
  for confirmation before replacing what is stored. An unzipped or hand-edited
  `.json` bundle is accepted too.
- Before a restore overwrites anything, the current state is written to
  `data/pre-restore-<timestamp>.json` in the same format.
- New endpoints: `GET /api/backup` and `POST /api/restore` (with `?dryRun=1` to
  inspect a file without applying it). Both are unauthenticated like the rest of
  the API, which the README's security notice now spells out.
- The bundle carries salted PIN hashes so that a restore does not silently
  unlock every profile. Keep the file as private as the data folder.

## 1.1.2 — 2026-08-25

- Merge the baby and person selectors into a single strip that sits with the
  tab bar instead of standing as its own band below it. On a phone the chips
  wrap under the tabs; from 700px up they sit beside them. The header is one
  row shorter, which is one row more of the Track screen.
- Drop the "Baby" and "Who" labels and the age line on the baby chips — the
  avatars carry the meaning, the hero card underneath already shows the age,
  and the chips keep it in their tooltip. Screen readers still hear both
  groups, and every chip says what it does ("Track Freddie", "Log as Mom").
- Add this changelog.

## 1.1.1 — 2026-08-24

- Show the author's name in `package.json`, and so in the About card.
- Reunite the deploy guidance with the security notice in the README.

## 1.1.0 — 2026-08-24

- Bring the baby and person selectors back into the sticky header, so the
  brand, theme toggle, tabs and both selector rows read as one block.
- Show the app name and version in the header. Name, version, author, licence
  and repository come from `package.json` and ship with the app state, so
  there is one source of truth.
- Add an About card at the end of Setup, linking to the repository, the README
  and the author, and restating the security posture.
- Add a security notice to the README: no authentication, no encryption, and
  none intended. Deploy behind a reverse proxy, with a worked nginx example
  that keeps the SSE stream unbuffered.

## 1.0.0 — 2026-08-24

- One-tap logging for feeds, diapers, sleep and anything else you define,
  with programmable alarms, plain-text storage and no dependencies.
- Top navigation across Track, History, Alarms and Setup.
- Optional 4-digit profile PINs, stored as salted scrypt hashes.
- Default to port 8477, and fail with a useful message when it is taken.
