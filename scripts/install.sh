#!/usr/bin/env bash
#
# Ultimate Baby Tracker — installer and service manager for Linux and macOS.
#
#   ./scripts/install.sh install          install and start it as a service
#   ./scripts/install.sh update           fetch the latest revision and restart
#   ./scripts/install.sh service add      (re)create the service
#   ./scripts/install.sh service remove   stop and delete the service, keep the data
#   ./scripts/install.sh uninstall        remove the app; --purge also drops the data
#   ./scripts/install.sh status | logs | start | stop | restart
#
# It also works piped straight from curl, in which case it clones the repo for
# you:  curl -fsSL <raw-url>/scripts/install.sh | bash -s -- install
#
# On Linux this installs a *user* systemd unit, which needs no root at all.
# Pass --system to install a machine-wide unit instead (that one does need
# root, and runs under its own unprivileged account). On macOS it installs a
# per-user LaunchAgent, which needs no root either.
#
# Your entries live outside the application directory, so an update can never
# touch them, and every update snapshots them first anyway.

set -euo pipefail

APP_NAME="Ultimate Baby Tracker"
SERVICE_NAME="ultimate-baby-tracker"
REPO_URL="https://github.com/fqazzazee/ultimate-baby-tracker"
DEFAULT_BRANCH="main"
MIN_NODE_MAJOR=18

# ---------------------------------------------------------------- defaults --

MODE="user"                       # user | system
PORT_SET=0; HOST_SET=0; DIR_SET=0; DATA_SET=0; BACKUP_SET=0
BRANCH="$DEFAULT_BRANCH"
PORT="${BT_PORT:-8477}"
HOST="${BT_HOST:-0.0.0.0}"
NO_SERVICE=0
PURGE=0
ASSUME_YES=0
SERVICE_USER="babytracker"        # --system only

data_home="${XDG_DATA_HOME:-$HOME/.local/share}"
APP_DIR="$data_home/$SERVICE_NAME/app"
DATA_DIR="$data_home/$SERVICE_NAME/data"
BACKUP_DIR="$data_home/$SERVICE_NAME/backups"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
# macOS: launchd has no journal for a LaunchAgent, so its output goes to a file.
LABEL="com.github.fqazzazee.$SERVICE_NAME"
AGENT_DIR="$HOME/Library/LaunchAgents"
LOG_FILE="$data_home/$SERVICE_NAME/server.log"

# ------------------------------------------------------------------ output --

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  B=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; R=$'\033[0m'
else
  B=''; DIM=''; RED=''; GRN=''; YEL=''; R=''
fi

say()  { printf '%s\n' "$*"; }
step() { printf '%s==>%s %s\n' "$B" "$R" "$*"; }
ok()   { printf '  %s✓%s %s\n' "$GRN" "$R" "$*"; }
warn() { printf '  %s!%s %s\n' "$YEL" "$R" "$*" >&2; }
die()  { printf '%serror:%s %s\n' "$RED" "$R" "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

# A value as you would type it into a shell: as is when that is safe, otherwise
# in single quotes. For the commands this script prints for you to copy.
sh_word() {
  case "$1" in
    ""|*[!A-Za-z0-9_./:@%+=,-]*) printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")" ;;
    *) printf '%s' "$1" ;;
  esac
}

# The command that runs the server in the foreground, for when there is no
# service to do it.
run_by_hand() {
  say "    BT_DATA_DIR=$(sh_word "$DATA_DIR") BT_PORT=$(sh_word "$PORT") BT_HOST=$(sh_word "$HOST") node $(sh_word "$APP_DIR/server.js")"
}

# ------------------------------------------------------------------- checks --

check_node() {
  have node || die "Node.js is not installed. Node $MIN_NODE_MAJOR or newer is required.
  macOS:         the macOS Installer (.pkg) from https://nodejs.org/en/download
                 (or brew install node, if you already use Homebrew)
  Fedora:        sudo dnf install nodejs
  Debian/Ubuntu: sudo apt install nodejs
  Anywhere:      https://nodejs.org  (or nvm, which needs no root)"
  local major
  major="$(node -p 'process.versions.node.split(".")[0]')"
  [ "$major" -ge "$MIN_NODE_MAJOR" ] \
    || die "Node $major is too old; this needs $MIN_NODE_MAJOR or newer (found $(node --version))."
  ok "Node $(node --version)"
}

# What runs services here: systemd on Fedora and every other mainstream
# distro, launchd on macOS, or nothing (a container, WSL1, a distro that went
# its own way). Without one the app still runs, so the script says so plainly
# rather than refusing. Worked out once, into $SVC, before any action runs.
service_manager() {
  case "$(uname -s)" in
    Linux)  if have systemctl && [ -d /run/systemd/system ]; then echo systemd; return; fi ;;
    Darwin) if have launchctl; then echo launchd; return; fi ;;
  esac
  echo none
}

sc() { if [ "$MODE" = "system" ]; then sudo systemctl "$@"; else systemctl --user "$@"; fi; }

# The file that defines the service: a systemd unit or a launchd property list.
unit_path() {
  if [ "$SVC" = "launchd" ]; then echo "$AGENT_DIR/$LABEL.plist"
  elif [ "$MODE" = "system" ]; then echo "/etc/systemd/system/$SERVICE_NAME.service"
  else echo "$UNIT_DIR/$SERVICE_NAME.service"; fi
}

