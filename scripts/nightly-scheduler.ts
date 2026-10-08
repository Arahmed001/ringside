/**
 * The optional scheduler for a host with no cron: runs `npm run nightly` once a day at NIGHTLY_SCHEDULE='HH:MM' (UTC), as a child process beside the site.
 * Started by scripts/docker-entrypoint.sh only when NIGHTLY_SCHEDULE is set. No dependency; see lib/nightly-schedule.ts and docs/nightly.md.
 */
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { createScheduler, jitterMinutes } from "../lib/nightly-schedule";
import { nightlyEnv, parseSchedule, readStatus, statusPath } from "../lib/nightly-status";

const env = nightlyEnv();
const schedule = parseSchedule(env.NIGHTLY_SCHEDULE);
const log = (l: string) => console.log(l);
if (!schedule) {
  log(`[nightly-scheduler] NIGHTLY_SCHEDULE="${env.NIGHTLY_SCHEDULE ?? ""}" is not HH:MM (UTC, 24 hours): the scheduler is off. The site is not affected.`);
  process.exit(0);
}

let job: ChildProcess | undefined;
const file = statusPath();
const scheduler = createScheduler({
  schedule, jitterMin: jitterMinutes(env.NIGHTLY_JITTER_MIN), now: () => new Date(), random: Math.random, log,
  readStatus: () => readStatus(file),
  // the job is its own process (the update inside it is another): never the web server's. The job's own Node gets a small heap; the update gets NIGHTLY_NODE_OPTIONS.
  runJob: () => new Promise((resolve, reject) => {
    job = spawn(process.execPath, ["--import", "tsx", path.resolve(__dirname, "nightly.ts")], { stdio: "inherit", env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=256" } });
    job.on("error", reject);
    job.on("close", (code, signal) => { job = undefined; resolve(code ?? (signal ? 128 : null)); });
  }),
});
let stopping = false;
async function stop(sig: string) {
  if (stopping) return; stopping = true;
  log(`[nightly-scheduler] ${sig}: stopping${job ? " (asking the running job to stop first)" : ""}`);
  scheduler.stop();
  if (job) { job.kill("SIGTERM"); const j = job; await new Promise<void>((ok) => { const t = setTimeout(() => { j.kill("SIGKILL"); ok(); }, 20_000); j.on("close", () => { clearTimeout(t); ok(); }); }); }
  process.exit(0);
}
for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"] as const) process.on(sig, () => void stop(sig));
// handlers first, then the "on" line: anything that sees the line may signal us at once
scheduler.start();
