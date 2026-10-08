import { describeAudit, failed, type Check } from "./vendor-audit";
import os from "node:os";
import path from "node:path";

/**
 * `npm run vendor:load` (round 88): the load itself, guided. The load is the one step of the real-data plan that writes the league the site will show, and it has been
 * described as a command with environment variables (a new database file, storage confirmed, the flags that follow from the check). This puts the decisions where they
 * can be seen: what it will do, from which cache, into which file, with which flags, and a typed confirmation before anything is written.
 */
export const DEFAULT_DATABASE = path.join(os.homedir(), "ringside-real/real.db");

export interface LoadPlan {
  database: string; droppedFile: string; disputedFile: string;
  /** the arguments for the check that is shown first (never writes) and for the load (writes) */
  checkArgs: string[]; loadArgs: string[];
  /** why the load must not start, when it must not */
  refusal: string | null;
}

/**
 * What to run. By default the load does what the real cache showed it needs: fighters whose records contradict the feed are KEPT and MARKED (`--keep-disputed`: their pages
 * show the vendor's total and say it and its own fight list disagree, and they are listed in `disputed.csv`), partial careers are loaded with the vendor's total (`--allow-partial`),
 * and the report explains the conflicts. `--drop-conflicts` (leave them out), `--complete-only` and `--allow-conflicts` replace the first (other answers to the same question). The vendor's written confirmation that its data may be stored is something only the owner can say: it must be in the
 * environment (BOXING_API_STORAGE_CONFIRMED=1) or given as `--storage-confirmed`; this never sets it unasked.
 */
export function loadPlan(user: string[], env: Record<string, string | undefined>, cacheDir: string | undefined): LoadPlan {
  const has = (f: string) => user.includes(f);
  const database = path.resolve(env.DATABASE_PATH || DEFAULT_DATABASE);
  const droppedFile = path.join(path.dirname(database), "dropped.csv"), disputedFile = path.join(path.dirname(database), "disputed.csv");
  const passthrough = user.filter((a) => !["--storage-confirmed", "--yes", "--dry-run", "--fetch-missing"].includes(a));
  const policy: string[] = [];
  if (!has("--complete-only") && !has("--allow-conflicts") && !has("--drop-conflicts") && !has("--keep-disputed")) policy.push("--keep-disputed");
  if (!has("--allow-partial") && !has("--complete-only")) policy.push("--allow-partial");
  const keeping = policy.includes("--keep-disputed") || has("--keep-disputed");
  const common = [...policy, ...(keeping ? (has("--disputed-file") ? [] : ["--disputed-file", disputedFile]) : has("--dropped-file") ? [] : ["--dropped-file", droppedFile]), ...(has("--cache-dir") || !cacheDir ? [] : ["--cache-dir", cacheDir]), ...(has("--per-hour") ? [] : ["--per-hour", "400"]), ...(has("--patience-min") ? [] : ["--patience-min", "240"]), ...passthrough];
  const confirmed = env.BOXING_API_STORAGE_CONFIRMED === "1" || has("--storage-confirmed");
  return {
    database, droppedFile, disputedFile,
    checkArgs: ["--check", "--explain-conflicts", "--show", "3", ...common],
    loadArgs: common,
    refusal: env.BOXING_API_STORAGE_CONFIRMED === "0" ? "BOXING_API_STORAGE_CONFIRMED=0 switches storing off. Nothing is loaded."
      : confirmed ? null
      : "The vendor's written confirmation that its data may be stored has not been stated. Say it, as the owner, when it is true: BOXING_API_STORAGE_CONFIRMED=1 in the environment, or add --storage-confirmed to this command (docs/real-data-runbook.md, section 0).",
  };
}

/** The exit code of `vendor:load` when the league was loaded but the audit of it found a failing check (a failed load keeps the code of the load itself). */
export const AUDIT_FAILED_EXIT = 4;

/** The three files of a SQLite database (the database and its write-ahead log and shared-memory file): all must go to start clean. */
export const databaseFiles = (database: string): string[] => [database, `${database}-wal`, `${database}-shm`];

/**
 * What to say when the load's target already exists. A re-load updates the fighters, fights and events in it in place, but the importer never removes a fight an earlier load took
 * and the importer now leaves out (cancelled cards, Olympic and games bouts) or a country spelled the old way, so a file made by an older version of the importer comes out of a re-load
 * with those still in it, and the audit then fails. The first full load of a league is the time to start clean; the cache is the source and costs nothing to read again.
 */
export function existingWarning(database: string): string[] {
  return [
    "",
    "  WARNING: this database already exists. A re-load updates its fighters, fights and events in place, but it never removes a fight an earlier load took that the importer now",
    "  leaves out (a card of cancelled fights, an Olympic or games bout), and an old spelling of a country stays. If this file was made by an older version of this importer, stop now:",
    `  delete ${databaseFiles(database).join(" ")}`,
    "  (the cache is the source and costs nothing) and run this command again for a clean load.",
  ];
}

/** The line that asks for the confirmation: it says plainly when the file is going to be updated in place rather than made. */
export const confirmPrompt = (database: string, exists: boolean): string =>
  `\nType LOAD to ${exists ? `UPDATE ${database} IN PLACE (see the warning above)` : `write this league into ${database}`} (anything else cancels): `;


/**
 * Step 3 of the guided load: what the audit (`lib/vendor-audit.ts`) found in the database just written, as the lines to print and the exit code. The load itself worked either way
 * (nothing is undone); a FAIL means something in what was loaded is wrong, which is why it gets its own exit code and says how to load again.
 */
export function auditStep(checks: Check[], database: string): { lines: string[]; code: number } {
  const bad = failed(checks);
  const lines = ["", "step 3: the audit of what was loaded (a second; it reads the database only)", "", ...describeAudit(checks), ""];
  if (bad.length) {
    lines.push(`The load worked, but the audit found ${bad.length} failing check${bad.length === 1 ? "" : "s"} (the FAIL lines above): something in what was loaded is wrong. Nothing was undone. Send back the whole output; to load again from the cache, delete ${database} and its -wal and -shm files and run this command again.`);
    return { lines, code: AUDIT_FAILED_EXIT };
  }
  lines.push(`Loaded into ${database}. The audit passed. Next: docs/real-data-runbook.md section 4 (check the result by hand), look at it with  npm run vendor:site -- --start --build , then the daily update (section 5).`);
  return { lines, code: 0 };
}

/** Whether a typed answer is the confirmation: exactly LOAD, nothing else counts. */
export const isConfirmation = (answer: string): boolean => answer.trim() === "LOAD";