# On a Mac without Apple's Command Line Tools, /usr/bin/git is a placeholder: it
# offers to install them and fails. So "is git on the PATH" is the wrong
# question; "does git run" is the right one. Where that placeholder is the only
# git it is not even run, because running it pops up the install dialog.
git_works() {
  have git || return 1
  if [ "$(uname -s)" = "Darwin" ] && [ "$(command -v git)" = "/usr/bin/git" ] \
     && have xcode-select && ! xcode-select -p >/dev/null 2>&1; then
    return 1
  fi
  git --version >/dev/null 2>&1
}

# ------------------------------------------------------------- path safety --

# An absolute, physical path for comparing locations, whether or not it exists
# yet: the nearest existing ancestor is resolved through any symlinks, and the
# rest is put back with . and .. collapsed. Only used for the checks below; the
# paths written to the unit stay as they were given.
real_path() {
  local p="$1" tail="" out part rest
  case "$p" in "~") p="$HOME" ;; "~/"*) p="$HOME/${p#\~/}" ;; esac
  case "$p" in /*) ;; *) p="$PWD/$p" ;; esac
  while [ ! -d "$p" ]; do
    tail="/$(basename "$p")$tail"
    p="$(dirname "$p")"
  done
  out="$(cd -P "$p" && pwd -P)"
  rest="${tail#/}"
  while [ -n "$rest" ]; do
    part="${rest%%/*}"
    case "$rest" in */*) rest="${rest#*/}" ;; *) rest="" ;; esac
    case "$part" in
      ""|.) ;;
      ..) out="$(dirname "$out")" ;;
      *)  out="${out%/}/$part" ;;
    esac
  done
  printf '%s\n' "$out"
}

# True when $1 is $2 or somewhere underneath it. Both must be real_path output.
is_within() { case "$1/" in "${2%/}/"*) return 0 ;; esac; return 1; }

is_empty_dir() { [ -d "$1" ] && [ -z "$(ls -A "$1" 2>/dev/null)" ]; }

looks_like_app() {
  [ -f "$1/server.js" ] && [ -f "$1/package.json" ] \
    && grep -q '"name": *"ultimate-baby-tracker"' "$1/package.json"
}

looks_like_data() {
  [ -f "$1/config.json" ] || [ -f "$1/events.log" ]
}

# Update replaces the application directory wholesale and uninstall deletes it,
# so nothing worth keeping may live inside it - and it must never be a
# directory that holds anything else of yours. Checked before anything is
# touched, for every action that writes.
check_layout() {
  local app data backups home
  app="$(real_path "$APP_DIR")"
  data="$(real_path "$DATA_DIR")"
  backups="$(real_path "$BACKUP_DIR")"
  home="$(real_path "$HOME")"

  if [ "$app" = "/" ] || is_within "$home" "$app"; then
    die "Refusing to use $APP_DIR as the application directory: it contains your home directory."
  fi
  if [ "$data" = "/" ] || is_within "$home" "$data"; then
    die "Refusing to use $DATA_DIR as the data directory: it contains your home directory."
  fi

  local fix
  if [ "$ACTION" = "install" ]; then
    fix="Pick one outside it, e.g. --data \"$(dirname "$APP_DIR")/data\"."
  else
    fix="Copy that folder somewhere outside $APP_DIR first, point the service at
  the copy with: $SELF service add --data <new path>
  and then run this again."
  fi
  if is_within "$data" "$app"; then
    die "The data directory $DATA_DIR is inside the application directory $APP_DIR.
  Updating replaces that directory and uninstalling deletes it, so your entries
  would go with it. $fix"
  fi
  if is_within "$app" "$data"; then
    die "The application directory $APP_DIR is inside the data directory $DATA_DIR.
  Keep them side by side instead, e.g. --dir \"$(dirname "$DATA_DIR")/app\"."
  fi
  if is_within "$backups" "$app"; then
    die "The snapshot directory $BACKUP_DIR is inside the application directory
  $APP_DIR, so an update would delete the snapshot it had just taken.
  Pick one outside it with --backups."
  fi
}

# Swap a freshly fetched copy into place. Only called once the copy is complete,
# so a failed download or clone leaves the existing install as it was.
replace_dir() {
  local stage="$1" dest="$2"
  rm -rf "$dest"
  mv "$stage" "$dest"
}

# The existing directory may only be replaced if it is empty or is this app.
# Anything else is somebody's files, and `--dir ~/Documents` must not wipe them.
check_replaceable() {
  local dest="$1"
  [ -e "$dest" ] || return 0
  is_empty_dir "$dest" && return 0
  looks_like_app "$dest" && return 0
  die "$dest already exists and is not an install of $APP_NAME.
  Refusing to replace it. Pick a new or empty directory with --dir."
}

# -------------------------------------------------------------- fetch code --

# Getting the code and putting it in place are two steps, so that an update
# can do all the downloading while the tracker is still running and only stop
# it for the switch. fetch_source leaves the new revision waiting - in the
# checkout's object store, or unpacked into $STAGE beside the destination - and
# changes nothing you would notice; switch_source then puts it in place.
STAGE=""

