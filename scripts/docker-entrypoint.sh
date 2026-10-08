#!/bin/sh
# The container's start command. Without NIGHTLY_SCHEDULE it is exactly `npm start` (as before). With it, the optional nightly scheduler
# (scripts/nightly-scheduler.ts, docs/nightly.md) runs beside the site as a separate process; the site stays the main process, a stop signal reaches both,
# and the container ends when the site does.
if [ -z "${NIGHTLY_SCHEDULE:-}" ]; then exec npm start; fi

node --import tsx scripts/nightly-scheduler.ts &
SCHED=$!
npm start &
SITE=$!
trap 'kill -TERM "$SITE" "$SCHED" 2>/dev/null' TERM INT
wait "$SITE"
CODE=$?
# a signal ends the first wait early: wait again for the site itself, so its real exit code is the container's
if kill -0 "$SITE" 2>/dev/null; then wait "$SITE"; CODE=$?; fi
kill -TERM "$SCHED" 2>/dev/null
wait "$SCHED" 2>/dev/null
exit "$CODE"
