/**
 * A full-size dress rehearsal of the real-data load, against a stand-in vendor on this machine: nothing is bought, nothing leaves the machine.
 *
 *   npm run vendor:rehearse                         19,000 fighters, 160,000 fights, 35 years: the size of a full history
 *   npm run vendor:rehearse -- --fighters 2000 --fights 12000      a smaller one (a few minutes less)
 *
 * Options: --years 35  --offset-limit 10000  --beyond reject|silent (what the stand-in does past the page limit)  --seed 7  --keep (keep the files)
 * It runs the real `npm run vendor:backfill` four ways and reports time, peak memory, requests and disk for each:
 *   1. --plan        what the list costs;   2. --check   fetch everything, validate, reconcile (database untouched)
 *   3. the load      into a new database;   4. --update  the daily job (a day later, one fight changed)
 * and then rehearses a crash: a fresh fetch is killed part way and run again, and the second run must make only the requests the first one did not finish.
 * Every number it prints is measured on this machine, with the stand-in answering instantly: a real vendor adds its own delay per request
 * (--gap-ms 300 by default, so 19,000 fighters is about an hour and a half of waiting).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { makeWorld, serveMockVendor } from "../lib/vendor-mock";

const argv = process.argv.slice(2);
const arg = (k: string, d: string) => { const i = argv.indexOf(`--${k}`); return i > -1 ? argv[i + 1] : d; };
const N = { fighters: Number(arg("fighters", "19000")), fights: Number(arg("fights", "160000")), years: Number(arg("years", "35")), seed: Number(arg("seed", "7")) };
const LIMIT = Number(arg("offset-limit", "10000")), BEYOND = arg("beyond", "reject") as "reject" | "silent";
const KEY = "rehearsal-key-0123456789abcdef0123456789abcdef";
const TODAY = "2026-10-03";

const mb = (b: number) => `${Math.round(b / 1048576)} MB`;
const secs = (ms: number) => (ms < 90_000 ? `${(ms / 1000).toFixed(1)} s` : `${(ms / 60000).toFixed(1)} min`);
const du = (p: string): number => {
  if (!fs.existsSync(p)) return 0;
  const st = fs.statSync(p);
  return st.isDirectory() ? fs.readdirSync(p).reduce((n, f) => n + du(path.join(p, f)), 0) : st.size;
};
const rssKb = (pid: number) => { try { return Number(execFileSync("ps", ["-o", "rss=", "-p", String(pid)], { encoding: "utf8" }).trim()) || 0; } catch { return 0; } };

interface Run { code: number | null; ms: number; peakRss: number; out: string }
function run(args: string[], env: Record<string, string>, onSpawn?: (c: ChildProcess) => void): Promise<Run> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const c = spawn(process.execPath, ["--import", "tsx", "scripts/vendor-backfill.ts", "--gap-ms", "0", ...args], { cwd: process.cwd(), env: { ...process.env, RINGSIDE_NO_SEED: "1", BOXING_API_STORAGE_CONFIRMED: "1", RINGSIDE_NOW: TODAY, BOXING_API_KEY: KEY, ...env } });
    let out = "", peak = 0;
    const poll = setInterval(() => { if (c.pid) peak = Math.max(peak, rssKb(c.pid) * 1024); }, 400);
    c.stdout.on("data", (d) => (out += d)); c.stderr.on("data", (d) => (out += d));
    onSpawn?.(c);
    c.on("close", (code) => { clearInterval(poll); resolve({ code, ms: Date.now() - t0, peakRss: peak, out }); });
  });
}
const line = (s: string, re: RegExp) => s.split("\n").filter((l) => re.test(l)).join(" | ");

async function main() {
  console.log(`rehearsal: ${N.fighters} fighters, ${N.fights} fights over ${N.years} years; page limit ${LIMIT}, past it the vendor will ${BEYOND === "reject" ? "refuse" : "return empty pages"}`);
  const t0 = Date.now();
  const world = makeWorld({ ...N, today: TODAY, upcoming: 12 });
  console.log(`  stand-in vendor built in ${secs(Date.now() - t0)} (${world.fights.length} fights, ${world.fighters.size} fighters)`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rehearse-"));
  const cache = path.join(dir, "cache"), dbFile = path.join(dir, "real.db");
  const vendor = await serveMockVendor(world, { key: KEY, offsetLimit: LIMIT, beyond: BEYOND });
  const base = { BOXING_API_URL: vendor.url };
  const results: { step: string; ms: number; rss: number; requests: number; disk: string; note: string }[] = [];
  const checks: [string, boolean, string][] = [];
  const step = async (name: string, args: string[], env: Record<string, string> = {}, disk = () => "") => {
    const r0 = vendor.stats.requests;
    const r = await run([...args, "--offset-limit", String(LIMIT)], { ...base, ...env });
    const row = { step: name, ms: r.ms, rss: r.peakRss, requests: vendor.stats.requests - r0, disk: disk(), note: r.code === 0 ? "" : `exit ${r.code}` };
    results.push(row);
    console.log(`  ${name.padEnd(28)} ${secs(r.ms).padStart(9)}  peak ${mb(r.peakRss).padStart(7)}  ${String(row.requests).padStart(6)} requests  ${row.disk}${row.note ? `  ** ${row.note}` : ""}`);
    return r;
  };

  try {
    const plan = await step("1. --plan", ["--plan"]);
    checks.push(["--plan reads the whole list", plan.code === 0 && new RegExp(`fights ${world.fights.length},`).test(plan.out), line(plan.out, /^fights /)]);

    const check = await step("2. --check (fetch + validate)", ["--check", "--cache-dir", cache], {}, () => `cache ${mb(du(cache))}`);
    checks.push(["--check passes the record gate", check.code === 0, line(check.out, /^records:|a load would be refused/)]);
    checks.push(["no date window was too big", !/windowTooBig/.test(check.out), line(check.out, /windowTooBig/) || "none cut"]);

    const load = await step("3. load into a new database", ["--cache-dir", cache], { DATABASE_PATH: dbFile }, () => `database ${mb(du(dbFile) + du(`${dbFile}-wal`))}`);
    const db = new DatabaseSync(dbFile, { readOnly: true });
    const n = (sql: string) => (db.prepare(sql).get() as { c: number }).c;
    const bouts = n("SELECT COUNT(*) c FROM bouts"), boxers = n("SELECT COUNT(*) c FROM boxers");
    checks.push(["load: every fight is in the database", load.code === 0 && bouts === world.fights.length, `${bouts} of ${world.fights.length}`]);
    checks.push(["load: every fighter with a fight is in", boxers === new Set(world.fights.flatMap((f) => [f.a, f.b])).size, `${boxers} fighters`]);
    checks.push(["load made no new requests (all cached)", results[2].requests === 0, `${results[2].requests}`]);
    db.close();

    // a day later: one coming fight happens, and the daily job picks it up
    const coming = world.fights.find((f) => f.status === "NOT_STARTED");
    if (coming) { coming.status = "FINISHED"; coming.winner = "a"; coming.outcome = "UD"; coming.date = TODAY; const c = (id: string) => world.careers.get(id) ?? world.careers.set(id, { wins: 0, losses: 0, draws: 0 }).get(id)!; c(coming.a).wins++; c(coming.b).losses++; }
    const upd = await step("4. --update (the daily job)", ["--update", "--cache-dir", cache], { DATABASE_PATH: dbFile }, () => `database ${mb(du(dbFile) + du(`${dbFile}-wal`))}`);
    checks.push(["update succeeds", upd.code === 0, line(upd.out, /^records:|after the update|updating from/)]);
    checks.push(["update costs a few hundred requests, not a reload", results[3].requests < 3000, `${results[3].requests} requests`]);

    // a crash part way through the fetch, then run again: only the unfinished requests should be made
    const cache2 = path.join(dir, "cache-crash");
    const total = results[1].requests;
    const before = vendor.stats.requests;
    const killAt = Math.floor(total * 0.45);
    const killed = await run(["--check", "--cache-dir", cache2, "--offset-limit", String(LIMIT)], base, (c) => {
      const t = setInterval(() => { if (vendor.stats.requests - before >= killAt) { clearInterval(t); c.kill("SIGKILL"); } }, 20);
    });
    const firstAsked = vendor.stats.requests - before;
    const cachedFiles = fs.existsSync(cache2) ? fs.readdirSync(cache2).length : 0;
    const r2 = await run(["--check", "--cache-dir", cache2, "--offset-limit", String(LIMIT)], base);
    const secondAsked = vendor.stats.requests - before - firstAsked;
    console.log(`  crash rehearsal: killed after ~${firstAsked} requests (${cachedFiles} answers on disk, exit ${killed.code ?? "signal"}); the second run made ${secondAsked} requests and exited ${r2.code} in ${secs(r2.ms)}`);
    checks.push(["crash: the second run finishes", r2.code === 0, line(r2.out, /^records:/)]);
    checks.push(["crash: the second run makes only the unfinished requests", secondAsked <= total - cachedFiles + 5, `${secondAsked} asked, ${total - cachedFiles} unfinished (${total} in all)`]);
    const files = fs.readdirSync(cache2);
    const corrupt = files.filter((f) => { try { JSON.parse(fs.readFileSync(path.join(cache2, f), "utf8")); return false; } catch { return true; } });
    checks.push(["crash: every answer on disk after the kill is whole", corrupt.length === 0, `${files.length} files, ${corrupt.length} unreadable`]);
  } finally {
    await vendor.close();
  }

  console.log("\nchecks");
  for (const [name, ok, detail] of checks) console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? `: ${detail}` : ""}`);
  console.log(`\nthe vendor was asked ${vendor.stats.requests} times: ${JSON.stringify(vendor.stats.byPath)}; ${vendor.stats.pastLimit} requests went past the page limit`);
  if (!argv.includes("--keep")) fs.rmSync(dir, { recursive: true, force: true }); else console.log(`files kept in ${dir}`);
  process.exitCode = checks.every(([, ok]) => ok) ? 0 : 1;
}
main().catch((e) => { console.error(e instanceof Error ? e.stack : e); process.exit(1); });