# Prefer a git clone: updating is then a fetch, and you can see what changed.
# Fall back to the branch tarball where git is not available.
fetch_source() {
  local dest="$1"
  check_replaceable "$dest"
  STAGE=""
  # A checkout is only updated in place while git works; if it has stopped
  # working (the Command Line Tools were removed, say) the copy is replaced.
  if [ -d "$dest/.git" ] && git_works; then
    step "Fetching $BRANCH"
    git -C "$dest" remote set-url origin "$REPO_URL"
    # Spelled out in full because the clone is single-branch: its configured
    # refspec only covers the branch it was cloned on, so a plain fetch of
    # another branch would never create origin/<that branch>.
    git -C "$dest" fetch -q --depth 1 origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH" \
      || die "Could not fetch $BRANCH from $REPO_URL; git's message is above. Nothing was changed."
    return
  fi

  mkdir -p "$(dirname "$dest")"
  # Fetched beside the destination, then swapped in, so it is a rename on the
  # same filesystem and the old copy is only removed once the new one is whole.
  # If anything fails before then, the EXIT trap removes the half-made copy.
  STAGE="$(dirname "$dest")/.$(basename "$dest").new.$$"
  rm -rf "$STAGE"
  if git_works; then
    step "Cloning $REPO_URL ($BRANCH)"
    # git's own message says what went wrong, so it is left on the screen.
    git clone -q --depth 1 --branch "$BRANCH" "$REPO_URL" "$STAGE" \
      || die "Could not clone $REPO_URL ($BRANCH); git's message is above."
  else
    have curl || have wget || die "Need git, curl or wget to download the app."
    have tar || die "Need tar to unpack the download."
    step "Downloading $BRANCH (git is not available, so this is a tarball)"
    local tmp src
    tmp="$(mktemp -d)"
    local url="$REPO_URL/archive/refs/heads/$BRANCH.tar.gz"
    # Cleaned up by hand rather than with a RETURN trap, which stays set after
    # this function and then fires again with $tmp out of scope under set -u.
    if ! { if have curl; then curl -fsSL "$url" -o "$tmp/src.tgz"; else wget -qO "$tmp/src.tgz" "$url"; fi \
           && tar -xzf "$tmp/src.tgz" -C "$tmp"; }; then
      rm -rf "$tmp"
      die "Could not download $url. Check the network, or the branch name."
    fi
    # The archive nests everything under <repo>-<branch>/.
    for src in "$tmp"/*-"$BRANCH"; do break; done
    if ! looks_like_app "$src"; then
      rm -rf "$tmp"
      die "The download from $url does not contain the app."
    fi
    mkdir -p "$STAGE"
    cp -a "$src"/. "$STAGE"/
    rm -rf "$tmp"
  fi
}

switch_source() {
  local dest="$1"
  if [ -z "$STAGE" ]; then
    # Forced, so that a stray local edit is overwritten instead of aborting the
    # update halfway: the application directory is not for your own changes.
    git -C "$dest" checkout -q -f -B "$BRANCH" "origin/$BRANCH"
    ok "At $(git -C "$dest" rev-parse --short HEAD) on $BRANCH"
    return
  fi
  replace_dir "$STAGE" "$dest"
  STAGE=""
  if [ -d "$dest/.git" ]; then
    ok "At $(git -C "$dest" rev-parse --short HEAD)"
  else
    ok "Unpacked to $dest"
    warn "Without git, 'update' re-downloads the whole tarball each time."
  fi
}

# The checked-out revision, or "unknown" for a tarball install. Only a working
# git is asked, for the same reason as in git_works.
revision() {
  if [ -d "$APP_DIR/.git" ] && git_works; then
    git -C "$APP_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown
  else
    echo unknown
  fi
}

verify_app() {
  [ -f "$APP_DIR/server.js" ] && [ -f "$APP_DIR/package.json" ] \
    || die "$APP_DIR does not look like the app (no server.js). Refusing to continue."
}

# /tmp is cleared on reboot on Fedora and most modern distros, so an install
# there disappears the first time the machine restarts - taking the entries
# with it if the data directory went along too. Say so before, not after.
check_paths() {
  case "$APP_DIR" in
    /tmp/*|/var/tmp/*|/dev/shm/*|/private/tmp/*|/private/var/tmp/*)
      [ "$ASSUME_YES" = "1" ] || die "Refusing to install to $APP_DIR — /tmp is cleared on reboot.
  Pick somewhere that survives: --dir \"\$HOME/.local/share/$SERVICE_NAME/app\"
  (Pass --yes if you really mean it, e.g. for a throwaway test.)"
      warn "Installing under /tmp: this will be gone after a reboot." ;;
  esac
  case "$DATA_DIR" in
    /tmp/*|/var/tmp/*|/dev/shm/*)
      warn "Data directory is under /tmp — your entries will not survive a reboot." ;;
  esac
  # macOS keeps background jobs out of these folders unless they are granted
  # Full Disk Access, so a LaunchAgent pointed at one fails with "Operation not
  # permitted" while the same command run in Terminal works.
  if [ "$SVC" = "launchd" ]; then
    local d
    for d in "$APP_DIR" "$DATA_DIR"; do
      case "$d/" in
        "$HOME/Documents/"*|"$HOME/Desktop/"*|"$HOME/Downloads/"*|"$HOME/Library/Mobile Documents/"*)
          warn "$d is in a folder macOS keeps background services out of
    (Documents, Desktop, Downloads, iCloud Drive). The service will be refused
    access unless node is given Full Disk Access; the default location avoids this." ;;
      esac
    done
  fi
}

# ------------------------------------------------------------------ backups --

# The data directory sits outside the app directory, so an update cannot reach
# it. This is belt and braces: a dated copy before anything is replaced.
snapshot_data() {
  [ -d "$DATA_DIR" ] || return 0
  # An empty data directory is not worth a snapshot.
  find "$DATA_DIR" -mindepth 1 -print -quit 2>/dev/null | grep -q . || return 0
  mkdir -p "$BACKUP_DIR"
  local stamp file
  stamp="$(date +%Y%m%d-%H%M%S)"
  file="$BACKUP_DIR/data-$stamp.tar.gz"
  tar -czf "$file" -C "$(dirname "$DATA_DIR")" "$(basename "$DATA_DIR")"
  ok "Data snapshot: $file"
  # Keep the last ten; older ones are noise.
  ls -1t "$BACKUP_DIR"/data-*.tar.gz 2>/dev/null | tail -n +11 | while read -r old; do rm -f "$old"; done
}

# ------------------------------------------------------------------ service --

# systemd reads a unit line its own way: % starts a specifier everywhere, $
# expands a variable in ExecStart's arguments (though not in the program path),
# and whitespace splits ExecStart, Environment and ReadWritePaths into words
# unless they are double-quoted. These write a value so that systemd reads back
# exactly what was given - a data directory called "Baby Tracker" included.
sd_quote() {
  printf '"%s"' "$(printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/%/%%/g')"
}
sd_exec_arg() {
  printf '"%s"' "$(printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/%/%%/g' -e 's/\$/$$/g')"
}
# WorkingDirectory= takes the rest of the line as one path, quotes and all.
sd_path() { printf '%s' "$1" | sed 's/%/%%/g'; }

# And the reverse, for reading our own unit back. Units written before values
# were quoted have Environment=BT_PORT=8477, so that form is read too.
unit_env() {
  sed -n -e "s/^Environment=\"$2=\\(.*\\)\"\$/\\1/p" -e "s/^Environment=$2=//p" "$1" | tail -1 \
    | sed -e 's/\\\(.\)/\1/g' -e 's/%%/%/g'
}
unit_workdir() {
  sed -n 's/^WorkingDirectory=//p' "$1" | tail -1 | sed 's/%%/%/g'
}

write_user_unit() {
  mkdir -p "$UNIT_DIR"
  cat > "$(unit_path)" <<UNIT
[Unit]
Description=$APP_NAME
Documentation=$REPO_URL
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$(sd_path "$APP_DIR")
ExecStart=$(sd_quote "$(command -v node)") $(sd_exec_arg "$APP_DIR/server.js")
Environment=$(sd_quote "BT_PORT=$PORT")
Environment=$(sd_quote "BT_HOST=$HOST")
Environment=$(sd_quote "BT_DATA_DIR=$DATA_DIR")
Restart=on-failure
RestartSec=3
NoNewPrivileges=yes
# Deliberately no PrivateTmp here: it gives the unit its own /tmp namespace,
# which hides the application directory from itself if anyone installs under
# /tmp and fails as a baffling 200/CHDIR. The system unit below, which installs
# to /opt, keeps it.

[Install]
WantedBy=default.target
UNIT
  ok "Unit written to $(unit_path)"
}

write_system_unit() {
  id -u "$SERVICE_USER" >/dev/null 2>&1 || {
    step "Creating the unprivileged $SERVICE_USER account"
    sudo useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin "$SERVICE_USER" 2>/dev/null \
      || sudo useradd --system --home-dir "$DATA_DIR" --shell /sbin/nologin "$SERVICE_USER"
  }
  sudo mkdir -p "$DATA_DIR"
  sudo chown -R "$SERVICE_USER:$SERVICE_USER" "$DATA_DIR"
  sudo tee "$(unit_path)" >/dev/null <<UNIT
[Unit]
Description=$APP_NAME
Documentation=$REPO_URL
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
WorkingDirectory=$(sd_path "$APP_DIR")
ExecStart=$(sd_quote "$(command -v node)") $(sd_exec_arg "$APP_DIR/server.js")
Environment=$(sd_quote "BT_PORT=$PORT")
Environment=$(sd_quote "BT_HOST=$HOST")
Environment=$(sd_quote "BT_DATA_DIR=$DATA_DIR")
Restart=on-failure
RestartSec=3
# Nothing here needs privileges or anything outside its own data directory.
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=$(sd_quote "$DATA_DIR")

[Install]
WantedBy=multi-user.target
UNIT
  ok "Unit written to $(unit_path)"
}

# ----------------------------------------------------------------- launchd --

# On macOS the service is a per-user LaunchAgent: a property list in
# ~/Library/LaunchAgents that launchd loads at every login (RunAtLoad) and
# restarts whenever it stops (KeepAlive). Like the systemd user unit, it needs
# no root. It is loaded into, and unloaded from, the logged-in user's session.

xml_escape()   { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }
xml_unescape() { sed -e 's/&lt;/</g' -e 's/&gt;/>/g' -e 's/&amp;/\&/g'; }

# One <key>…</key><string>…</string> pair out of the property list, whether it
# is laid out the way write_launch_agent writes it or has been re-saved by
# plutil or Xcode with each part on a line of its own.
plist_value() {
  tr -d '\n' < "$1" \
    | sed -n "s|.*<key>$2</key>[[:space:]]*<string>\\([^<]*\\)</string>.*|\\1|p" | xml_unescape
}

write_launch_agent() {
  mkdir -p "$AGENT_DIR" "$(dirname "$LOG_FILE")"
  cat > "$(unit_path)" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(xml_escape "$(command -v node)")</string>
    <string>$(xml_escape "$APP_DIR/server.js")</string>
  </array>
  <key>WorkingDirectory</key><string>$(xml_escape "$APP_DIR")</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>BT_PORT</key><string>$(xml_escape "$PORT")</string>
    <key>BT_HOST</key><string>$(xml_escape "$HOST")</string>
    <key>BT_DATA_DIR</key><string>$(xml_escape "$DATA_DIR")</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$(xml_escape "$LOG_FILE")</string>
  <key>StandardErrorPath</key><string>$(xml_escape "$LOG_FILE")</string>
</dict>
</plist>
PLIST
  ok "LaunchAgent written to $(unit_path)"
}

la_domain() { echo "gui/$(id -u)"; }
la_target() { echo "$(la_domain)/$LABEL"; }
la_loaded() { launchctl print "$(la_target)" >/dev/null 2>&1; }

# Captured rather than piped into grep -q, which can exit before launchctl has
# finished writing and so fail the pipeline under pipefail.
la_running() {
  local out
  out="$(launchctl print "$(la_target)" 2>/dev/null)" || return 1
  case "$out" in *"state = running"*) return 0 ;; esac
  return 1
}

la_load() {
  # Undo any earlier `launchctl disable`, which would make the load a no-op.
  launchctl enable "$(la_target)" >/dev/null 2>&1 || true
  launchctl bootstrap "$(la_domain)" "$(unit_path)"
}

la_unload() {
  la_loaded || return 0
  launchctl bootout "$(la_target)" >/dev/null 2>&1 || true
  # bootout can return before the job is fully gone, and loading it again in
  # that moment fails with "Input/output error". Give it a few seconds.
  local i=0
  while la_loaded && [ "$i" -lt 10 ]; do sleep 1; i=$((i + 1)); done
}

# ------------------------------------------------- either service manager --

# The service definition records the node path and the directories, so it is
# rewritten on every add and update.
service_write() {
  case "$SVC" in
    systemd)
      if [ "$MODE" = "system" ]; then write_system_unit; else write_user_unit; fi
      sc daemon-reload ;;
    launchd) write_launch_agent ;;
  esac
}

# "On" means the service manager is keeping it up. For launchd that is being
# loaded, even in the seconds between a crash and the restart.
service_running() {
  case "$SVC" in
    systemd) sc is-active --quiet "$SERVICE_NAME" 2>/dev/null ;;
    launchd) la_loaded ;;
    *) return 1 ;;
  esac
}

service_start() {
  case "$SVC" in
    systemd) sc start "$SERVICE_NAME" ;;
    launchd) if la_loaded; then launchctl kickstart "$(la_target)"; else la_load; fi ;;
  esac
}

# Stopped until the next start - or, for the LaunchAgent, the next login.
service_stop() {
  case "$SVC" in
    systemd) sc stop "$SERVICE_NAME" ;;
    launchd) la_unload ;;
  esac
}

service_restart() {
  case "$SVC" in
    systemd) sc restart "$SERVICE_NAME" ;;
    launchd) if la_loaded; then launchctl kickstart -k "$(la_target)"; else la_load; fi ;;
  esac
}

service_logs() {
  local lines="$1"; shift
  case "$SVC" in
    systemd)
      if [ "$MODE" = "system" ]; then sudo journalctl -u "$SERVICE_NAME" -n "$lines" "$@"
      else journalctl --user -u "$SERVICE_NAME" -n "$lines" "$@"; fi ;;
    launchd)
      if [ -f "$LOG_FILE" ]; then tail -n "$lines" "$@" "$LOG_FILE"
      else say "  (no log yet at $LOG_FILE)"; fi ;;
  esac
}

# start, stop, restart and logs need a service to act on. Where there is none,
# say why and what to do instead, rather than failing on a missing command.
require_service() {
  if [ "$SVC" = "none" ]; then
    warn "This machine has no service manager (neither systemd nor launchd), so"
    say  "  there is no service, and '$ACTION' does not apply. Run the tracker by hand:"
    run_by_hand
    exit 1
  fi
  [ -f "$(unit_path)" ] || die "No service is installed yet. Create it with: $SELF service add"
}

service_add() {
  if [ "$SVC" = "none" ]; then
    warn "No systemd or launchd here, so there is no service to add."
    say  "  Run it by hand instead:"
    run_by_hand
    return 0
  fi
  if [ "$SVC" = "launchd" ]; then
    launch_agent_add
  else
    systemd_add
  fi
  sleep 2
  service_status_short
}

launch_agent_add() {
  step "Installing the LaunchAgent"
  write_launch_agent
  la_unload
  if la_load; then
    ok "Loaded; it starts again at every login"
  else
    # Typically over SSH with nobody logged in at the Mac: there is no GUI
    # session to load it into. The file is in place, so the next login will.
    warn "launchd would not load it now (usual over SSH with nobody logged in at"
    say  "  the Mac). It is installed and starts at your next login, or run:"
    say  "    ${B}$SELF start${R}"
  fi
  say  "  ${DIM}It runs while you are logged in. If this Mac restarts on its own, turn"
  say  "  on automatic login in System Settings > Users & Groups so it comes back.${R}"
}

systemd_add() {
  step "Installing the $([ "$MODE" = system ] && echo system || echo user) service"
  service_write
  sc enable "$SERVICE_NAME" >/dev/null 2>&1 || true
  sc restart "$SERVICE_NAME"

  # A user service stops at logout unless lingering is on. Ask for it; if the
  # policy says no, say so rather than leaving a service that quietly dies.
  if [ "$MODE" = "user" ]; then
    # $USER is not set in every environment (cron, env -i, some containers).
    local me; me="${USER:-$(id -un)}"
    if loginctl show-user "$me" -p Linger --value 2>/dev/null | grep -q yes; then
      ok "Lingering already enabled — it will run without you logged in"
    elif loginctl enable-linger "$me" >/dev/null 2>&1; then
      ok "Lingering enabled — it will run without you logged in"
    else
      warn "Could not enable lingering. The service will stop when you log out."
      say  "  To fix: ${B}sudo loginctl enable-linger $me${R}"
    fi
  fi
}

service_remove() {
  case "$SVC" in
    none) warn "No systemd or launchd here; there is no service to remove."; return 0 ;;
    launchd)
      step "Removing the LaunchAgent"
      la_unload
      rm -f "$(unit_path)" ;;
    systemd)
      step "Removing the service"
      sc disable --now "$SERVICE_NAME" >/dev/null 2>&1 || true
      if [ "$MODE" = "system" ]; then sudo rm -f "$(unit_path)"; else rm -f "$(unit_path)"; fi
      sc daemon-reload ;;
  esac
  ok "Service removed. The app and your data are untouched."
}

# Whether the server process is actually up right now (rather than merely
# being kept up, which is what service_running asks).
service_up() {
  case "$SVC" in
    systemd) sc is-active --quiet "$SERVICE_NAME" 2>/dev/null ;;
    launchd) la_running ;;
    *) return 1 ;;
  esac
}

# The address a phone on the same network would use. macOS has no hostname -I.
lan_ip() {
  if [ "$(uname -s)" = "Darwin" ]; then
    ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true
  else
    hostname -I 2>/dev/null | awk '{print $1}' || true
  fi
}

service_status_short() {
  if service_up; then
    ok "Running at ${B}http://localhost:$PORT${R}"
    if [ "$HOST" = "0.0.0.0" ]; then
      local ip; ip="$(lan_ip)"
      if [ -n "$ip" ]; then say "    On your phone: ${B}http://$ip:$PORT${R}"; fi
    fi
  else
    warn "Not running."
    if [ "$SVC" != "none" ] && [ -f "$(unit_path)" ]; then
      say "  ${DIM}Last few lines of the log:${R}"
      service_logs 6 2>/dev/null | sed 's/^/    /' || true
    fi
  fi
}

# ------------------------------------------------------------------ actions --

do_install() {
  step "Installing $APP_NAME"
  check_node
  check_paths
  fetch_source "$APP_DIR"
  switch_source "$APP_DIR"
  verify_app
  mkdir -p "$DATA_DIR"
  ok "Data directory: $DATA_DIR"
  if [ "$NO_SERVICE" = "1" ]; then
    say ""
    ok "Installed. Start it with:"
    run_by_hand
  else
    service_add
  fi
  say ""
  say "  ${DIM}app  $APP_DIR${R}"
  say "  ${DIM}data $DATA_DIR${R}"
  say "  ${DIM}update later with: $SELF update${R}"
}

do_update() {
  step "Updating $APP_NAME"
  check_node
  verify_app
  local before after
  before="$(revision)"

  # Everything that needs the network happens first, while the tracker is
  # still up, so a bad connection or a mistyped branch changes nothing.
  fetch_source "$APP_DIR"

  # From here the service is off until the end, or until the EXIT trap starts
  # it again if anything fails.
  local was_running=0
  if service_running; then
    was_running=1
    RESTART_ON_EXIT=1
    step "Stopping the service"
    service_stop
  fi
  # Taken with the service stopped, so it cannot catch a half-written file.
  snapshot_data
  switch_source "$APP_DIR"
  verify_app
  after="$(revision)"

  # The unit pins the node path and the data directory, so rewrite it in case
  # either moved between releases.
  if [ -f "$(unit_path)" ]; then service_write; fi
  if [ "$was_running" = "1" ]; then
    service_start
    RESTART_ON_EXIT=0
    sleep 1
  fi

  if [ "$after" = unknown ]; then
    ok "Replaced with the latest download of $BRANCH"
  elif [ "$before" = "$after" ]; then
    ok "Already at the latest revision ($after)"
  else
    ok "Updated $before → $after"
    [ "$after" != unknown ] && git -C "$APP_DIR" --no-pager log --oneline "$before..$after" 2>/dev/null | head -10 || true
  fi
  [ "$was_running" = "1" ] && service_status_short
  return 0
}

do_uninstall() {
  step "Uninstalling $APP_NAME"
  # Check everything first, so a refusal leaves the service and files intact.
  if [ -e "$APP_DIR" ] && ! looks_like_app "$APP_DIR"; then
    die "$APP_DIR does not look like an install of $APP_NAME. Not deleting it."
  fi
  if [ "$PURGE" = "1" ] && [ -e "$DATA_DIR" ] \
     && ! is_empty_dir "$DATA_DIR" && ! looks_like_data "$DATA_DIR"; then
    die "$DATA_DIR has no config.json or events.log, so it does not look like the
  tracker's data directory. Not deleting it."
  fi
  service_remove
  if [ -e "$APP_DIR" ]; then
    rm -rf "$APP_DIR"
    ok "Removed $APP_DIR"
  else
    ok "Nothing at $APP_DIR to remove"
  fi
  # The LaunchAgent's log is the app's, not yours, so it goes with the app.
  if [ "$SVC" = "launchd" ] && [ -f "$LOG_FILE" ]; then
    rm -f "$LOG_FILE"
    ok "Removed $LOG_FILE"
  fi
  if [ "$PURGE" = "1" ]; then
    snapshot_data
    rm -rf "$DATA_DIR"
    warn "Removed $DATA_DIR — the snapshot in $BACKUP_DIR is all that is left."
  else
    ok "Kept your entries in $DATA_DIR (pass --purge to delete them too)"
  fi
}

do_status() {
  say "${B}$APP_NAME${R}"
  local rev; rev="$(revision)"
  say "  app     $APP_DIR $([ "$rev" != unknown ] && echo "($rev)" || echo '')"
  say "  data    $DATA_DIR"
  say "  version $(node -p 'require(process.argv[1]).version' "$APP_DIR/package.json" 2>/dev/null || echo 'not installed')"
  case "$SVC" in
    systemd)
      say "  unit    $(unit_path)"
      say "  state   $(sc is-active "$SERVICE_NAME" 2>/dev/null || echo inactive) / $(sc is-enabled "$SERVICE_NAME" 2>/dev/null || echo disabled)" ;;
    launchd)
      say "  agent   $(unit_path)$([ -f "$(unit_path)" ] || echo ' (not installed)')"
      say "  log     $LOG_FILE"
      if la_running; then say "  state   running"
      elif la_loaded; then say "  state   loaded, not running (launchd retries every few seconds)"
      else say "  state   not loaded"; fi ;;
    *)
      say "  state   no service manager on this machine (neither systemd nor launchd)" ;;
  esac
  service_status_short
}

usage() {
  cat <<USAGE
${B}$APP_NAME${R} — installer and service manager

  ${B}$SELF install${R}              install, then run it as a service
  ${B}$SELF update${R}               fetch the latest revision and restart
  ${B}$SELF service add${R}          create (or recreate) the service
  ${B}$SELF service remove${R}       stop and delete the service, keep everything else
  ${B}$SELF uninstall${R} [--purge]  remove the app; --purge deletes your entries too
  ${B}$SELF status${R}               where things are and whether it is running
  ${B}$SELF start|stop|restart${R}
  ${B}$SELF logs${R} [-f]            service log

Options
  --system            machine-wide service under a dedicated account (needs root);
                      remembered, so later commands need not repeat it
  --user              the per-user service, even where a --system one exists
  --port N            default $PORT
  --host ADDR         default $HOST  (127.0.0.1 keeps it off the network)
  --branch NAME       default $DEFAULT_BRANCH
  --dir PATH          application directory
  --data PATH         data directory
  --backups PATH      where update snapshots go (default: beside the data)
  --no-service        install only; do not create a service
  --purge             with uninstall, also delete the data directory
  -y, --yes           do not prompt

A user service needs no root and survives reboots once lingering is on. On
macOS the service is a LaunchAgent that runs while you are logged in, and its
log is $LOG_FILE.
Your entries live in the data directory, which is never inside the application
directory, so updating cannot touch them.
USAGE
}

# -------------------------------------------------------------------- parse --

# Every option that takes a value has to be given one. Without this check a
# trailing --port ends the script with "$2: unbound variable" (set -u), and
# "--port --host x" quietly takes "--host" as the port.
need_value() {
  if [ $# -lt 2 ] || [ -z "$2" ]; then die "$1 needs a value  (try --help)"; fi
  case "$2" in -*) die "$1 needs a value, but got $2  (try --help)" ;; esac
}

# A relative --dir or --data would be written into the unit as is, and the
# service does not start from the directory you ran this in.
absolute() {
  case "$1" in /*) printf '%s\n' "$1" ;; *) printf '%s\n' "$PWD/$1" ;; esac
}

ACTION=""
SUBACTION=""
SHOW_HELP=0
MODE_SET=0
ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    install|update|uninstall|status|start|stop|restart|logs) ACTION="$1"; shift ;;
    service) ACTION="service"; shift; SUBACTION="${1:-}"; [ $# -gt 0 ] && shift ;;
    --system) MODE="system"; MODE_SET=1; shift ;;
    --user)   MODE="user"; MODE_SET=1; shift ;;
    --port)   need_value "$@"; PORT="$2"; PORT_SET=1; shift 2 ;;
    --host)   need_value "$@"; HOST="$2"; HOST_SET=1; shift 2 ;;
    --branch) need_value "$@"; BRANCH="$2"; shift 2 ;;
    --dir)    need_value "$@"; APP_DIR="$(absolute "$2")"; DIR_SET=1; shift 2 ;;
    --data)   need_value "$@"; DATA_DIR="$(absolute "$2")"; DATA_SET=1; shift 2 ;;
    --backups) need_value "$@"; BACKUP_DIR="$(absolute "$2")"; BACKUP_SET=1; shift 2 ;;
    --no-service) NO_SERVICE=1; shift ;;
    --purge)  PURGE=1; shift ;;
    -y|--yes) ASSUME_YES=1; shift ;;
    -f|--follow) ARGS+=("-f"); shift ;;
    -h|--help) SHOW_HELP=1; shift ;;
    *) die "Unknown argument: $1  (try --help)" ;;
  esac
done

case "$PORT" in
  ""|*[!0-9]*) die "The port has to be a number, not \"$PORT\"." ;;
esac
[ "$PORT" -ge 1 ] && [ "$PORT" -le 65535 ] || die "The port has to be between 1 and 65535, not $PORT."

SVC="$(service_manager)"
if [ "$MODE" = "system" ] && [ "$SVC" != "systemd" ]; then
  if [ "$SVC" = "launchd" ]; then
    die "--system is for Linux. On macOS the service is a per-user LaunchAgent,
  which needs no root; leave --system out."
  fi
  die "--system needs systemd, and this machine does not have it."
fi

# --system is remembered too: with a machine-wide unit in place and no user
# one, later commands act on the machine-wide one without being told again.
# --user says otherwise.
if [ "$SVC" = "systemd" ] && [ "$MODE_SET" = 0 ] && [ ! -f "$(unit_path)" ] \
   && [ -f "/etc/systemd/system/$SERVICE_NAME.service" ]; then
  MODE="system"
fi

# The defaults for this mode, before anything on the command line or in the
# unit; the snapshot directory below needs to know whether the data moved.
if [ "$MODE" = "system" ]; then
  default_data="/var/lib/$SERVICE_NAME"
  [ "$DIR_SET"  = 0 ] && APP_DIR="/opt/$SERVICE_NAME"
  [ "$DATA_SET" = 0 ] && DATA_DIR="$default_data"
  [ "$BACKUP_SET" = 0 ] && BACKUP_DIR="/var/backups/$SERVICE_NAME"
else
  default_data="$data_home/$SERVICE_NAME/data"
fi

# Once a unit exists it is the record of where things went and on what port, so
# `status`, `restart` and `update` need no flags repeated at them - and cannot
# report a port the service is not actually on. Anything named on the command
# line still wins.
load_unit_settings() {
  local unit; unit="$(unit_path)"
  [ -f "$unit" ] || return 0
  local v
  if [ "$SVC" = "launchd" ]; then
    v="$(plist_value "$unit" BT_PORT)";          [ -n "$v" ] && [ "$PORT_SET" = 0 ] && PORT="$v"
    v="$(plist_value "$unit" BT_HOST)";          [ -n "$v" ] && [ "$HOST_SET" = 0 ] && HOST="$v"
    v="$(plist_value "$unit" BT_DATA_DIR)";      [ -n "$v" ] && [ "$DATA_SET" = 0 ] && DATA_DIR="$v"
    v="$(plist_value "$unit" WorkingDirectory)"; [ -n "$v" ] && [ "$DIR_SET" = 0 ] && APP_DIR="$v"
    v="$(plist_value "$unit" StandardOutPath)";  [ -n "$v" ] && LOG_FILE="$v"
  else
    v="$(unit_env "$unit" BT_PORT)";     [ -n "$v" ] && [ "$PORT_SET" = 0 ] && PORT="$v"
    v="$(unit_env "$unit" BT_HOST)";     [ -n "$v" ] && [ "$HOST_SET" = 0 ] && HOST="$v"
    v="$(unit_env "$unit" BT_DATA_DIR)"; [ -n "$v" ] && [ "$DATA_SET" = 0 ] && DATA_DIR="$v"
    v="$(unit_workdir "$unit")";         [ -n "$v" ] && [ "$DIR_SET" = 0 ] && APP_DIR="$v"
  fi
  return 0
}
load_unit_settings

# Snapshots live beside the data they protect, so moving the data moves them -
# whether it moved on this command line or at install time, which is why this
# comes after the unit is read. A data directory called "data" gets a
# "backups" next to it, as the default layout has; anything else gets
# "<name>-backups", so --data ~/baby does not snapshot into a vague ~/backups.
if [ "$BACKUP_SET" = 0 ] && [ "$DATA_DIR" != "$default_data" ]; then
  case "$(basename "$DATA_DIR")" in
    data) BACKUP_DIR="$(dirname "$DATA_DIR")/backups" ;;
    *)    BACKUP_DIR="${DATA_DIR%/}-backups" ;;
  esac
fi

# Piped from curl, $0 is "bash" and there is no script file in the current
# directory, so the hints name the copy that install puts in the app directory.
case "${0##*/}" in
  bash|sh|-bash|-sh|"") SELF="$(sh_word "$APP_DIR/scripts/install.sh")" ;;
  *) SELF="$0" ;;
