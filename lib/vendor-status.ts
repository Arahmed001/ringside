import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { looksLikePlaceholder, type KeyFileState } from "./vendor-fetch";

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
/** Which cache to report on: the one named, else the one a running fetch was started with (its command carries --cache-dir), else the default under the current folder. */
export function chooseCacheDir(explicit: string | undefined, running: RunningBackfill[], fallback: string): { dir: string; from: "named" | "running fetch" | "default" } {
  if (explicit) return { dir: explicit, from: "named" };
  for (const r of running) {
    const m = /--cache-dir[ =]("[^"]+"|'[^']+'|\S+)/.exec(r.command);
    if (m) return { dir: m[1].replace(/^["']|["']$/g, ""), from: "running fetch" };
  }
  return { dir: fallback, from: "default" };
}

export function keyState(key: string | undefined): { set: boolean; length: number; placeholder: boolean } {
  const k = key ?? "";
  return { set: k.length > 0, length: k.length, placeholder: k.length > 0 && (k.length < 30 || /\s|…|\.\.\./.test(k) || looksLikePlaceholder(k)) };
}

export interface CacheState { fighters: number; listPages: number; rankingPages: number; staleTemp: number; newest: Date | null; fightersLastHour: number; fightersLast6Hours: number; /** fighter answers newer than the `since` the count was asked for (the start of the fetch now running) */ fightersSince?: number }
/** The cache directory counted: fighter answers, fight-list pages, rankings pages, leftover temp files, and how many fighter answers arrived in the last hour and six hours. */
export function cacheState(dir: string, now = Date.now(), since?: number): CacheState {
  const s: CacheState = { fighters: 0, listPages: 0, rankingPages: 0, staleTemp: 0, newest: null, fightersLastHour: 0, fightersLast6Hours: 0, ...(since !== undefined ? { fightersSince: 0 } : {}) };
  let names: string[] = [];
  try { names = fs.readdirSync(dir); } catch { return s; }
  for (const f of names) {
    let m = 0;
    try { m = fs.statSync(path.join(dir, f)).mtimeMs; } catch { continue; }
    if (!s.newest || m > s.newest.getTime()) s.newest = new Date(m);
    if (f.endsWith(".tmp")) { s.staleTemp++; continue; }
    if (f.startsWith("v2-fighters-")) { s.fighters++; if (now - m <= 3_600_000) s.fightersLastHour++; if (now - m <= 6 * 3_600_000) s.fightersLast6Hours++; if (since !== undefined && m >= since) s.fightersSince = (s.fightersSince ?? 0) + 1; }
    else if (f.startsWith("v2-fights")) s.listPages++;
    else if (f.startsWith("v2-rankings")) s.rankingPages++;
  }
  return s;
}

export interface StatusInput {
  cacheDir: string; /** the background fetch's log (`vendor:fetch --background`), when there is one beside the cache */ log?: { path: string; tail: string[]; ageMinutes: number }; cache: CacheState; /** fighters in the fight list, when it could be read from the cache */ total: number | null;
  running: RunningBackfill[]; key: { set: boolean; length: number; placeholder: boolean }; /** the key file `npm run vendor:fetch` reads (~/.ringside-key), when the caller looked */ keyFile?: KeyFileState; storageConfirmed: string | undefined; databasePath: string | undefined; now?: Date;
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
  // a fetch started in the last six hours has no six-hour pace to speak of: its own work since it started is the pace (a fetch that has run four minutes is not at "119 an hour",
  // and the six-hour count would include an earlier run and the gap before this one). Too soon to tell, the plan's 400 an hour is assumed and the line says so.
  const started = Math.min(...i.running.map((r) => Date.parse(r.startedAt)).filter(Number.isFinite));
  const sinceH = Number.isFinite(started) ? Math.max(0, (i.now?.getTime() ?? Date.now()) - started) / 3_600_000 : Infinity;
  const recentRun = i.running.length > 0 && sinceH < 6;
  let basis = "";
  let perHour: number;
  if (recentRun) {
    if (sinceH >= 5 / 60 && (c.fightersSince ?? 0) >= 10) perHour = (c.fightersSince as number) / sinceH;
    else { perHour = 400; basis = ` (it started ${sinceH < 1 ? `${Math.max(1, Math.round(sinceH * 60))} minutes` : `${sinceH.toFixed(1)} hours`} ago: too soon to measure, the plan's 400 an hour assumed)`; }
  } else {
    // the six-hour average is steadier than the last hour (a short outage or a sleep makes one hour look like a crawl)
    perHour = c.fightersLast6Hours >= 300 ? c.fightersLast6Hours / 6 : c.fightersLastHour >= 50 ? c.fightersLastHour : 400;
  }
  const slowed = !recentRun && i.running.length > 0 && c.fightersLast6Hours >= 300 && c.fightersLastHour < 0.5 * (c.fightersLast6Hours / 6);
  if (left !== null) out.push(left ? `  ${fmt(left)} to fetch: about ${hours(left / perHour)} at ${Math.round(perHour)} an hour${basis}` : "  every fighter in the fight list is in the cache");
  if (slowed) out.push(`  SLOWED: ${c.fightersLastHour} fighters in the last hour against ${Math.round(c.fightersLast6Hours / 6)} an hour over six. Look at the fetch's own terminal for "network error" or "rate limit" lines: a network that dropped (or a laptop that slept) stalls it, and a fighter skipped for it is fetched again the next time the same command is run.`);
  const note = i.log && i.log.tail.length ? `  log ${i.log.path} (${i.log.ageMinutes < 1 ? "just now" : i.log.ageMinutes < 120 ? `${Math.round(i.log.ageMinutes)} min ago` : `${(i.log.ageMinutes / 60).toFixed(1)} hours ago`}), last line: ${i.log.tail[i.log.tail.length - 1].slice(0, 150)}` : null;
  out.push(i.running.length ? `fetch: RUNNING (${i.running.map((r) => `process ${r.pid} since ${r.startedAt.slice(0, 19).replace("T", " ")} UTC${r.command ? `: ${r.command}` : ""}`).join("; ")})` : "fetch: not running");
  if (note) out.push(note);
  const kf = i.keyFile, fileOk = !!kf && kf.exists && kf.private && !kf.placeholder && kf.length > 0;
  out.push(!i.key.set ? "key: NOT set in this terminal tab" : i.key.placeholder ? `key: set, but ${i.key.length} characters and it looks like a placeholder, not a real key (a real one is about 50)` : `key: set (${i.key.length} characters)`);
  if (kf) out.push(!kf.exists ? "key file: none (npm run vendor:fetch -- --setup saves one, in a real terminal tab)" : !kf.private ? "key file: exists but other users can read it (chmod 600 it)" : kf.placeholder ? `key file: exists, but ${kf.length} characters and it looks like a placeholder` : `key file: ready (${kf.length} characters, readable by you only): npm run vendor:fetch uses it from any tab`);
  out.push(`storage confirmed: ${i.storageConfirmed === "1" ? "yes" : i.storageConfirmed === "0" ? "NO: storing is switched off" : "not set (storing is on, with a warning, until BOXING_API_STORAGE_CONFIRMED=1)"}; database: ${i.databasePath ?? "not set (the demo path: set DATABASE_PATH to a NEW file before a load)"}`);
  out.push("", "next:");
  if (i.running.length) out.push(`  leave it running. Look at what it holds, without touching it:  npm run vendor:backfill -- --check --cached-only --drop-conflicts --allow-partial --explain-conflicts --show 3 --cache-dir ${i.cacheDir}`);
  else if (fileOk && (left === null || left > 0)) out.push("  start the paced fetch (one run only; the key is read from the key file). Detached, so closing the terminal does not end it:  npm run vendor:fetch -- --background   (in this tab instead:  npm run vendor:fetch)");
  else if ((!i.key.set || i.key.placeholder) && !fileOk) out.push("  save the key once, in a real terminal tab (hidden prompt, never in a chat box):  npm run vendor:fetch -- --setup");
  else if (left === null || left > 0) out.push(`  (re)start the fetch, one run only, paced:  npm run vendor:backfill -- --check --per-hour 400 --patience-min 240 --cache-dir ${i.cacheDir}`);
  else out.push(`  the cache is complete. See what the load would do, writing nothing:  npm run vendor:load -- --dry-run   (then, and only if you agree with it:  npm run vendor:load; docs/real-data-runbook.md section 2c)`);
  return out;
}
