#!/usr/bin/env bash
#
# Drive the three pipeline stages until TARGET TORs are graded.
#
#   ./scripts/backfill.sh 100
#
# The three POST /run endpoints only ENQUEUE work; the workers do it. Extract
# and grade sweep for new candidates rather than watching, so a bulk load needs
# them re-fired as ingest drains. That polling loop is all this script is.
#
# Prerequisites, none of which this script starts for you:
#   - mongo up            docker compose up -d mongo
#   - API up on :8003     bun run dev
#   - ingest worker       bun run worker
#   - extract worker      bun run extract-worker
# Grading does NOT need grade-worker: the controller runs it in-process.

set -uo pipefail
cd "$(dirname "$0")/.."

TARGET="${1:-100}"
API="${API:-http://localhost:8003}"
POLL_SECONDS="${POLL_SECONDS:-30}"
# Grading is ~206s per TOR and runs inside the API process, so a big limit here
# just means a long-running background task, not more throughput.
GRADE_BATCH="${GRADE_BATCH:-5}"

if [[ -f .env ]]; then
  ADMIN_TOKEN="$(grep -E '^ADMIN_TOKEN=' .env | head -1 | cut -d= -f2- | tr -d '"'"'"'[:space:]')"
fi
ADMIN_TOKEN="${ADMIN_TOKEN:-}"

hit() { # METHOD PATH [JSON]
  local method="$1" path="$2" body="${3:-}"
  local args=(-s -m 120 -X "$method" "$API$path" -H "x-admin-token: $ADMIN_TOKEN")
  [[ -n "$body" ]] && args+=(-H 'content-type: application/json' -d "$body")
  curl "${args[@]}"
}

log() { printf '%s  %s\n' "$(date +%H:%M:%S)" "$*"; }

# --- preflight -------------------------------------------------------------
if ! curl -sf -m 5 "$API/health" >/dev/null; then
  echo "API is not answering on $API — start it with: bun run dev" >&2
  exit 1
fi

ready="$(curl -s -m 10 "$API/health/ready")"
if ! grep -q '"ok":true' <<<"$ready"; then
  echo "Mongo is not reachable: $ready" >&2
  echo "Start it with: docker compose up -d mongo" >&2
  exit 1
fi

probe="$(curl -s -o /dev/null -w '%{http_code}' -m 20 -X POST "$API/api/extract/run" \
  -H "x-admin-token: $ADMIN_TOKEN" -H 'content-type: application/json' -d '{"limit":1}')"
if [[ "$probe" == "404" ]]; then
  echo "Admin token rejected (the gate answers 404, not 403, on purpose)." >&2
  echo "Check ADMIN_TOKEN in .env matches the server's environment." >&2
  exit 1
fi

log "target ${TARGET} graded TORs · polling every ${POLL_SECONDS}s · ctrl-c to stop"
echo

# --- kick discovery once ---------------------------------------------------
# Only needed if the ingest queue is dry; a full CKAN scan is 511k rows and the
# watermark makes it resumable, so re-running is cheap but not free.
ingest="$(hit GET /api/ingest/status)"
pending="$(sed -n 's/.*"pending":\([0-9]*\).*/\1/p' <<<"$ingest" | head -1)"
if [[ "${pending:-0}" -lt "$TARGET" ]]; then
  log "ingest queue has ${pending:-0} pending — starting discovery"
  hit POST /api/ingest/run '{"resume":true}' >/dev/null
fi

# --- main loop -------------------------------------------------------------
stall=0
last_graded=-1

while :; do
  ingest="$(hit GET /api/ingest/status)"
  extract="$(hit GET /api/extract/status)"
  grade="$(hit GET /api/grade/status)"

  num() { sed -n "s/.*\"$2\":\([0-9]*\).*/\1/p" <<<"$1" | head -1; }

  i_pending="$(num "$ingest" pending)"
  docs="$(num "$ingest" documents)"
  e_pending="$(num "$extract" pending)"
  chunks="$(num "$extract" chunks)"
  graded="$(num "$grade" graded)"
  awaiting="$(num "$grade" awaitingGrade)"

  printf '%s  ingest_q=%-6s docs=%-5s extract_q=%-5s chunks=%-6s awaiting=%-4s graded=%s/%s\n' \
    "$(date +%H:%M:%S)" "${i_pending:-?}" "${docs:-?}" "${e_pending:-?}" \
    "${chunks:-?}" "${awaiting:-?}" "${graded:-0}" "$TARGET"

  if [[ "${graded:-0}" -ge "$TARGET" ]]; then
    echo
    log "done — ${graded} TORs graded"
    break
  fi

  # Sweep documents into the extraction queue. Idempotent: the unique index on
  # documentId makes a re-run a no-op rather than a duplicate.
  hit POST /api/extract/run '{}' >/dev/null

  # Only ask for grading when chunks exist and the in-process grader is free;
  # firing while it is busy just queues another slow background task.
  if [[ "${awaiting:-0}" -gt 0 ]]; then
    hit POST /api/grade/run "{\"limit\":${GRADE_BATCH}}" >/dev/null
  fi

  # Nothing moving anywhere for 20 polls means a dead worker, not slow work.
  if [[ "${graded:-0}" == "$last_graded" && "${i_pending:-0}" == "0" && "${e_pending:-0}" == "0" && "${awaiting:-0}" == "0" ]]; then
    stall=$((stall + 1))
    if [[ $stall -ge 20 ]]; then
      echo
      log "stalled: every queue empty and nothing grading."
      log "check workers are alive:  curl -s $API/api/pipeline/status | jq '.workers'"
      break
    fi
  else
    stall=0
  fi
  last_graded="${graded:-0}"

  sleep "$POLL_SECONDS"
done