esac

if [ "$SHOW_HELP" = 1 ]; then usage; exit 0; fi

case "${ACTION:-}" in
  install|update|uninstall) check_layout ;;
  service) if [ "$SUBACTION" = "add" ]; then check_layout; fi ;;
esac

# However the script ends, leave no half-fetched copy behind, and never leave
# the tracker switched off: if an update stopped the service and then failed,
# start it again on whatever code is in place - the old code, unless the
# failure came after the switch. A tracker that is down at 3am is worse than
# one running last week's revision.
RESTART_ON_EXIT=0
on_exit() {
  local status=$?
  if [ -n "$STAGE" ]; then rm -rf "$STAGE"; fi
  if [ "$RESTART_ON_EXIT" = "1" ]; then
    RESTART_ON_EXIT=0
    warn "The update did not finish; starting the service again."
    if service_start >/dev/null 2>&1; then
      ok "Service started again"
    else
      warn "It would not start. See: $SELF status"
    fi
  fi
  exit "$status"
}
trap on_exit EXIT

case "${ACTION:-}" in
  install)   do_install ;;
  update)    do_update ;;
  uninstall) do_uninstall ;;
  status)    do_status ;;
  start)     require_service; service_start; sleep 1; service_status_short ;;
  stop)      require_service; service_stop; ok "Stopped" ;;
  restart)   require_service; service_restart; sleep 1; service_status_short ;;
  logs)      require_service; service_logs 100 "${ARGS[@]+"${ARGS[@]}"}" ;;
  service)
    case "$SUBACTION" in
      add)    check_node; verify_app; service_add ;;
      remove) service_remove ;;
      status) do_status ;;
      *) die "service needs 'add', 'remove' or 'status'" ;;
    esac ;;
  "") usage; exit 0 ;;
  *)  die "Unknown action: $ACTION" ;;
esac
