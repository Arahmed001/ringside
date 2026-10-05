import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * `npm run vendor:status`: where a long vendor fetch stands, read from the files on this machine only (no request, no key sent anywhere). It exists because the
 * same questions kept costing round trips: is a fetch running, is the key set in THIS terminal tab, how much of the league is in the cache, how long is left.
 */
export interface RunningBackfill { pid: number; startedAt: string; command: string }

/** The backfills holding a lock in `dir` (the lock is a file named by a hash of the key) whose process is still alive. */
export function runningBackfills(dir = process.env.RINGSIDE_LOCK_DIR ?? os.tmpdir(), alive: (pid: number) => boolean = processAlive): RunningBackfill[] {
  const out: RunningBackfill[] = [];
  let names: string[] = [];
  try { names = fs.readdirSync(dir).filter((f) => /^ringside-backfill-[0-9a-f]+\.lock$/.test(f)); } catch { return out; }
  for (const f of names) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as Partial<RunningBackfill>;
      if (typeof j.pid === "number" && alive(j.pid)) out.push({ pid: j.pid, startedAt: String(j.startedAt ?? ""), command: String(j.command ?? "") });
    } catch { /* unreadable: stale */ }
  }
  return out;
}
function processAlive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; } }

/** What this terminal's BOXING_API_KEY looks like, never the key itself: set or not, how long, and whether it is plainly a placeholder. */
export function keyState(key: string | undefined): { set: boolean; length: number; placeholder: boolean } {
  const k = key ?? "";
  return { set: k.length > 0, length: k.length, placeholder: k.length > 0 && (k.length < 30 || /\s|…|\.\.\.|your|paste|here|placeholder/i.test(k)) };
}

export interface CacheState { fighters: number; listPages: number; rankingPages: number; staleTemp: number; newest: Date | null; fightersLastHour: number; fightersLast6Hours: number }
/** The cache directory counted: fighter answers, fight-list pages, rankings pages, leftover temp files, and how many fighter answers arrived in the last hour and six hours. */
export function cacheState(dir: string, now = Date.now()): CacheState {
  const s: CacheState = { fighters: 0, listPages: 0, rankingPages: 0, staleTemp: 0, newest: null, fightersLastHour: 0, fightersLast6Hours: 0 };
  let names: string[] = [];
  try { names = fs.readdirSync(dir); } catch { return s; }
  for (const f of names) {
    let m = 0;
    try { m = fs.statSync(path.join(dir, f)).mtimeMs; } catch { continue; }
    if (!s.newest || m > s.newest.getTime()) s.newest = new Date(m);
    if (f.endsWith(".tmp")) { s.staleTemp++; continue; }
    if (f.startsWith("v2-fighters-")) { s.fighters++; if (now - m <= 3_600_000) s.fightersLastHour++; if (now - m <= 6 * 3_600_000) s.fightersLast6Hours++; }
    else if (f.startsWith("v2-fights")) s.listPages++;
    else if (f.startsWith("v2-rankings")) s.rankingPages++;
  }
  return s;
}

export interface StatusInput {
  cacheDir: string; cache: CacheState; /** fighters in the fight list, when it could be read from the cache */ total: number | null;
  running: RunningBackfill[]; key: { set: boolean; length: number; placeholder: boolean }; storageConfirmed: string | undefined; databasePath: string | undefined; now?: Date;
}
const fmt = (n: number) => n.toLocaleString("en-US");
const hours = (h: number) => (h < 1 ? `${Math.max(1, Math.round(h * 60))} minutes` : h < 48 ? `${h.toFixed(1)} hours` : `${(h / 24).toFixed(1)} days`);

/** The lines to print: the state, and the next command that fits it. */
export function describeStatus(i: StatusInput): string[] {
  const c = i.cache, out: string[] = [];
  out.push(`cache: ${i.cacheDir}`);
  out.push(`  ${fmt(c.fighters)} fighters${i.total ? ` of ${fmt(i.total)} (${((100 * c.fighters) / i.total).toFixed(1)}%)` : ""}, ${fmt(c.listPages)} fight-list pages, ${c.rankingPages} rankings pages${c.staleTemp ? `, ${c.staleTemp} stale temp file(s) (harmless: a kill left them)` : ""}`);
  if (c.newest) out.push(`  newest answer ${c.newest.toISOString().replace("T", " ").slice(0, 19)} UTC; ${c.fightersLastHour} fighters in the last hour, ${c.fightersLast6Hours} in the last six`);
  const left = i.total ? Math.max(0, i.total - c.fighters) : null;
  const perHour = c.fightersLastHour >= 50 ? c.fightersLastHour : c.fightersLast6Hours >= 50 ? c.fightersLast6Hours / 6 : 400;
  if (left !== null) out.push(left ? `  ${fmt(left)} to fetch: about ${hours(left / perHour)} at ${Math.round(perHour)} an hour` : "  every fighter in the fight list is in the cache");
  out.push(i.running.length ? `fetch: RUNNING (${i.running.map((r) => `process ${r.pid} since ${r.startedAt.slice(0, 19).replace("T", " ")} UTC${r.command ? `: ${r.command}` : ""}`).join("; ")})` : "fetch: not running");
  out.push(!i.key.set ? "key: NOT set in this terminal tab" : i.key.placeholder ? `key: set, but ${i.key.length} characters and it looks like a placeholder, not a real key (a real one is about 50)` : `key: set (${i.key.length} characters)`);
  out.push(`storage confirmed: ${i.storageConfirmed === "1" ? "yes" : i.storageConfirmed === "0" ? "NO: storing is switched off" : "not set (storing is on, with a warning, until BOXING_API_STORAGE_CONFIRMED=1)"}; database: ${i.databasePath ?? "not set (the demo path: set DATABASE_PATH to a NEW file before a load)"}`);
  out.push("", "next:");
  if (i.running.length) out.push(`  leave it running. Look at what it holds, without touching it:  npm run vendor:backfill -- --check --cached-only --drop-conflicts --allow-partial --explain-conflicts --show 3 --cache-dir ${i.cacheDir}`);
  else if (!i.key.set || i.key.placeholder) out.push("  set the real key in THIS tab (hidden prompt, never in a chat):  read -s \"BOXING_API_KEY?RapidAPI key: \"; export BOXING_API_KEY");
  else if (left === null || left > 0) out.push(`  (re)start the fetch, one run only, paced:  npm run vendor:backfill -- --check --per-hour 400 --patience-min 240 --cache-dir ${i.cacheDir}`);
  else out.push(`  the cache is complete: run the check, then follow docs/real-data-runbook.md section 2c:  npm run vendor:backfill -- --check --drop-conflicts --allow-partial --explain-conflicts --cache-dir ${i.cacheDir}`);
  return out;
}
