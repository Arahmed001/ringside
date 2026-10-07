/**
 * npm run nightly     the in-container nightly job: a verified backup, the daily update, an optional off-host copy, and a status file. See docs/nightly.md.
 *
 * Settings (all optional; .env.example): NIGHTLY_KEEP (backups kept, default 7), NIGHTLY_OFFSITE_CMD (+ NIGHTLY_OFFSITE_TIMEOUT_MIN), NIGHTLY_NODE_OPTIONS (the update's
 * Node options, default --max-old-space-size=768); the update itself reads BOXING_API_KEY, BOXING_API_STORAGE_CONFIRMED and DATABASE_PATH from the environment.
 * Exit code (PLAN.md section 224): 0 done (also when only the off-host copy failed: see the status file), 1 anything else (a failed backup, a missing key),
 * 2 the vendor is unreachable or refused, 3 a check refused the data, 75 another nightly job is running, 130 stopped by SIGINT, SIGTERM or SIGHUP.
 */
import { runNightly } from "../lib/nightly";
import { nightlyEnv } from "../lib/nightly-status";

const ac = new AbortController();
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(sig, () => { console.log(`[nightly] ${sig} received: stopping the update and recording it`); ac.abort(); });

runNightly({ env: process.env, settings: nightlyEnv(), signal: ac.signal }).then(
  (r) => process.exit(r.exitCode),
  (e) => { console.error(`[nightly] failed unexpectedly: ${e instanceof Error ? e.message : e}`); process.exit(1); },
);
