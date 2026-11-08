# Installing

The short version lives in [the README](../README.md). This is the full
reference: every flag, what the service actually is on each platform, and what
an update does.

## Running it without installing anything

```bash
node server.js
# → http://localhost:8477
```

That's the whole install. Node 18 or newer, nothing to `npm install`. If you
do not have Node yet, the [README](../README.md#install) lists how to get it on
each platform; on a Mac, use the installer from
[nodejs.org](https://nodejs.org/en/download), since Homebrew is not there out
of the box.

| Variable | Default | What it does |
| --- | --- | --- |
| `BT_PORT` | `8477` | Port to listen on |
| `BT_HOST` | `0.0.0.0` | Bind address — the default lets phones on your Wi-Fi connect |
| `BT_DATA_DIR` | `./data` | Where the plain-text files are kept. A relative path is taken from the directory you start it in, not the app's folder |
| `BT_BACKUP_DIR` | `<BT_DATA_DIR>/backups` | Where automatic backups are written — point it at a NAS mount or a synced folder |

```bash
BT_PORT=3000 BT_DATA_DIR=/srv/baby node server.js
```

Open `http://<your-computer's-IP>:8477` on a phone. Adding it to the home
screen gives you a shortcut that opens it full screen; it is not an installed
app, and the server has to be reachable when you open it.

## The installers

`scripts/` has an installer for each platform. Both put the app in one place,
your entries in another, and can update themselves from this repository later.
**Neither needs administrator rights** (the one exception is `--system` on
Linux, which asks for it).

### Linux and macOS

You need Node 18+ and, for the clone, git. On a fresh Mac, install Node from
[nodejs.org](https://nodejs.org/en/download) (or `brew install node` if you
already have Homebrew) and run `xcode-select --install` once for git — the
`git` macOS ships is only a placeholder that offers to install Apple's Command
Line Tools.

```bash
./scripts/install.sh install          # install, then run it in the background
./scripts/install.sh update           # pull the latest revision and restart
./scripts/install.sh status           # where things are, and is it up
./scripts/install.sh service remove   # stop it, keep everything
./scripts/install.sh uninstall        # remove the app; --purge drops the data too
./scripts/install.sh start|stop|restart
./scripts/install.sh logs [-f]        # the service log
```

On Linux this writes a **systemd user unit** to
`~/.config/systemd/user/`, which needs no root — tested on Fedora. It enables
lingering so the service survives a logout and starts at boot; if the policy
refuses, the script says so and prints the one command that fixes it. Add
`--system` for a machine-wide unit running under its own unprivileged account
(that one does need root, and is hardened with `ProtectSystem=strict`).

Without systemd — macOS, a container, a distro that went its own way — install
still works and just tells you the command to run it with. There is then no
background service: the server runs while that terminal is open, and `start`,
`stop`, `restart` and `logs` do not apply. On a Mac, `caffeinate -i` in front of
the command keeps the machine from sleeping while it runs.

| Option | |
| --- | --- |
| `--port N` `--host ADDR` | defaults `8477` and `0.0.0.0`; `127.0.0.1` keeps it off the network |
| `--dir` `--data` `--backups` | where the app, your entries and the update snapshots go |
| `--branch NAME` | track a branch other than `main` |
| `--system` | machine-wide unit instead of a user one |
| `--no-service` | install the files, skip the service |

### Windows

```powershell
.\scripts\install.cmd install
.\scripts\install.cmd update
.\scripts\install.cmd status
.\scripts\install.cmd service remove
```

**Use `install.cmd`, not `install.ps1` directly.** PowerShell's execution policy
is `Restricted` for a standard user, so an unsigned `.ps1` will not run at all —
and one that arrived over the internet carries a mark-of-the-web that even
`RemoteSigned` rejects. `install.cmd` is a two-line launcher that calls the
script with `-ExecutionPolicy Bypass`, which applies to that one invocation,
changes nothing on the machine and needs no administrator rights. It uses
PowerShell 7 when it is installed and Windows PowerShell 5.1 otherwise; the
script only uses cmdlets both have.

Three other ways in, if you would rather:

```powershell
# one invocation, no launcher
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1 install

# never writes a script file, so the policy never applies
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/fqazzazee/ultimate-baby-tracker/main/scripts/install.ps1))) install

# permit local scripts once, for your account only
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

The background service itself is unaffected by any of this: the scheduled task
runs `wscript.exe`, not PowerShell.

A real Windows Service needs administrator rights, so this registers a **per-user
Scheduled Task** that starts at logon instead, running as you with no console
window and restarting itself if it falls over. For a machine you log into, that
is the same thing in practice, and it is the only kind of background job an
unprivileged account is allowed to create.

### What updating does, and does not, touch

Your entries never live inside the application directory, so an update cannot
reach them. Before one, the installer snapshots the whole data directory to
`backups/` anyway and keeps the last ten. The update itself stops the service,
resets the checkout to the latest revision on the branch, rewrites the unit or
launcher in case the Node path moved, and starts it again — then prints the
commits it pulled in. The app directory is not for your own edits: an update
replaces whatever is there.

Where git is installed the app is a shallow clone, so updating is a fetch and
you can see exactly what changed. Where it is not, the installer falls back to
downloading the branch archive and says that updates will re-download the lot.

### Every flag

Long form on Linux and macOS; the same options on Windows are PowerShell
parameters (`-Port`, `-Listen`, `-Dir`, `-Data`, `-Backups`, `-Branch`,
`-NoService`, `-Purge`). `--system` and `-y` are Linux and macOS only.

| Flag | Default | |
| --- | --- | --- |
| `--port N` | `8477` | port to listen on |
| `--host ADDR` | `0.0.0.0` | `127.0.0.1` keeps it off the network entirely |
| `--dir PATH` | `~/.local/share/ultimate-baby-tracker/app` | where the app goes |
| `--data PATH` | `…/data` | where your entries go |
| `--backups PATH` | beside the data | where update snapshots go |
| `--branch NAME` | `main` | track a different branch |
| `--system` | off | machine-wide unit under its own account (needs root) |
| `--no-service` | off | install the files, skip the service |
| `--purge` | off | with `uninstall`, delete the data directory too |
| `-y`, `--yes` | off | allow an install under `/tmp` |

### Where it puts things

| | Linux and macOS | Windows |
| --- | --- | --- |
| App | `~/.local/share/ultimate-baby-tracker/app` | `%LOCALAPPDATA%\UltimateBabyTracker\app` |
| Data | `…/data` | `%LOCALAPPDATA%\UltimateBabyTracker\data` |
| Snapshots | `…/backups` | `%LOCALAPPDATA%\UltimateBabyTracker\backups` |
| Service | `~/.config/systemd/user/ultimate-baby-tracker.service` | Scheduled task `UltimateBabyTracker` |
| Log | `journalctl --user -u ultimate-baby-tracker` (Linux; on macOS, the terminal it runs in) | `%LOCALAPPDATA%\UltimateBabyTracker\service.log` |

`--system` moves those to `/opt`, `/var/lib`, `/var/backups` and
`/etc/systemd/system`, and runs the service as its own `babytracker` account.

> No authentication, no encryption — see [SECURITY.md](../SECURITY.md).
> Put it behind a reverse proxy on a segmented network.

## Keeping it running by hand

If you would rather write your own unit than use `install.sh --system`, see
[SECURITY.md](../SECURITY.md#putting-it-behind-a-proxy), which carries a worked
systemd unit and an nginx front end.
