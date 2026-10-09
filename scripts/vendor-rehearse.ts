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
 * With --gate it also rehearses the vendor update gate at this size (docs/vendor-gate-plan.md): the same night is run on three copies of the database, plain, with
 * VENDOR_GATE=observe and with VENDOR_GATE=hold (so the first night of holding), and then everything held is accepted with the baseline action. It must come out that observing
 * changes nothing, holding shows none of what it holds, and accepting everything leaves exactly what the plain update left; time and memory are reported for each.
 * Every number it prints is measured on this machine, with the stand-in answering instantly: a real vendor adds its own delay per request
 * (--gap-ms 300 by default, so 19,000 fighters is about an hour and a half of waiting).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";
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
  const scenario = async (title: string, opts: Parameters<typeof degradeWorld>[1], body: (go: (name: string, args: string[], env?: Record<string, string>) => Promise<Run & { asked: number }>, cache: string, dir: string, world: ReturnType<typeof makeWorld>) => Promise<void>) => {
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
    try { await body(go, path.join(dir, "cache"), dir, world); } finally { await vendor.close(); if (!argv.includes("--keep")) fs.rmSync(dir, { recursive: true, force: true }); }
  };
  const boxersIn = (file: string) => { if (!fs.existsSync(file)) return 0; const x = new DatabaseSync(file, { readOnly: true }); try { return (x.prepare("SELECT COUNT(*) c FROM boxers").get() as { c: number }).c; } catch { return 0; } finally { x.close(); } };
  const noKey = { BOXING_API_KEY: "" };

  // A: what the first real fetch looked like: earlier careers missing, fights listed twice, results the vendor does not count
  const wrongTotals = Math.max(3, Math.round(N.fights * 0.0015));
  await scenario("A. faults", { seed: N.seed, priorShare: PRIOR, unrecorded, duplicates, disagree: Math.round(duplicates / 3), wrongTotals }, async (go, cache, dir, world) => {
    const a = await go("a. --check --explain-conflicts", ["--check", "--explain-conflicts", "--show", "2", "--cache-dir", cache]);
    checks.push(["A: --check refuses while records do not add up", a.code === 1 && /a load would be refused/.test(a.out), line(a.out, /^records:/)]);
    checks.push(["A: the draw guess is demoted, not left as a conflict", /drawDemoted\s+[1-9]/.test(a.out) && !/more draws loaded than the vendor counts/.test(a.out), line(a.out, /drawDemoted/)]);
    checks.push(["A: fights listed twice are merged into one, and the disagreeing ones left without a result", /duplicateFightsMerged\s+[1-9]/.test(a.out) && /duplicateFightsDisagree\s+[1-9]/.test(a.out) && !/the same two fighters twice within 30 days/.test(a.out), line(a.out, /duplicateFights/)]);
    checks.push(["A: what is left is the vendor's wrong totals, named as such", /more wins loaded than the vendor counts/.test(a.out) && /^why the (\d+) conflict/m.test(a.out), line(a.out, /^why the/)]);
    const b = await go("b. --check --cached-only --explain-conflicts", ["--check", "--cached-only", "--explain-conflicts", "--cache-dir", cache], noKey);
    checks.push(["A: --cached-only asks for nothing and says the same", b.asked === 0 && /^why the/m.test(b.out), `${b.asked} requests`]);
    const c = await go("c. --check --cached-only --complete-only", ["--check", "--cached-only", "--complete-only", "--cache-dir", cache], noKey);
    // a connected group is kept only if every fighter in it is right, so on a league with one big group a single short fighter sinks it (the empty-core error); a sparse league keeps its clean groups, and then every record in the core must add up
    const core = /core \(--complete-only\): (\d+) of (\d+) fighters/.exec(c.out);
    checks.push(["A: --complete-only keeps only groups that are right, or says there are none", (c.code !== 0 && /not one fighter's loaded fights add up/.test(c.out)) || (c.code === 0 && !!core && /records: (\d+) of \1 fighters \(100\.0%\)/.test(c.out)), core ? `core ${core[1]} of ${core[2]}` : `exit ${c.code}: empty core`]);
    const dbFile = path.join(dir, "partial.db");
    const e = await go("e. load --allow-partial (conflicts stand)", ["--allow-partial", "--cache-dir", cache], { DATABASE_PATH: dbFile });
    checks.push(["A: --allow-partial does not wave a conflict through", e.code !== 0 && /MORE wins, losses or draws/.test(e.out) && boxersIn(dbFile) === 0, `exit ${e.code}, ${boxersIn(dbFile)} fighters written`]);
    const wrongIds = world.faults?.wrongTotals ?? [];
    const f = await go("f. --check --cached-only --drop-conflicts --allow-partial", ["--check", "--cached-only", "--drop-conflicts", "--allow-partial", "--explain-conflicts", "--cache-dir", cache], noKey);
    const left = /--drop-conflicts: left out (\d+) fighter/.exec(f.out);
    checks.push(["A: --drop-conflicts says why they conflicted, leaves them out, and then the check passes", f.code === 0 && /^why the \d+ conflict/m.test(f.out) && !!left && Number(left[1]) >= wrongIds.length * 0.9 && Number(left[1]) <= wrongIds.length && !/a load would be refused/.test(f.out), `${left?.[1] ?? "none"} left out of ${wrongIds.length} wrong totals (a fighter whose earlier career is also missing is short, not in conflict), exit ${f.code}`]);
    const dbFile3 = path.join(dir, "dropped.db"), listFile = path.join(dir, "dropped.csv");
    const g = await go("g. load --drop-conflicts --allow-partial", ["--drop-conflicts", "--allow-partial", "--dropped-file", listFile, "--cache-dir", cache], { DATABASE_PATH: dbFile3 });
    const listedIds = fs.existsSync(listFile) ? fs.readFileSync(listFile, "utf8").trim().split("\n").slice(1).map((l) => l.split(",")[0].replace(/^bda-f-/, "")) : [];
    const listed = listedIds.length;
    const x = new DatabaseSync(dbFile3, { readOnly: true });
    const inDb = new Set((x.prepare("SELECT external_id e FROM boxers").all() as { e: string }[]).map((r) => r.e));
    x.close();
    checks.push(["A: the load goes through without them, the list names only fighters with a wrong total, and none is in the database", g.code === 0 && left !== null && listed === Number(left[1]) && listedIds.every((id) => wrongIds.includes(id) && !inDb.has(`bda-f-${id}`)) && inDb.size > 0, `exit ${g.code}, ${listed} listed, ${inDb.size} fighters loaded`]);
  });

  // D: winners reversed in the fight list (the vendor's totals are right): the explainer must say the reversal clears BOTH fighters, which is what tells a wrong flag from a wrong total
  await scenario("D. winners reversed in the list", { seed: N.seed + 3, reversed: Math.max(10, Math.round(N.fights * 0.002)) }, async (go, cache) => {
    const a = await go("a. --check --explain-conflicts", ["--check", "--explain-conflicts", "--show", "1", "--cache-dir", cache]);
    const total = Number(/^why the (\d+) conflict/m.exec(a.out)?.[1] ?? 0);
    const flipped = Number(/^\s+(\d+)\s+reversing the winner of one fight/m.exec(a.out)?.[1] ?? 0);
    const mutual = Number(/of those: (\d+) where the same reversal/.exec(a.out)?.[1] ?? 0);
    checks.push(["D: reversed winners are named, and the same reversal clears both fighters", total > 0 && flipped >= total * 0.8 && mutual >= flipped * 0.8, `${total} conflicts, ${flipped} flipped, ${mutual} mutual`]);
  });

  // C: only duplicated fights: merged, so the records add up again
  await scenario("C. duplicated fights only", { seed: N.seed + 2, duplicates }, async (go, cache) => {
    const a = await go("a. --check", ["--check", "--cache-dir", cache]);
    const merged = Number(/duplicateFightsMerged\s+(\d+)/.exec(a.out)?.[1] ?? 0);
    checks.push(["C: fights listed twice no longer stop the load", a.code === 0 && merged >= duplicates * 0.9 && !/CONFLICT/.test(a.out), `exit ${a.code}, ${merged} merged of ${duplicates}`]);
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


  /** The vendor update gate at this size: one night, three copies of the database (see the header). */
  async function gateRehearsal() {
    console.log("\nthe vendor update gate at this size");
    const checkpoint = (f: string) => { const d = new DatabaseSync(f); d.exec("PRAGMA wal_checkpoint(TRUNCATE)"); d.close(); };
    checkpoint(dbFile);
    const copy = (name: string) => { const f = path.join(dir, `gate-${name}.db`); fs.copyFileSync(dbFile, f); return f; };
    const plain = copy("plain"), obs = copy("observe"), hold = copy("hold");
    // a night: the fighters of the most recent cards are changed by the vendor (their country), and every coming fight is decided
    const recent = world.fights.filter((f) => f.status === "FINISHED").sort((x, y) => y.date.localeCompare(x.date)).slice(0, Math.max(50, Math.round(N.fights * 0.002)));
    const ids = new Set(recent.flatMap((f) => [f.a, f.b]));
    for (const id of ids) world.fighters.set(id, { ...world.fighters.get(id)!, country: "Ireland" });
    let decided = 0;
    for (const f of world.fights.filter((x) => x.status === "NOT_STARTED")) { f.status = "FINISHED"; f.winner = "b"; f.outcome = "KO"; f.date = TODAY; const c = (id: string) => world.careers.get(id) ?? world.careers.set(id, { wins: 0, losses: 0, draws: 0 }).get(id)!; c(f.b).wins++; c(f.a).losses++; decided++; }
    console.log(`  the night: ${ids.size} fighters of the latest ${recent.length} fights change country, ${decided} coming fights are decided`);
    const night = (name: string, db: string, env: Record<string, string>) => step(name, ["--update", "--cache-dir", path.join(dir, `cache-${path.basename(db)}`)], { DATABASE_PATH: db, ...env }, () => `database ${mb(du(db) + du(`${db}-wal`))}`);
    const accounts = path.join(dir, "gate-hold-accounts.db");
    const rp = await night("5. update, no gate", plain, {});
    const ro = await night("6. update, VENDOR_GATE=observe", obs, { VENDOR_GATE: "observe", ACCOUNTS_DB_PATH: path.join(dir, "gate-obs-accounts.db") });
    const rh = await night("7. update, VENDOR_GATE=hold", hold, { VENDOR_GATE: "hold", ACCOUNTS_DB_PATH: accounts });
    const digest = (file: string) => {
      const d = new DatabaseSync(file, { readOnly: true }), h = crypto.createHash("sha1");
      for (const t of ["boxers", "events", "bouts"]) for (const r of d.prepare(`SELECT * FROM ${t} ORDER BY external_id`).iterate()) h.update(JSON.stringify(r));
      h.update(JSON.stringify(d.prepare("SELECT COUNT(*) c, SUM(rating) s FROM rating_history").get()));
      d.close(); return h.digest("hex");
    };
    const wouldHold = Number(/would wait for an administrator: (\d+) change/.exec(ro.out)?.[1] ?? NaN), held = Number(/(\d+) change\(s\) held for an administrator \(/.exec(rh.out)?.[1] ?? NaN);
    console.log(`  observing saw ${wouldHold} change(s) that would wait; holding held ${held}`);
    checks.push(["gate: the night is applied by the plain update, observed and held", rp.code === 0 && ro.code === 0 && rh.code === 0, `exits ${rp.code}, ${ro.code}, ${rh.code}`]);
    checks.push(["gate: observing changes nothing (the database is what the plain update left)", digest(obs) === digest(plain), ""]);
    checks.push(["gate: the first night of holding is not refused by the flood guard, and says so", /first night of holding/.test(rh.out), line(rh.out, /first night of holding/).slice(0, 90)]);
    checks.push(["gate: what observing says would wait is what holding held", Number.isFinite(wouldHold) && wouldHold === held && held > 0, `${wouldHold} vs ${held}`]);
    checks.push(["gate: while it waits, the held changes are not in the database", digest(hold) !== digest(plain), ""]);
    checks.push(["gate: observing adds little to the update's time", ro.ms <= rp.ms * 1.5 + 2000, `${secs(rp.ms)} plain, ${secs(ro.ms)} observed, ${secs(rh.ms)} held`]);
    // accept everything that waits, in one step: the database must be what the plain update left
    process.env.ACCOUNTS_DB_PATH = accounts;
    const store = await import("../lib/accounts/store"), users = await import("../lib/accounts/users"), groups = await import("../lib/watch/groups");
    const acc = store.accountsDb();
    const made = await users.createUser("rehearsal_admin", "a-long-passphrase-for-the-rehearsal-1", acc);
    if ("error" in made) throw new Error(made.error);
    users.setRole("rehearsal_admin", "admin", acc);
    const admin = { ...made.user, role: "admin" as const };
    const main = new DatabaseSync(hold);
    const waiting = (acc.prepare("SELECT COUNT(*) c FROM proposals WHERE status = 'pending'").get() as { c: number }).c;
    const t1 = Date.now();
    const accepted = groups.acceptEverythingWaiting(admin, { note: "rehearsal", expectCount: waiting }, main, acc);
    const ms = Date.now() - t1;
    main.close();
    const ok = !("error" in accepted) && accepted.report.approved === waiting;
    console.log(`  accepting ${waiting} waiting change(s) in one step: ${secs(ms)}, this process now ${mb(process.memoryUsage().rss)}`);
    checks.push(["gate: accepting everything waiting leaves exactly what the plain update left (every fighter, card, fight and rating)", ok && digest(hold) === digest(plain), ok ? `${waiting} accepted` : JSON.stringify(accepted)]);
  }

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
    // two random fights between the same pair within a day of each other are, by the importer's rule, one fight listed twice: they are merged and counted
    const merged = Number(/duplicateFightsMerged\s+(\d+)/.exec(load.out)?.[1] ?? 0);
    checks.push(["load: every fight is in the database (or merged into its other copy, and counted)", load.code === 0 && bouts + merged === world.fights.length, `${bouts} of ${world.fights.length}${merged ? `, ${merged} merged` : ""}`]);
    checks.push(["load: every fighter with a fight is in", boxers === new Set(world.fights.flatMap((f) => [f.a, f.b])).size, `${boxers} fighters`]);
    checks.push(["load made no new requests (all cached)", results[2].requests === 0, `${results[2].requests}`]);
    db.close();

    // a day later: one coming fight happens, and the daily job picks it up
    const coming = world.fights.find((f) => f.status === "NOT_STARTED");
    if (coming) { coming.status = "FINISHED"; coming.winner = "a"; coming.outcome = "UD"; coming.date = TODAY; const c = (id: string) => world.careers.get(id) ?? world.careers.set(id, { wins: 0, losses: 0, draws: 0 }).get(id)!; c(coming.a).wins++; c(coming.b).losses++; }
    const upd = await step("4. --update (the daily job)", ["--update", "--cache-dir", cache], { DATABASE_PATH: dbFile }, () => `database ${mb(du(dbFile) + du(`${dbFile}-wal`))}`);
    checks.push(["update succeeds", upd.code === 0, line(upd.out, /^records:|after the update|updating from/)]);
    checks.push(["update costs a few hundred requests, not a reload", results[3].requests < 3000, `${results[3].requests} requests`]);

    if (argv.includes("--gate")) await gateRehearsal();

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
