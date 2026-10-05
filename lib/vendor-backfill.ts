import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { BackfillPlan } from "./providers/boxing-data-api";

/** Every fighter the Boxing Data API adapter creates has an external id starting with this (see fighterId in lib/providers/boxing-data-api.ts). */
export const FEED_FIGHTER_PREFIX = "bda-f-";

/**
 * What is already in a database, against what the vendor feed would put there. Loading real fighters next to the fictional demo league
 * (or another feed's fighters) would mix invented people in with real ones under the same rankings, so the backfill checks first.
 */
export function foreignFighters(db: DatabaseSync): { total: number; fromFeed: number; foreign: number; example: string | null } {
  const q = (sql: string) => (db.prepare(sql).get() as { c: number }).c;
  const total = q("SELECT COUNT(*) c FROM boxers");
  const fromFeed = q(`SELECT COUNT(*) c FROM boxers WHERE external_id LIKE '${FEED_FIGHTER_PREFIX}%'`);
  const example = (db.prepare(`SELECT name FROM boxers WHERE external_id NOT LIKE '${FEED_FIGHTER_PREFIX}%' LIMIT 1`).get() as { name: string } | undefined)?.name ?? null;
  return { total, fromFeed, foreign: total - fromFeed, example };
}

/**
 * Where a daily update starts: the date of the latest card that has already happened, less an overlap, so a result that arrived late or a
 * card the last run caught before it finished is picked up. Null when nothing has happened yet (there is nothing to update: backfill first).
 */
export function updateSince(db: DatabaseSync, today: string, overlapDays = 14): string | null {
  const row = db.prepare("SELECT MAX(date) d FROM events WHERE date <= ? AND COALESCE(status, '') != 'cancelled'").get(today) as { d: string | null };
  if (!row.d) return null;
  return new Date(Date.parse(row.d) - overlapDays * 86400000).toISOString().slice(0, 10);
}

/** What `--plan` prints: the size of the job and a rough time for it. */
export function describePlan(p: BackfillPlan, o: { gapMs: number; msPerRequest?: number; perHour?: number }): string[] {
  const paced = o.perHour && o.perHour > 0 ? 3_600_000 / o.perHour : 0; // an hourly limit sets the pace when it is slower than the spacing
  const ms = Math.max(o.gapMs + (o.msPerRequest ?? 250), paced); // the wait between requests plus a typical round trip
  const mins = Math.ceil((p.fighterRequests * ms) / 60000);
  const time = (requests: number) => { const m = Math.ceil((requests * ms) / 60000); return m >= 120 ? `${Math.round(m / 6) / 10} hours` : `${m} minute(s)`; };
  const lines = [
    p.allFighters ? `fights ${p.fights}, events ${p.events}, fighters ${p.fighters} chosen of ${p.allFighters} (the most recently active first)` : `fights ${p.fights}, events ${p.events}, fighters ${p.fighters}`,
    `fight list pages fetched to find out: ${p.requestsMade} request(s)`,
    `fighters already in the cache (free): ${p.fightersCached}`,
    paced > 0 ? `fighters still to fetch: ${p.fighterRequests} request(s), about ${time(p.fighterRequests)} at ${o.perHour} requests an hour`
      : `fighters still to fetch: ${p.fighterRequests} request(s), about ${mins} minute(s) at ${o.gapMs} ms between requests`,
    `total still to spend: about ${p.fighterRequests} request(s) (plus any retries)`,
  ];
  if (p.selection && (p.selection.length > 1 || p.allFighters)) {
    lines.push("", "taking only the most recently active fighters (--fighters N) would load, from the fight list alone:");
    for (const s of p.selection) lines.push(`  ${String(s.fighters).padStart(6)} fighters: ${String(s.fights).padStart(6)} fights; ${(s.share * 100).toFixed(0).padStart(3)}% of the fighters have every fight in the list loaded; ${String(s.closed).padStart(6)} sit in groups chosen whole; about ${time(s.fighters)} to fetch`);
    if (p.modes?.length) {
      lines.push("", "the other two ways to choose the same number (fighters asked for, from the fight list alone):");
      for (const m of p.modes) lines.push(`  ${String(m.n).padStart(6)}: --with-opponents asks for ${String(m.opponents).padStart(6)} fighters (each of the ${m.n} has every fight loaded); --whole-groups asks for ${String(m.groups).padStart(6)} (${m.groupsTaken} group(s) taken whole, ${m.groupsSkipped} too big for what was left, the biggest has ${m.largestGroup} fighters)`);
    }
    lines.push("  (A record is right only if every fight is loaded. 'every fight loaded' lets a fighter's opponents show a short record; 'groups chosen whole' is what --complete-only could keep at most, where nobody's record is short. A fighter's career in the list can also be shorter than the vendor's total, which only fetching shows: --check says.)");
  }
  return lines;
}

