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

/** Whether a typed answer is the confirmation: exactly LOAD, nothing else counts. */
export const isConfirmation = (answer: string): boolean => answer.trim() === "LOAD";
