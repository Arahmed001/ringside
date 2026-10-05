/**
 * A full-size dress rehearsal of the real-data load, against a stand-in vendor on this machine: nothing is bought, nothing leaves the machine.
 *
 *   npm run vendor:rehearse                         19,000 fighters, 160,000 fights, 35 years: the size of a full history
 *   npm run vendor:rehearse -- --fighters 2000 --fights 12000      a smaller one (a few minutes less)
 *
 * With --realistic it also rehearses the load-day decision on a league that does NOT add up, as the first real fetch did (a few percent of the fighters (--prior) have a
 * career the fight list does not reach, a few fights are listed twice, a few have no winner and the vendor does not count them): --check refuses, --cached-only
 * answers from the cache with no request, --complete-only loads only what is right, and --allow-partial is still refused while a conflict stands.
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
import { degradeWorld, makeWorld, serveMockVendor } from "../lib/vendor-mock";

const argv = process.argv.slice(2);
const arg = (k: string, d: string) => { const i = argv.indexOf(`--${k}`); return i > -1 ? argv[i + 1] : d; };
const N = { fighters: Number(arg("fighters", "19000")), fights: Number(arg("fights", "160000")), years: Number(arg("years", "35")), seed: Number(arg("seed", "7")) };
const PRIOR = Number(arg("prior", "0.04")); // share of fighters whose earlier career the fight list does not reach (--realistic); on the real first fetch nearly all were, and the core came out at 42 of 5,000
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


/** The load-day paths on leagues that do not add up (see the header): each step is a real `vendor:backfill` run, the vendor is a local stand-in with its own key. */
async function realistic(checks: [string, boolean, string][]) {
  const unrecorded = Math.round(N.fights * 0.003), duplicates = Math.round(N.fights * 0.002);
  const scenario = async (title: string, opts: Parameters<typeof degradeWorld>[1], body: (go: (name: string, args: string[], env?: Record<string, string>) => Promise<Run & { asked: number }>, cache: string, dir: string) => Promise<void>) => {
    const world = degradeWorld(makeWorld({ ...N, today: TODAY, upcoming: 0 }), opts);
    console.log(`\n${title}: ${world.fights.length} fights (${opts.priorShare ? `${Math.round(opts.priorShare * 100)}% of fighters with an earlier career, ` : ""}${opts.unrecorded ?? 0} the vendor does not count, ${opts.duplicates ?? 0} listed twice)`);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rehearse-real-"));
    const vendor = await serveMockVendor(world, { key: KEY, offsetLimit: LIMIT, beyond: BEYOND });
    const go = async (name: string, args: string[], env: Record<string, string> = {}) => {
      const r0 = vendor.stats.requests;
      const r = await run([...args, "--offset-limit", String(LIMIT)], { BOXING_API_URL: vendor.url, ...env });
      const asked = vendor.stats.requests - r0;
      console.log(`  ${name.padEnd(46)} ${secs(r.ms).padStart(9)}  peak ${mb(r.peakRss).padStart(7)}  ${String(asked).padStart(6)} requests  exit ${r.code}`);
      return { ...r, asked };
    };
    try { await body(go, path.join(dir, "cache"), dir); } finally { await vendor.close(); if (!argv.includes("--keep")) fs.rmSync(dir, { recursive: true, force: true }); }
  };
  const boxersIn = (file: string) => { if (!fs.existsSync(file)) return 0; const x = new DatabaseSync(file, { readOnly: true }); try { return (x.prepare("SELECT COUNT(*) c FROM boxers").get() as { c: number }).c; } catch { return 0; } finally { x.close(); } };
  const noKey = { BOXING_API_KEY: "" };

  // A: what the first real fetch looked like: earlier careers missing, fights listed twice, results the vendor does not count
  await scenario("A. faults", { seed: N.seed, priorShare: PRIOR, unrecorded, duplicates }, async (go, cache, dir) => {
    const a = await go("a. --check --explain-conflicts", ["--check", "--explain-conflicts", "--show", "2", "--cache-dir", cache]);
    checks.push(["A: --check refuses while records do not add up", a.code === 1 && /a load would be refused/.test(a.out), line(a.out, /^records:/)]);
    checks.push(["A: the draw guess is demoted, not left as a conflict", /drawDemoted\s+[1-9]/.test(a.out) && !/more draws loaded than the vendor counts/.test(a.out), line(a.out, /drawDemoted/)]);
    checks.push(["A: fights listed twice are named as repeats", /the same two fighters twice within 30 days/.test(a.out), line(a.out, /^why the/)]);
    const b = await go("b. --check --cached-only --explain-conflicts", ["--check", "--cached-only", "--explain-conflicts", "--cache-dir", cache], noKey);
    checks.push(["A: --cached-only asks for nothing and says the same", b.asked === 0 && /^why the/m.test(b.out), `${b.asked} requests`]);
    const c = await go("c. --check --cached-only --complete-only", ["--check", "--cached-only", "--complete-only", "--cache-dir", cache], noKey);
    // a connected group is kept only if every fighter in it is right, so on a league with one big group a single short fighter sinks it (the empty-core error); a sparse league keeps its clean groups, and then every record in the core must add up
    const core = /core \(--complete-only\): (\d+) of (\d+) fighters/.exec(c.out);
    checks.push(["A: --complete-only keeps only groups that are right, or says there are none", (c.code !== 0 && /not one fighter's loaded fights add up/.test(c.out)) || (c.code === 0 && !!core && /records: (\d+) of \1 fighters \(100\.0%\)/.test(c.out)), core ? `core ${core[1]} of ${core[2]}` : `exit ${c.code}: empty core`]);
    const dbFile = path.join(dir, "partial.db");
    const e = await go("e. load --allow-partial (conflicts stand)", ["--allow-partial", "--cache-dir", cache], { DATABASE_PATH: dbFile });
    checks.push(["A: --allow-partial does not wave a conflict through", e.code !== 0 && /MORE wins, losses or draws/.test(e.out) && boxersIn(dbFile) === 0, `exit ${e.code}, ${boxersIn(dbFile)} fighters written`]);
  });

  // B: only results the vendor has not posted: the importer's draw guess used to turn each into a conflict; now the records add up and the gate passes
  await scenario("B. unposted results only", { seed: N.seed + 1, unrecorded }, async (go, cache, dir) => {
    const a = await go("a. --check", ["--check", "--cache-dir", cache]);
    checks.push(["B: unposted results no longer stop the load", a.code === 0 && Number(/\((\d+\.\d)%\) have loaded fights/.exec(a.out)?.[1] ?? 0) >= 99.5 && /drawDemoted\s+[1-9]/.test(a.out), line(a.out, /^records:|drawDemoted/)]); // not always 100%: a fighter with a real draw AND an unposted fight cannot be told apart, so the wrong one of his two can be kept (a short record, never a conflict)
    const dbFile = path.join(dir, "real.db");
    const l = await go("b. load", ["--cache-dir", cache], { DATABASE_PATH: dbFile });
    checks.push(["B: the load goes through, with no new request", l.code === 0 && l.asked === 0 && boxersIn(dbFile) > 0, `exit ${l.code}, ${boxersIn(dbFile)} fighters, ${l.asked} requests`]);
  });
}

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
    // an answer is written to `<name>.<pid>.tmp` and renamed when whole, so a kill mid-write leaves a stale .tmp (never read as an answer) and never a half answer under its real name
    const unreadable = files.filter((f) => { try { JSON.parse(fs.readFileSync(path.join(cache2, f), "utf8")); return false; } catch { return true; } });
    const corrupt = unreadable.filter((f) => !f.endsWith(".tmp")), stale = unreadable.filter((f) => f.endsWith(".tmp"));
    checks.push(["crash: every answer on disk after the kill is whole", corrupt.length === 0, `${files.length} files, ${corrupt.length} unreadable${corrupt.length ? `: ${corrupt.slice(0, 3).join(", ")}` : ""}${stale.length ? `; ${stale.length} stale temp file(s) from the kill, never read as an answer` : ""}`]);
  } finally {
    await vendor.close();
  }

  if (argv.includes("--realistic")) await realistic(checks);

  console.log("\nchecks");
  for (const [name, ok, detail] of checks) console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? `: ${detail}` : ""}`);
  console.log(`\nthe vendor was asked ${vendor.stats.requests} times: ${JSON.stringify(vendor.stats.byPath)}; ${vendor.stats.pastLimit} requests went past the page limit`);
  if (!argv.includes("--keep")) fs.rmSync(dir, { recursive: true, force: true }); else console.log(`files kept in ${dir}`);
  process.exitCode = checks.every(([, ok]) => ok) ? 0 : 1;
}
main().catch((e) => { console.error(e instanceof Error ? e.stack : e); process.exit(1); });
