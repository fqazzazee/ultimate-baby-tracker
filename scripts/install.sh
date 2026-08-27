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
# root, and runs under its own unprivileged account).
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

# ------------------------------------------------------------------ output --

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  B=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; R=$'\033[0m'
else
  B=''; DIM=''; RED=''; GRN=''; YEL=''; R=''
fi

# Piped from curl, $0 is "bash", so the hints have to name something runnable.
case "${0##*/}" in
  bash|sh|-bash|-sh|"") SELF="./scripts/install.sh" ;;
  *) SELF="$0" ;;
esac

say()  { printf '%s\n' "$*"; }
step() { printf '%s==>%s %s\n' "$B" "$R" "$*"; }
ok()   { printf '  %s✓%s %s\n' "$GRN" "$R" "$*"; }
warn() { printf '  %s!%s %s\n' "$YEL" "$R" "$*" >&2; }
die()  { printf '%serror:%s %s\n' "$RED" "$R" "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

# ------------------------------------------------------------------- checks --

check_node() {
  have node || die "Node.js is not installed. Node $MIN_NODE_MAJOR or newer is required.
  Fedora:        sudo dnf install nodejs
  Debian/Ubuntu: sudo apt install nodejs
  Anywhere:      https://nodejs.org  (or nvm, which needs no root)"
  local major
  major="$(node -p 'process.versions.node.split(".")[0]')"
  [ "$major" -ge "$MIN_NODE_MAJOR" ] \
    || die "Node $major is too old; this needs $MIN_NODE_MAJOR or newer (found $(node --version))."
  ok "Node $(node --version)"
}

# systemd is how a service is run on Fedora and every other mainstream distro.
# Without it the app still runs, so say so plainly rather than refusing.
has_systemd() {
  [ "$(uname -s)" = "Linux" ] && have systemctl && [ -d /run/systemd/system ]
}

systemctl_user() { systemctl --user "$@"; }
sc() { if [ "$MODE" = "system" ]; then sudo systemctl "$@"; else systemctl --user "$@"; fi; }

unit_path() {
  if [ "$MODE" = "system" ]; then echo "/etc/systemd/system/$SERVICE_NAME.service"
  else echo "$UNIT_DIR/$SERVICE_NAME.service"; fi
}

# -------------------------------------------------------------- fetch code --

# Prefer a git clone: updating is then a fetch, and you can see what changed.
# Fall back to the branch tarball where git is not installed.
fetch_source() {
  local dest="$1"
  if [ -d "$dest/.git" ]; then
    step "Updating the existing checkout"
    git -C "$dest" remote set-url origin "$REPO_URL"
    git -C "$dest" fetch --depth 1 origin "$BRANCH"
    git -C "$dest" checkout -q -B "$BRANCH" "origin/$BRANCH"
    git -C "$dest" reset --hard -q "origin/$BRANCH"
    ok "At $(git -C "$dest" rev-parse --short HEAD) on $BRANCH"
    return
  fi

  mkdir -p "$(dirname "$dest")"
  if have git; then
    step "Cloning $REPO_URL ($BRANCH)"
    rm -rf "$dest"
    git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$dest" >/dev/null 2>&1 \
      || die "Could not clone $REPO_URL. Check the network, or the branch name."
    ok "At $(git -C "$dest" rev-parse --short HEAD)"
  else
    have curl || have wget || die "Need git, curl or wget to download the app."
    have tar || die "Need tar to unpack the download."
    step "Downloading $BRANCH (git is not installed, so this is a tarball)"
    local tmp
    tmp="$(mktemp -d)"
    trap 'rm -rf "$tmp"' RETURN
    local url="$REPO_URL/archive/refs/heads/$BRANCH.tar.gz"
    if have curl; then curl -fsSL "$url" -o "$tmp/src.tgz"; else wget -qO "$tmp/src.tgz" "$url"; fi
    tar -xzf "$tmp/src.tgz" -C "$tmp"
    rm -rf "$dest"
    mkdir -p "$dest"
    # The archive nests everything under <repo>-<branch>/.
    cp -a "$tmp"/*-"$BRANCH"/. "$dest"/
    ok "Unpacked to $dest"
    warn "Without git, 'update' re-downloads the whole tarball each time."
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
    /tmp/*|/var/tmp/*|/dev/shm/*)
      [ "$ASSUME_YES" = "1" ] || die "Refusing to install to $APP_DIR — /tmp is cleared on reboot.
  Pick somewhere that survives: --dir \"\$HOME/.local/share/$SERVICE_NAME/app\"
  (Pass --yes if you really mean it, e.g. for a throwaway test.)"
      warn "Installing under /tmp: this will be gone after a reboot." ;;
  esac
  case "$DATA_DIR" in
    /tmp/*|/var/tmp/*|/dev/shm/*)
      warn "Data directory is under /tmp — your entries will not survive a reboot." ;;
  esac
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
WorkingDirectory=$APP_DIR
ExecStart=$(command -v node) $APP_DIR/server.js
Environment=BT_PORT=$PORT
Environment=BT_HOST=$HOST
Environment=BT_DATA_DIR=$DATA_DIR
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
WorkingDirectory=$APP_DIR
ExecStart=$(command -v node) $APP_DIR/server.js
Environment=BT_PORT=$PORT
Environment=BT_HOST=$HOST
Environment=BT_DATA_DIR=$DATA_DIR
Restart=on-failure
RestartSec=3
# Nothing here needs privileges or anything outside its own data directory.
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=$DATA_DIR

[Install]
WantedBy=multi-user.target
UNIT
  ok "Unit written to $(unit_path)"
}

service_add() {
  has_systemd || {
    warn "No systemd here, so there is no service to add."
    say  "  Run it by hand instead:"
    say  "    BT_DATA_DIR='$DATA_DIR' BT_PORT=$PORT node '$APP_DIR/server.js'"
    return 0
  }
  step "Installing the $([ "$MODE" = system ] && echo system || echo user) service"
  if [ "$MODE" = "system" ]; then write_system_unit; else write_user_unit; fi
  sc daemon-reload
  sc enable "$SERVICE_NAME" >/dev/null 2>&1 || true
  sc restart "$SERVICE_NAME"

  # A user service stops at logout unless lingering is on. Ask for it; if the
  # policy says no, say so rather than leaving a service that quietly dies.
  if [ "$MODE" = "user" ]; then
    if loginctl show-user "$USER" -p Linger --value 2>/dev/null | grep -q yes; then
      ok "Lingering already enabled — it will run without you logged in"
    elif loginctl enable-linger "$USER" >/dev/null 2>&1; then
      ok "Lingering enabled — it will run without you logged in"
    else
      warn "Could not enable lingering. The service will stop when you log out."
      say  "  To fix: ${B}sudo loginctl enable-linger $USER${R}"
    fi
  fi
  sleep 2
  service_status_short
}

service_remove() {
  has_systemd || { warn "No systemd here; nothing to remove."; return 0; }
  step "Removing the service"
  sc disable --now "$SERVICE_NAME" >/dev/null 2>&1 || true
  if [ "$MODE" = "system" ]; then sudo rm -f "$(unit_path)"; else rm -f "$(unit_path)"; fi
  sc daemon-reload
  ok "Service removed. The app and your data are untouched."
}

service_status_short() {
  if has_systemd && sc is-active --quiet "$SERVICE_NAME"; then
    ok "Running at ${B}http://localhost:$PORT${R}"
    if [ "$HOST" = "0.0.0.0" ]; then
      local ip
      ip="$(hostname -I 2>/dev/null | awk '{print $1}')" || ip=""
      [ -n "$ip" ] && say "    On your phone: ${B}http://$ip:$PORT${R}"
    fi
  else
    warn "Not running."
    if has_systemd; then
      say "  ${DIM}Last few lines of the log:${R}"
      if [ "$MODE" = "system" ]; then sudo journalctl -u "$SERVICE_NAME" -n 6 --no-pager 2>/dev/null | sed 's/^/    /'
      else journalctl --user -u "$SERVICE_NAME" -n 6 --no-pager 2>/dev/null | sed 's/^/    /'; fi
    fi
  fi
}

# ------------------------------------------------------------------ actions --

do_install() {
  step "Installing $APP_NAME"
  check_node
  check_paths
  fetch_source "$APP_DIR"
  verify_app
  mkdir -p "$DATA_DIR"
  ok "Data directory: $DATA_DIR"
  if [ "$NO_SERVICE" = "1" ]; then
    say ""
    ok "Installed. Start it with:"
    say "    BT_DATA_DIR='$DATA_DIR' BT_PORT=$PORT node '$APP_DIR/server.js'"
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
  before="$(git -C "$APP_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"
  snapshot_data

  local was_running=0
  if has_systemd && sc is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
    was_running=1
    sc stop "$SERVICE_NAME"
  fi

  fetch_source "$APP_DIR"
  verify_app
  after="$(git -C "$APP_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"

  if [ "$was_running" = "1" ]; then
    # The unit pins the node path and the data directory, so rewrite it in case
    # either moved between releases.
    if [ "$MODE" = "system" ]; then write_system_unit; else write_user_unit; fi
    sc daemon-reload
    sc start "$SERVICE_NAME"
    sleep 1
  fi

  if [ "$before" = "$after" ]; then
    ok "Already at the latest revision ($after)"
  else
    ok "Updated $before → $after"
    [ -d "$APP_DIR/.git" ] && git -C "$APP_DIR" --no-pager log --oneline "$before..$after" 2>/dev/null | head -10 || true
  fi
  [ "$was_running" = "1" ] && service_status_short
  return 0
}

do_uninstall() {
  step "Uninstalling $APP_NAME"
  service_remove
  rm -rf "$APP_DIR"
  ok "Removed $APP_DIR"
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
  say "  app     $APP_DIR $([ -d "$APP_DIR/.git" ] && echo "($(git -C "$APP_DIR" rev-parse --short HEAD 2>/dev/null))" || echo '')"
  say "  data    $DATA_DIR"
  say "  version $(node -p "require('$APP_DIR/package.json').version" 2>/dev/null || echo 'not installed')"
  say "  unit    $(unit_path)"
  if has_systemd; then
    say "  state   $(sc is-active "$SERVICE_NAME" 2>/dev/null || echo inactive) / $(sc is-enabled "$SERVICE_NAME" 2>/dev/null || echo disabled)"
  else
    say "  state   no systemd on this machine"
  fi
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
  --system            machine-wide service under a dedicated account (needs root)
  --port N            default $PORT
  --host ADDR         default $HOST  (127.0.0.1 keeps it off the network)
  --branch NAME       default $DEFAULT_BRANCH
  --dir PATH          application directory
  --data PATH         data directory
  --backups PATH      where update snapshots go (default: beside the data)
  --no-service        install only; do not create a service
  --purge             with uninstall, also delete the data directory
  -y, --yes           do not prompt

A user service needs no root and survives reboots once lingering is on.
Your entries live in the data directory, which is never inside the application
directory, so updating cannot touch them.
USAGE
}

# -------------------------------------------------------------------- parse --

ACTION=""
SUBACTION=""
ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    install|update|uninstall|status|start|stop|restart|logs|doctor) ACTION="$1"; shift ;;
    service) ACTION="service"; shift; SUBACTION="${1:-}"; [ $# -gt 0 ] && shift ;;
    --system) MODE="system"; shift ;;
    --user)   MODE="user"; shift ;;
    --port)   PORT="$2"; PORT_SET=1; shift 2 ;;
    --host)   HOST="$2"; HOST_SET=1; shift 2 ;;
    --branch) BRANCH="$2"; shift 2 ;;
    --dir)    APP_DIR="$2"; DIR_SET=1; shift 2 ;;
    --data)   DATA_DIR="$2"; DATA_SET=1; shift 2 ;;
    --backups) BACKUP_DIR="$2"; BACKUP_SET=1; shift 2 ;;
    --no-service) NO_SERVICE=1; shift ;;
    --purge)  PURGE=1; shift ;;
    -y|--yes) ASSUME_YES=1; shift ;;
    -f|--follow) ARGS+=("-f"); shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "Unknown argument: $1  (try --help)" ;;
  esac
done

# A machine-wide install belongs in the machine-wide places, unless the command
# line said otherwise.
if [ "$MODE" = "system" ]; then
  [ "$DIR_SET"  = 0 ] && APP_DIR="/opt/$SERVICE_NAME"
  [ "$DATA_SET" = 0 ] && DATA_DIR="/var/lib/$SERVICE_NAME"
  [ "$BACKUP_SET" = 0 ] && BACKUP_DIR="/var/backups/$SERVICE_NAME"
fi

# Snapshots live beside the data they protect, so moving the data moves them.
if [ "$BACKUP_SET" = 0 ] && [ "$DATA_SET" = 1 ]; then
  BACKUP_DIR="$(cd "$(dirname "$DATA_DIR")" 2>/dev/null && pwd || dirname "$DATA_DIR")/backups"
fi

# Once a unit exists it is the record of where things went and on what port, so
# `status`, `restart` and `update` need no flags repeated at them - and cannot
# report a port the service is not actually on. Anything named on the command
# line still wins.
load_unit_settings() {
  local unit; unit="$(unit_path)"
  [ -f "$unit" ] || return 0
  local v
  v="$(sed -n 's/^Environment=BT_PORT=//p' "$unit" | tail -1)"; [ -n "$v" ] && [ "$PORT_SET" = 0 ] && PORT="$v"
  v="$(sed -n 's/^Environment=BT_HOST=//p' "$unit" | tail -1)"; [ -n "$v" ] && [ "$HOST_SET" = 0 ] && HOST="$v"
  v="$(sed -n 's/^Environment=BT_DATA_DIR=//p' "$unit" | tail -1)"; [ -n "$v" ] && [ "$DATA_SET" = 0 ] && DATA_DIR="$v"
  v="$(sed -n 's/^WorkingDirectory=//p' "$unit" | tail -1)"; [ -n "$v" ] && [ "$DIR_SET" = 0 ] && APP_DIR="$v"
  return 0
}
load_unit_settings

case "${ACTION:-}" in
  install)   do_install ;;
  update)    do_update ;;
  uninstall) do_uninstall ;;
  status)    do_status ;;
  start)     sc start "$SERVICE_NAME"; service_status_short ;;
  stop)      sc stop "$SERVICE_NAME"; ok "Stopped" ;;
  restart)   sc restart "$SERVICE_NAME"; service_status_short ;;
  logs)      if [ "$MODE" = system ]; then sudo journalctl -u "$SERVICE_NAME" -n 100 "${ARGS[@]+"${ARGS[@]}"}";
             else journalctl --user -u "$SERVICE_NAME" -n 100 "${ARGS[@]+"${ARGS[@]}"}"; fi ;;
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
