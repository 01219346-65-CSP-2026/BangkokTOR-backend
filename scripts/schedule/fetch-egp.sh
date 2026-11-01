#!/usr/bin/env bash
#
# One scheduled e-GP fetch: discover new BMA tenders. With the BMA feed the
# run ends by re-checking the stage and deadline of every TOR not awarded yet,
# so this is refresh-bidding too.
#
#   ./scripts/schedule/fetch-egp.sh             # what launchd runs
#   ./scripts/schedule/fetch-egp.sh --days 30   # extra args go to discover
#
# It only enqueues. The ingest worker (com.bangkoktor.worker, or a
# `bun run worker` in a terminal) turns the queue into TORs.

set -uo pipefail
cd "$(dirname "$0")/../.."

# launchd starts jobs with a bare PATH; bun lives in the user's home.
BUN="${BUN:-$(command -v bun || echo "$HOME/.bun/bin/bun")}"

log() { printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }

log "discover start ${*:-}"
# ${@+"$@"}, not "$@": macOS bash 3.2 calls an empty "$@" unbound under set -u.
"$BUN" run discover ${@+"$@"}
status=$?
log "discover exit $status"
exit $status