export interface LockInfo { pid: number; startedAt: string; command: string }
export interface LockOptions { dir?: string; pid?: number; alive?: (pid: number) => boolean; now?: () => Date; command?: string }
const processAlive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; } };

/**
 * One backfill at a time per API key on this machine. The plan's hourly allowance belongs to the key, not to a cache directory: a second run (an old one left
 * in another terminal, a --check begun while a load runs) shares the allowance, and the first real run spent hours refused because of exactly that. The lock
 * is a file named by a hash of the key (never the key itself), holding the process id; a lock whose process is gone is stale and is taken over.
 * Returns the path to remove when the run ends; throws, saying which process holds it, when another live run does.
 */
export function acquireBackfillLock(key: string, o: LockOptions = {}): string {
  const dir = o.dir ?? process.env.RINGSIDE_LOCK_DIR ?? os.tmpdir();
  const file = path.join(dir, `ringside-backfill-${crypto.createHash("sha256").update(key).digest("hex").slice(0, 12)}.lock`);
  const pid = o.pid ?? process.pid, alive = o.alive ?? processAlive;
  fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(file)) {
    let held: Partial<LockInfo> = {};
    try { held = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<LockInfo>; } catch { /* unreadable: treat as stale */ }
    if (typeof held.pid === "number" && held.pid !== pid && alive(held.pid))
      throw new Error(`Another backfill is already running with this API key (process ${held.pid}, started ${held.startedAt ?? "at an unknown time"}${held.command ? `: ${held.command}` : ""}). They share the plan's hourly allowance, so two runs make each other slow and a rate-limited one refuses most requests. Stop it first (Ctrl-C in its terminal; \`pgrep -fl vendor-backfill\` lists it). If it is not really running, delete ${file}.`);
  }
  const info: LockInfo = { pid, startedAt: (o.now?.() ?? new Date()).toISOString(), command: (o.command ?? "").slice(0, 200) };
  fs.writeFileSync(file, JSON.stringify(info));
  return file;
}

/** Gives the lock back, but only if it is still this process's. */
export function releaseBackfillLock(file: string, pid = process.pid): void {
  try { if ((JSON.parse(fs.readFileSync(file, "utf8")) as LockInfo).pid === pid) fs.rmSync(file, { force: true }); } catch { /* already gone */ }
}

/**
 * How many days a vendor total may trail its results before a surplus counts as a contradiction. The daily update reads fresh fighter records and allows
 * VENDOR_LAG_DAYS (default 7); a load reads a cache that may be days old, and on the first real cache the totals trailed by 9 to 11 days (24 conflicts vanished
 * at 14 days, 3 at 7), so a load allows VENDOR_LOAD_LAG_DAYS, else VENDOR_LAG_DAYS, else 14. A value that is not a whole number of days above 0 is ignored.
 */
export function lagDays(kind: "update" | "load", env: Record<string, string | undefined> = { VENDOR_LAG_DAYS: process.env.VENDOR_LAG_DAYS, VENDOR_LOAD_LAG_DAYS: process.env.VENDOR_LOAD_LAG_DAYS }): number {
  const ok = (x: string | undefined) => { const n = Number(x); return x !== undefined && x !== "" && Number.isInteger(n) && n > 0 ? n : undefined; };
  return kind === "update" ? ok(env.VENDOR_LAG_DAYS) ?? 7 : ok(env.VENDOR_LOAD_LAG_DAYS) ?? ok(env.VENDOR_LAG_DAYS) ?? 14;
}
