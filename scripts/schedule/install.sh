#!/usr/bin/env bash
#
# Put e-GP fetching on a schedule with launchd, the macOS cron.
#
#   ./scripts/schedule/install.sh                         # install or update
#   DISCOVER_HOURS="7 13 19" ./scripts/schedule/install.sh
#   ./scripts/schedule/install.sh --uninstall
#
# Two LaunchAgents for the logged-in user:
#   com.bangkoktor.discover  fetch-egp.sh at each hour in DISCOVER_HOURS
#   com.bangkoktor.worker    `bun run worker`, restarted if it crashes. A
#                            dashboard Stop exits 0 and is left stopped.
#
# launchd rather than cron: a run missed while the Mac slept happens on wake,
# and launchd never starts a second discover while one is still going.
#
# Logs: logs/discover.log, logs/worker.log (git-ignored).

set -euo pipefail
cd "$(dirname "$0")/../.."

REPO="$(pwd)"
AGENTS="$HOME/Library/LaunchAgents"
DOMAIN="gui/$(id -u)"
LABELS="com.bangkoktor.discover com.bangkoktor.worker"
DISCOVER_HOURS="${DISCOVER_HOURS:-6 18}"
BUN="${BUN:-$(command -v bun || echo "$HOME/.bun/bin/bun")}"

unload() { launchctl bootout "$DOMAIN/$1" 2>/dev/null || true; }

if [[ "${1:-}" == "--uninstall" ]]; then
  for label in $LABELS; do
    unload "$label"
    rm -f "$AGENTS/$label.plist"
  done
  echo "removed: $LABELS"
  exit 0
fi

[[ -x "$BUN" ]] || { echo "bun not found — set BUN=/path/to/bun" >&2; exit 1; }
[[ -f .env ]] || { echo "no .env in $REPO — discover and the worker need MONGODB_URI" >&2; exit 1; }
mkdir -p "$AGENTS" "$REPO/logs"

intervals=""
for hour in $DISCOVER_HOURS; do
  intervals+="<dict><key>Hour</key><integer>$hour</integer><key>Minute</key><integer>0</integer></dict>"
done

# Shared by both agents. Bun reads .env from WorkingDirectory.
common() { # LOGNAME
  cat <<XML
  <key>WorkingDirectory</key><string>$REPO</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$(dirname "$BUN"):/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>BUN</key><string>$BUN</string>
  </dict>
  <key>StandardOutPath</key><string>$REPO/logs/$1.log</string>
  <key>StandardErrorPath</key><string>$REPO/logs/$1.log</string>
XML
}

cat >"$AGENTS/com.bangkoktor.discover.plist" <<XML
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.bangkoktor.discover</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$REPO/scripts/schedule/fetch-egp.sh</string></array>
  <key>StartCalendarInterval</key>
  <array>$intervals</array>
$(common discover)
</dict>
</plist>
XML

cat >"$AGENTS/com.bangkoktor.worker.plist" <<XML
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.bangkoktor.worker</string>
  <key>ProgramArguments</key>
  <array><string>$BUN</string><string>run</string><string>worker</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <!-- Mongo down means an instant crash; don't restart faster than this. -->
  <key>ThrottleInterval</key><integer>60</integer>
$(common worker)
</dict>
</plist>
XML

for label in $LABELS; do
  plutil -lint -s "$AGENTS/$label.plist"
  unload "$label"
  launchctl bootstrap "$DOMAIN" "$AGENTS/$label.plist"
done

echo "installed: $LABELS"
echo "discover runs at: $DISCOVER_HOURS (hours, local time)"
echo "run one now:      launchctl kickstart $DOMAIN/com.bangkoktor.discover"
echo "follow it:        tail -f logs/discover.log logs/worker.log"
