import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { boxingDataApiProvider, BudgetError, HttpError, NetworkError } from "../lib/providers/boxing-data-api";
import { CheckRefusedError, LockHeldError, describeNothingToUpdate, exitCodeFor, skippedSummary } from "../lib/vendor-backfill";
import type { MockFight, MockWorld } from "../lib/vendor-mock";
import {
  DAY0, DAY1, KEY, ROOT, UPDATE, copyDb, faultyFetch, makeLeague, nextDay, open, pool, results, serveFaulty, start, state, tmp, updateInProcess,
  type FaultyOptions, type Run, type State,
} from "./update-failures-helpers";

/**
 * FAILURE INJECTION for the nightly update (`vendor:fetch -- --update`, which runs `vendor:backfill -- --update`), against the stand-in vendor, on throwaway databases.
 * Nothing here reads ~/ringside-real or reaches a real vendor. Every case proves, for one way the night can go wrong: the database is still valid (integrity_check),
 * the update was applied whole or not at all, nothing that was good has been lost, the command exits with a non-zero code and says in plain words what happened,
 * and the next run (against a healthy vendor) brings the database to exactly what a clean update gives. docs/update-failure-modes.md is the table of the results.
 */
const work = tmp("root");
process.env.RINGSIDE_NOW = DAY1;
process.env.RINGSIDE_WORLD_SETTLE_MS = "100"; // the running site settles for 100 ms, not 5 s, before it shows an update (lib/world.ts)
process.env.ACCOUNTS_DB_PATH = path.join(work, "accounts.db");
process.env.DATABASE_PATH = path.join(work, "site.db"); // read by lib/db when the site test imports it
process.env.RINGSIDE_NO_SEED = "1";
for (const k of ["BOXING_PROVIDER", "VENDOR_RANKINGS_CONFIRMED", "MEDIA_RESOLVER", "BOXING_API_PER_HOUR"]) delete process.env[k];

const w0 = makeLeague();
const { world: w1 } = nextDay(w0);
let tpl = "", base: State, ref: State, baseResults: Map<string, string>;

before(async () => {
  tpl = path.join(work, "template.db");
  const v = await serveFaulty(w0);
  const first = await start(["--cache-dir", path.join(work, "c0"), "--allow-partial", "--keep-disputed"], { db: tpl, url: v.url, lockDir: path.join(work, "l0"), now: DAY0 }).wait();
  await v.close();
  assert.equal(first.code, 0, first.out);
  const x = new DatabaseSync(tpl); x.exec("PRAGMA wal_checkpoint(TRUNCATE)"); x.close();
  base = state(tpl); baseResults = results(tpl);
  const k = copyDb(tpl, "ref"), v1 = await serveFaulty(w1);
  const second = await start([...UPDATE, "--cache-dir", path.join(k.dir, "cache")], { db: k.db, url: v1.url, lockDir: k.lockDir }).wait();
  await v1.close();
  assert.equal(second.code, 0, second.out);
  ref = state(k.db);
  assert.equal(ref.counts.bouts, base.counts.bouts + 1, "the clean update adds the one fight that finished");
  assert.equal(ref.runs, base.runs + 1);
});
after(() => fs.rmSync(work, { recursive: true, force: true }));

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// the machinery of a case

interface Res { k: ReturnType<typeof copyDb>; run: Run; after: State; vendorLog: string[] }
interface Case {
  name: string;
  /** the vendor's misbehaviour */ o?: FaultyOptions;
  /** the command line (default: the nightly one, with no retries and no waiting) */ args?: string[];
  world?: MockWorld; env?: Record<string, string>; now?: string; setup?: (dbFile: string) => void;
  /** the exit code */ code: number;
  /** what the output must say */ out?: RegExp[];
  /** untouched: nothing changed, no run recorded. applied: exactly what a clean update gives. changed: a run was recorded and the data is not the clean result. */
  db: "untouched" | "applied" | "changed";
  check?: (r: Res) => void;
  /** recover by running the command again (otherwise by the same update in this process) */ cli?: boolean;
  /** the next run does not clear what this case wrote (the update never un-sets a nickname): only integrity is judged after it */ loose?: boolean;
}

/** Text that would tell the owner nothing: a stack frame, or the words of a programming slip. */
const CRYPTIC = /\n\s+at \S|is not a function|is not iterable|Cannot read prop|\[object Object\]|\bNaN\b/;

async function attempt(c: Case): Promise<Res> {
  const k = copyDb(tpl, "case");
  c.setup?.(k.db);
  const v = await serveFaulty(c.world ?? w1, c.o);
  const run = await start([...(c.args ?? UPDATE), "--cache-dir", path.join(k.dir, "cache")], { db: k.db, url: v.url, lockDir: k.lockDir, now: c.now, extra: c.env }).wait();
  await v.close();
  return { k, run, after: state(k.db), vendorLog: v.log };
}

/** The next night, with a healthy vendor: the database must come out as a clean update leaves it. */
async function recover(dbFile: string, lockDir: string, cli = false): Promise<State> {
  if (cli) {
    const v = await serveFaulty(w1);
    const r = await start([...UPDATE, "--cache-dir", path.join(path.dirname(dbFile), "cache2")], { db: dbFile, url: v.url, lockDir }).wait();
    await v.close();
    assert.equal(r.code, 0, `the run after the failure: ${r.out.slice(-600)}`);
  } else {
    const db = open(dbFile);
    try { await updateInProcess(db, w1); } finally { db.close(); }
  }
  return state(dbFile);
}

/** Everything one case must show; returns what is wrong, as sentences. */
async function judge(c: Case): Promise<string[]> {
  const bad: string[] = [];
  let r: Res | undefined;
  try {
    r = await attempt(c);
    const { run, after: s } = r, out = run.out.replace(/\(node:\d+\) ExperimentalWarning[^\n]*\n\(Use `node --trace-warnings[^\n]*\n/g, "");
    if (run.code !== c.code) bad.push(`exit code ${run.code} (signal ${run.signal}), wanted ${c.code}`);
    if (s.integrity !== "ok") bad.push(`integrity_check says ${s.integrity}`);
    if (c.code !== 0 && c.db !== "untouched") bad.push("a failing case must leave the database untouched");
    if (c.db === "untouched" && (s.hash !== base.hash || s.runs !== base.runs)) bad.push(`the database changed (counts ${JSON.stringify(s.counts)}, runs ${base.runs} to ${s.runs}) though the update failed`);
    if (c.db === "applied" && (s.hash !== ref.hash || s.runs !== base.runs + 1)) bad.push(`not what a clean update gives (counts ${JSON.stringify(s.counts)}, runs ${s.runs})`);
    if (c.db === "changed" && s.runs !== base.runs + 1) bad.push(`no run was recorded (runs ${s.runs})`);
    if (c.db !== "untouched") { // nothing good is lost: no row disappears, and no result that was in is gone or different
      for (const t of ["boxers", "events", "bouts"]) if (s.counts[t] < base.counts[t]) bad.push(`${t}: ${base.counts[t]} rows fell to ${s.counts[t]}`);
      const now = results(r.k.db), lost = [...baseResults].filter(([id, m]) => now.get(id) !== m).map(([id]) => id);
      if (lost.length) bad.push(`${lost.length} results that were in the database are gone or changed (${lost.slice(0, 3).join(", ")})`);
    }
    for (const re of c.out ?? []) if (!re.test(out)) bad.push(`the output does not say ${re}: ${out.trim().slice(-500)}`);
    if (c.code !== 0 && CRYPTIC.test(out)) bad.push(`the output is not plain: ${out.trim().slice(-400)}`);
    if (out.includes(KEY)) bad.push("the key is in the output");
    c.check?.(r);
  } catch (e) { bad.push(`threw: ${e instanceof Error ? e.message : e}`); }
  if (r) {
    try {
      const again = await recover(r.k.db, r.k.lockDir, c.cli);
      if (again.integrity !== "ok") bad.push(`after the next run integrity_check says ${again.integrity}`);
      if (!c.loose && again.hash !== ref.hash) bad.push(`the next run did not bring the database to the clean result (counts ${JSON.stringify(again.counts)})`);
    } catch (e) { bad.push(`recovery threw: ${e instanceof Error ? e.message : e}`); }
    fs.rmSync(r.k.dir, { recursive: true, force: true });
  }
  return bad;
}

async function table(cases: Case[]) {
  const done = await pool(cases.map((c) => async () => ({ name: c.name, bad: await judge(c) })), 4);
  assert.deepEqual(done.filter((d) => d.bad.length).map((d) => `${d.name}: ${d.bad.join(" | ")}`), []);
}

// the shapes of vendor misbehaviour, as functions of the answers
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type J = any;
/** the first page of the fight list: newest first, so its first entry is the fight that finished tonight */
const onFights = (j: J, c: { path: string; nth: number }, fn: (f: J, i: number) => J) => { if (c.path === "/v2/fights/" && c.nth === 1) j.data = j.data.map(fn); return j; };
const allFights = (j: J, c: { path: string }, fn: (f: J, i: number) => J) => { if (c.path === "/v2/fights/" || c.path === "/v2/fights/schedule") j.data = j.data.map(fn); return j; };
const onFighter = (j: J, c: { path: string; nth: number }, nth: number, fn: (f: J) => void) => { if (c.path.startsWith("/v2/fighters/") && c.nth === nth) fn(j.data); return j; };
const fighterN = (n: number) => (c: { path: string; nth: number }) => c.path.startsWith("/v2/fighters/") && c.nth === n;

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// 1. the vendor refuses or fails

test("the vendor refuses (429, 403, quota) or fails (500, 502, 503) or is gone: the command stops, says why, and the database is as it was", async () => {
  await table([
    { name: "429 with no Retry-After on the first page", o: { fault: (c) => (c.n === 1 ? { status: 429, body: { message: "Too many requests" } } : undefined) }, code: 2, db: "untouched", out: [/rate limit hit on \/v2\/fights\/: Too many requests \(retry after unknown s\)/, /--patience-min/] },
    { name: "429 with Retry-After: 30", o: { fault: (c) => (c.n === 1 ? { status: 429, headers: { "retry-after": "30" }, body: { message: "Too many requests" } } : undefined) }, code: 2, db: "untouched", out: [/\(retry after 30 s\)/] },
    { name: "429 on the hourly limit part way through the fighters", o: { fault: (c) => (fighterN(5)(c) ? { status: 429, body: { message: "You have exceeded the rate limit per hour for your plan, MEGA, by the API provider" } } : undefined) }, code: 2, db: "untouched", out: [/rate limit hit on \/v2\/fighters\/\w+: You have exceeded the rate limit per hour/] },
    { name: "429 saying the monthly quota is used up", o: { fault: (c) => (c.n === 1 ? { status: 429, body: { message: "You have exceeded the MONTHLY quota for Requests on your current plan" } } : undefined) }, code: 2, db: "untouched", out: [/quota used up on \/v2\/fights\/.*Waiting will not help/] },
    { name: "403: the key has lapsed", o: { key: "some-other-key-0123456789abcdef0123456789" }, code: 2, db: "untouched", out: [/403 on \/v2\/fights\/: Invalid API key/] },
    { name: "500 on the second page", o: { fault: (c) => (c.n === 2 ? { status: 500 } : undefined) }, code: 2, db: "untouched", out: [/Boxing Data API 500 on \/v2\/fights\//] },
    { name: "503 on the schedule", o: { fault: (c) => (c.path === "/v2/fights/schedule" ? { status: 503 } : undefined) }, code: 2, db: "untouched", out: [/503 on \/v2\/fights\/schedule/] },
    { name: "502 on one fighter", o: { fault: (c) => (fighterN(3)(c) ? { status: 502 } : undefined) }, code: 3, db: "untouched", out: [/skipped: Boxing Data API 502/, /fight\(s\) were left out because a fighter could not be fetched/, /Run the same command again/] },
    { name: "one 503, one retry allowed: the retry succeeds", args: ["--update", "--retries", "1", "--patience-min", "0"], o: { fault: (c) => (c.n === 1 ? { status: 503 } : undefined) }, code: 0, db: "applied", out: [/503 on \/v2\/fights\/; retrying/] },
    { name: "two 503s in a row, one retry allowed: the run stops", args: ["--update", "--retries", "1", "--patience-min", "0"], o: { fault: (c) => (c.n <= 2 ? { status: 503 } : undefined) }, code: 2, db: "untouched", out: [/Boxing Data API 503 on \/v2\/fights\//] },
    { name: "the vendor answers with an error envelope on a 200", o: { fault: (c) => (c.n === 1 ? { status: 200, body: { metadata: {}, pagination: {}, error: { code: "Maintenance", message: "back soon" }, data: [] } } : undefined) }, code: 3, db: "untouched", out: [/Boxing Data API error on \/v2\/fights\/.*Maintenance/] },
  ]);
});

test("the vendor is not there (connection refused) and the network drops (reset, cut off mid-page, hung): no change, a plain message, the next run recovers", async () => {
  const gone = (await serveFaulty(w1)); const goneUrl = gone.url; await gone.close(); // a port nothing listens on now
  await table([
    { name: "connection refused (the vendor's host is down)", env: { BOXING_API_URL: goneUrl }, code: 2, db: "untouched", out: [/unreachable on \/v2\/fights\/.*ECONNREFUSED/] },
    { name: "connection reset on the first page", o: { fault: (c) => (c.n === 1 ? { destroy: true } : undefined) }, code: 2, db: "untouched", out: [/unreachable on \/v2\/fights\/.*(ECONNRESET|other side closed|UND_ERR_SOCKET|socket)/] },
    { name: "connection reset on one fighter", o: { fault: (c) => (fighterN(4)(c) ? { destroy: true } : undefined) }, code: 3, db: "untouched", out: [/skipped: Boxing Data API unreachable on \/v2\/fighters\//, /could not be fetched/] },
    { name: "the connection dies in the middle of page 2", o: { fault: (c) => (c.n === 2 ? { cutAfter: 500 } : undefined) }, code: 2, db: "untouched", out: [/unreachable on \/v2\/fights\/.*(terminated|other side closed|UND_ERR_SOCKET)/] },
    { name: "the connection dies in the middle of one fighter", o: { fault: (c) => (fighterN(4)(c) ? { cutAfter: 50 } : undefined) }, code: 3, db: "untouched", out: [/could not be fetched/] },
    { name: "the middle-of-the-page cut is retried like any other network failure", args: ["--update", "--retries", "1", "--patience-min", "0"], o: { fault: (c) => (c.n === 2 ? { cutAfter: 500 } : undefined) }, code: 0, db: "applied", out: [/network error on \/v2\/fights\/.*retrying/] },
    { name: "a JSON body that stops short (a complete HTTP answer)", o: { fault: (c) => (c.n === 2 ? { truncateJson: 700 } : undefined) }, code: 3, db: "untouched", out: [/sent something that is not JSON on \/v2\/fights\//] },
    { name: "an HTML maintenance page with status 200", o: { fault: (c) => (c.n === 2 ? { raw: "<html><body>Down for maintenance</body></html>" } : undefined) }, code: 3, db: "untouched", out: [/not JSON on \/v2\/fights\/: <html><body>Down for maintenance/] },
    { name: "an HTML page with status 200 for one fighter", o: { fault: (c) => (fighterN(2)(c) ? { raw: "<html>x</html>" } : undefined) }, code: 3, db: "untouched", out: [/not JSON on \/v2\/fighters\//, /could not be fetched/] },
    { name: "the body is JSON null", o: { fault: (c) => (c.n === 1 ? { raw: "null", type: "application/json" } : undefined) }, code: 3, db: "untouched", out: [/Boxing Data API.*\/v2\/fights\/.*(unexpected|changed)/i] },
    { name: "the body is a JSON list instead of the envelope", o: { fault: (c) => (c.n === 1 ? { raw: "[1,2,3]", type: "application/json" } : undefined) }, code: 3, db: "untouched", out: [/Boxing Data API.*\/v2\/fights\/.*(unexpected|changed)/i] },
  ]);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// 2. the vendor's answers change shape

const first = (j: J, c: { path: string; nth: number }, fn: (f: J) => void) => onFights(j, c, (f, i) => { if (i === 0) fn(f); return f; }); // the newest fight is the one that finished tonight
const noList = (c: { path: string }) => c.path === "/v2/fights/" || c.path === "/v2/fights/schedule";

test("a fight list that comes back empty or null is not a successful update (it would have stamped the data as fresh and changed nothing)", async () => {
  await table([
    { name: "an empty list on every page", o: { mutate: (c, j) => { if (noList(c)) { j.data = []; j.pagination = { page: 1, total_pages: 1, next_page: null }; } return j; } }, code: 3, db: "untouched", out: [/no usable fights for 2026-09-18 to 2026-10-04/] },
    { name: "data is null on every page", o: { mutate: (c, j) => { if (noList(c)) j.data = null; return j; } }, code: 3, db: "untouched", out: [/no usable fights for 2026-09-18/] },
    { name: "data is an object instead of a list", o: { mutate: (c, j) => { if (c.path === "/v2/fights/") j.data = { oops: 1 }; return j; } }, code: 3, db: "untouched", out: [/\/v2\/fights\/.*(not a list|changed|unexpected)/i] },
    { name: "every fight has lost its fighters (the field was renamed)", o: { mutate: (c, j) => allFights(j, c, (f) => { f.competitors = f.fighters; delete f.fighters; return f; }) }, code: 3, db: "untouched", out: [/no usable fights for 2026-09-18/] },
  ]);
});

test("a fight or a fighter with a field missing, extra, null or of the wrong type is skipped and counted, or read as far as it can be, never a crash with a stack trace", async () => {
  await table([
    { name: "an extra field everywhere (and a night that skipped nothing is silent at the end)", check: (r) => assert.doesNotMatch(r.run.out, /update done, but/), o: { mutate: (c, j) => allFights(j, c, (f) => ({ ...f, surprise: { a: 1 }, fighters: { ...f.fighters, fighter_3: null } })) }, code: 0, db: "applied" },
    { name: "the newest fight has no second fighter", o: { mutate: (c, j) => first(j, c, (f) => { delete f.fighters.fighter_2; }) }, code: 0, db: "changed", out: [/update done, but 1 fight\(s\) skipped \(a field missing\): see "approximated or skipped" above\./, /fightsSkippedNoFighter\s+1/], check: (r) => assert.equal(r.after.counts.bouts, base.counts.bouts, "the skipped fight is not in, and nothing else moved") },
    { name: "the newest fight has no id", o: { mutate: (c, j) => first(j, c, (f) => { delete f.id; }) }, code: 0, db: "changed", out: [/update done, but 1 fight\(s\) skipped \(a field missing\)/, /fightsSkippedNoId\s+1/] },
    { name: "fighters is a string", o: { mutate: (c, j) => first(j, c, (f) => { f.fighters = "none"; }) }, code: 0, db: "changed", out: [/fightsSkippedNoFighter\s+1/] },
    { name: "the same fighter on both sides", o: { mutate: (c, j) => first(j, c, (f) => { f.fighters.fighter_2 = { ...f.fighters.fighter_1 }; }) }, code: 0, db: "changed", out: [/fightsSkippedSameFighter\s+1/] },
    { name: "the event's date is a number (the fight's own date is fine)", o: { mutate: (c, j) => first(j, c, (f) => { f.event.date = 20261003; }) }, code: 0, db: "applied" },
    { name: "both dates are numbers", o: { mutate: (c, j) => first(j, c, (f) => { f.event.date = 20261003; f.date = 20261003; }) }, code: 0, db: "changed", out: [/fightsSkippedNoDate\s+1/] },
    { name: "a fighter id that is a number", o: { mutate: (c, j) => first(j, c, (f) => { f.fighters.fighter_1.fighter_id = 12345; }) }, code: 3, db: "untouched", out: [/404 on \/v2\/fighters\/12345/, /could not be fetched/] },
    { name: "scheduled rounds as text on four fights (a decision's last round is its scheduled rounds, so for a night it reads 10; the next night puts it right)", o: { mutate: (c, j) => onFights(j, c, (f, i) => { if (i >= 1 && i < 4) f.scheduled_rounds = "twelve"; return f; }) }, code: 0, db: "changed", out: [/roundUnreadable\s+3/] },
    { name: "a fighter with a null name", o: { mutate: (c, j) => onFighter(j, c, 2, (f) => { f.name = null; }) }, code: 3, db: "untouched", out: [/could not be fetched/] },
    { name: "a fighter whose name is a number", o: { mutate: (c, j) => onFighter(j, c, 2, (f) => { f.name = 42; }) }, code: 3, db: "untouched", out: [/could not be fetched/] },
    { name: "birth year as text, totals as text", o: { mutate: (c, j) => onFighter(j, c, 2, (f) => { f.birth_year = "1990"; f.stats = { wins: "5", losses: "1", draws: "0" }; }) }, code: 0, db: "applied" },
    { name: "a country nobody has heard of (an approximation, not a skip: no end-of-run summary)", check: (r) => assert.doesNotMatch(r.run.out, /update done, but/), o: { mutate: (c, j) => onFighter(j, c, 2, (f) => { f.nationality = "Atlantis"; f.nationality_code = "ZZ"; }) }, code: 0, db: "changed", out: [/nationalityUnplaced\s+1/] },
    { name: "a division nobody has heard of, on four fights", o: { mutate: (c, j) => onFights(j, c, (f, i) => { if (i < 4) f.division = { name: "Mega Heavy Plus" }; return f; }) }, code: 0, db: "applied", out: [/divisionUnknown\s+4/, /boutDivisionFromFighters\s+4/] },
    { name: "a division nobody has heard of, for a fighter", o: { mutate: (c, j) => onFighter(j, c, 2, (f) => { f.division = { name: "Zorp" }; }) }, code: 0, db: "applied" },
  ]);
});

test("a result or a status the importer has never seen does not wipe a result that was in the database", async () => {
  await table([
    { name: "outcome ZZZ on four fights", o: { mutate: (c, j) => onFights(j, c, (f, i) => { if (f.results && i < 4) f.results.outcome = "ZZZ"; return f; }) }, code: 0, db: "changed", out: [/update done, but \d+ result\(s\) kept as unsettled/, /outcomeUnreadable\s+\d/] },
    { name: "status POSTPONED on four finished fights", o: { mutate: (c, j) => onFights(j, c, (f, i) => { if (i < 4) f.status = "POSTPONED"; return f; }) }, code: 0, db: "changed" },
    { name: "results null on every fight of the page", o: { mutate: (c, j) => allFights(j, c, (f) => { f.results = null; return f; }) }, code: 0, db: "changed" },
    { name: "the same fight listed again under another id with the other fighter as winner", o: { mutate: (c, j) => { if (c.path === "/v2/fights/" && c.nth === 1) { const x = j.data.find((f: J) => f.id === "x100"); const w = x.fighters.fighter_1.winner; j.data.push({ ...JSON.parse(JSON.stringify(x)), id: "x100-b", fighters: { fighter_1: { ...x.fighters.fighter_1, winner: !w }, fighter_2: { ...x.fighters.fighter_2, winner: w } } }); } return j; } }, code: 0, db: "changed", out: [/duplicateFightsDisagree\s+1/] },
  ]);
});

test("a fight listed twice, under two ids, or under two fighters: counted once, the first listing wins, nothing is believed that the listings disagree on", async () => {
  await table([
    { name: "the same page entry twice (duplicate ids in one page)", o: { mutate: (c, j) => { if (c.path === "/v2/fights/" && c.nth === 1) j.data = [...j.data, ...j.data.slice(0, 5)]; return j; } }, code: 0, db: "applied" },
    { name: "the same fight id again, with two other fighters", o: { mutate: (c, j) => { if (c.path === "/v2/fights/" && c.nth === 1) { const x = JSON.parse(JSON.stringify(j.data[0])); x.fighters.fighter_1.fighter_id = "f50"; x.fighters.fighter_2.fighter_id = "f51"; j.data.push(x); } return j; } }, code: 0, db: "applied" },
    { name: "the same bout under a second id, same fighters, same winner (two generations of records)", o: { mutate: (c, j) => { if (c.path === "/v2/fights/" && c.nth === 1) j.data.push({ ...JSON.parse(JSON.stringify(j.data[0])), id: "n1-b" }); return j; } }, code: 0, db: "applied", out: [/duplicateFightsMerged\s+1/] },
    { name: "a fight whose fighter has vanished (404): the run stops, naming the fighter", o: { fault: (c) => (c.path === "/v2/fighters/f33" ? { status: 404, body: { message: "not found" } } : undefined) }, code: 3, db: "untouched", out: [/fighter f33 skipped: Boxing Data API 404/, /could not be fetched/, /--allow-incomplete/] },
    { name: "the same, with --allow-incomplete: the rest is loaded, nothing is deleted", args: [...UPDATE, "--allow-incomplete"], o: { fault: (c) => (c.path === "/v2/fighters/f33" ? { status: 404, body: { message: "not found" } } : undefined) }, code: 0, db: "changed", out: [/boutsDroppedUnknownFighter\s+\d/] },
  ]);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// 3. values that cannot be true

test("a finished result dated in the future is not shown as a result; negative, absurd, huge and hostile values are cleaned or left out, not stored", async () => {
  const hostile = "Evil\u0000\u0007 \u202efdp.exe\u202c Name\u2066\u200b";
  await table([
    { name: "a finished fight with a result, dated 2027", o: { mutate: (c, j) => first(j, c, (f) => { f.date = "2027-01-01T02:00:00"; f.event = { ...f.event, date: "2027-01-01T00:00:00" }; f.status = "FINISHED"; f.results = { outcome: "KO", round: 2 }; f.fighters.fighter_1.winner = true; f.fighters.fighter_2.winner = false; }) }, code: 0, db: "changed", out: [/update done, but 1 result\(s\) dropped \(dated in the future\)/, /finishedInFuture\s+1/],
      check: (r) => { const x = new DatabaseSync(r.k.db); try { assert.equal((x.prepare("SELECT COUNT(*) c FROM bouts b JOIN events e ON e.id = b.event_id WHERE e.date > ? AND b.method IS NOT NULL").get(DAY1) as { c: number }).c, 0, "no result for a fight not yet held"); } finally { x.close(); } } },
    { name: "negative career totals are ignored", o: { mutate: (c, j) => onFighter(j, c, 2, (f) => { f.stats.wins = -5; }) }, code: 0, db: "applied" },
    { name: "absurd career totals", o: { mutate: (c, j) => onFighter(j, c, 2, (f) => { f.stats.wins = 9e12; f.stats.total_bouts = 9e12; }) }, code: 0, db: "applied",
      check: (r) => { const x = new DatabaseSync(r.k.db); try { assert.ok((x.prepare("SELECT MAX(vendor_wins) m FROM boxers").get() as { m: number }).m <= 1000, "no fighter has nine trillion wins"); } finally { x.close(); } } },
    { name: "a fractional career total", o: { mutate: (c, j) => onFighter(j, c, 2, (f) => { f.stats.wins = 5.5; }) }, code: 0, db: "applied" },
    { name: "negative and absurd height and reach", o: { mutate: (c, j) => onFighter(j, c, 2, (f) => { f.height_cm = -300; f.reach_cm = 1e9; }) }, code: 0, db: "changed",
      check: (r) => { const x = new DatabaseSync(r.k.db); try { assert.ok((x.prepare("SELECT MAX(reach_cm) m FROM boxers").get() as { m: number }).m < 300, "no reach of a million kilometres"); } finally { x.close(); } } },
    { name: "a billion scheduled rounds and a round 9999", o: { mutate: (c, j) => onFights(j, c, (f, i) => { if (i === 1) f.scheduled_rounds = 1e9; if (i === 2) f.results = { outcome: "KO", round: 9999 }; return f; }) }, code: 0, db: "applied", out: [/update done, but [12] unreadable round count\(s\) read as ten/, /roundUnreadable\s+[12]/] },
    { name: "a fighter's name two million characters long", o: { mutate: (c, j) => onFighter(j, c, 2, (f) => { f.name = "A".repeat(2_000_000); }) }, code: 0, db: "changed",
      check: (r) => { const x = new DatabaseSync(r.k.db); try { assert.ok((x.prepare("SELECT MAX(LENGTH(name)) a FROM boxers").get() as { a: number }).a <= 200, "the name is cut"); } finally { x.close(); } } },
    { name: "control characters and right-to-left overrides in names, nicknames and card titles", o: { mutate: (c, j) => { onFighter(j, c, 2, (f) => { f.name = hostile; }); onFighter(j, c, 3, (f) => { f.name = "محمد علي"; }); return first(j, c, (f) => { f.event.title = "Card \u202eevil\u0000 title"; f.venue = "Arena\u0007"; }); } }, code: 0, db: "changed",
      check: (r) => {
        const x = new DatabaseSync(r.k.db);
        try {
          const bad = /[\u0000-\u001f\u007f-\u009f\u200b\u2028\u2029\u202a-\u202e\u2060\u2066-\u2069\ufeff]/;
          for (const [t, col] of [["boxers", "name"], ["boxers", "nickname"], ["events", "name"], ["events", "venue"]]) assert.deepEqual((x.prepare(`SELECT ${col} v FROM ${t} WHERE ${col} IS NOT NULL`).all() as { v: string }[]).map((q) => q.v).filter((v) => bad.test(v)), [], `${t}.${col} holds no control or direction-override character`);
          assert.equal((x.prepare("SELECT COUNT(*) c FROM boxers WHERE name = 'محمد علي'").get() as { c: number }).c, 1, "an Arabic name is left exactly as it is");
        } finally { x.close(); }
      } },
    { name: "a nickname of 100,000 characters with control and override characters (a nickname the vendor later drops stays: the update never clears one)", loose: true, o: { mutate: (c, j) => onFighter(j, c, 2, (f) => { f.nickname = "x\u0001y\u202ez" + "B".repeat(100_000); }) }, code: 0, db: "changed",
      check: (r) => { const x = new DatabaseSync(r.k.db); try { const n = (x.prepare("SELECT nickname FROM boxers WHERE nickname IS NOT NULL").all() as { nickname: string }[]).map((q) => q.nickname); assert.ok(n.every((v) => v.length <= 200 && !/[\u0000-\u001f\u202a-\u202e]/.test(v)), "the nickname is cut and clean"); } finally { x.close(); } } },
  ]);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// 4. the page limit and the clocks

test("the page limit (10,000 documents) reached silently, and a vendor whose list is read in date windows", async () => {
  await table([
    { name: "limit reached, the command knows it (windows), the vendor answers empty pages", args: [...UPDATE, "--offset-limit", "200"], o: { offsetLimit: 200, beyond: "silent", totalPages: "capped" }, code: 0, db: "applied" },
    { name: "limit reached, the command does not know it: the oldest fights of the window are silently missing, the newest are in", o: { offsetLimit: 100, beyond: "silent", totalPages: "capped" }, code: 0, db: "applied", check: (r) => { const n = Number(/loaded: boxers \d+, events \d+, bouts (\d+)/.exec(r.run.out)?.[1]); assert.ok(n > 0 && n < 134, `fewer fights (${n}) than the 134 the window holds, and nothing says so`); assert.doesNotMatch(r.run.out, /limit|reach|silent|cut/i); } },
  ]);
});

test("clock skew: a clock a day behind, years behind, years ahead", async () => {
  await table([
    { name: "the machine's date is two days behind the vendor's: the vendor leaves out tonight's fight (it is after the date asked for); the next run, with the right date, adds it", now: "2026-10-02", code: 0, db: "changed", check: (r) => assert.equal(r.after.counts.bouts, base.counts.bouts) },
    { name: "the machine's date is years behind: nothing is updated, and it says what it saw", now: "2020-01-01", code: 1, db: "untouched", out: [/nothing to update/i, /newest card in the database is dated 2026-\d\d-\d\d and today is 2020-01-01 on this machine, so the newest card is \d+ day\(s\) in the future/, /Is this machine's clock right\?/] },
    { name: "the machine's date is years ahead: the run goes through, but every fighter is 'inactive' until the next run with the right date", now: "2030-01-01", code: 0, db: "changed" },
  ]);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// 5. the process dies, two runs meet, the disk fills, the database is busy

const nap = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(f: () => boolean, ms = 15_000) { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) throw new Error("timed out waiting"); await nap(25); } }
const lockFiles = (dir: string) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".lock")) : []);

test("a run stopped (SIGTERM, as a cron timeout does) or killed (SIGKILL) while the vendor hangs: the database is as it was; SIGTERM gives the lock back, a killed run leaves it, and the next run takes it over", async () => {
  for (const sig of ["SIGTERM", "SIGKILL"] as const) {
    const k = copyDb(tpl, "sig"), v = await serveFaulty(w1, { fault: (c) => (c.n === 2 ? { hang: true } : undefined) });
    const run = start([...UPDATE, "--cache-dir", path.join(k.dir, "cache")], { db: k.db, url: v.url, lockDir: k.lockDir });
    await waitFor(() => v.log.length >= 2 && lockFiles(k.lockDir).length === 1);
    run.child.kill(sig);
    const r = await run.wait(); await v.close();
    if (sig === "SIGTERM") { assert.equal(r.code, 130, "stopped by a signal: the conventional 130"); assert.deepEqual(lockFiles(k.lockDir), [], "the lock is given back"); }
    else { assert.equal(r.signal, "SIGKILL"); assert.equal(lockFiles(k.lockDir).length, 1, "a killed process cannot give its lock back"); }
    const s = state(k.db);
    assert.equal(s.integrity, "ok"); assert.equal(s.hash, base.hash, `${sig}: the database is as it was`); assert.equal(s.runs, base.runs);
    const again = await recover(k.db, k.lockDir, true); // through the command: a dead process's lock must not stop it
    assert.equal(again.hash, ref.hash, `${sig}: the next run gives the clean result`);
    assert.deepEqual(lockFiles(k.lockDir), [], "and a finished run leaves no lock");
    fs.rmSync(k.dir, { recursive: true, force: true });
  }
});

/** Starts the writing half of the update in a helper process, and kills it dead (SIGKILL) at the first row written inside the transaction / inside the ratings recompute. */
async function killedAt(mode: "txn" | "ratings") {
  const k = copyDb(tpl, mode), marker = path.join(k.dir, "marker");
  const child = spawn(process.execPath, ["--import", "tsx", "tests/update-failures-child.ts", k.db, mode, marker], { cwd: ROOT, stdio: "ignore", env: { ...process.env, RINGSIDE_NOW: DAY1, ACCOUNTS_DB_PATH: path.join(k.dir, "accounts.db"), RINGSIDE_NO_SEED: "1" } });
  const ended = new Promise<string | null>((r) => child.on("close", (_c, s) => r(s)));
  await waitFor(() => fs.existsSync(marker), 30_000);
  child.kill("SIGKILL");
  assert.equal(await ended, "SIGKILL");
  return k;
}

test("SIGKILL in the middle of the transaction that writes the update: the whole update is rolled back, the database is valid and as it was, and the next run applies it", async () => {
  const k = await killedAt("txn");
  const s = state(k.db);
  assert.equal(s.integrity, "ok");
  assert.equal(s.hash, base.hash, "no half of the update: fighters, cards and fights are all as before");
  assert.equal(s.runs, base.runs);
  assert.equal((await recover(k.db, k.lockDir)).hash, ref.hash);
});

test("SIGKILL after the update was committed but before the ratings were recomputed: valid, and the fights are in, but the ratings and the 'last updated' mark are not (until the next run, which repairs both)", async () => {
  const k = await killedAt("ratings");
  const s = state(k.db);
  assert.equal(s.integrity, "ok");
  assert.equal(s.counts.bouts, base.counts.bouts + 1, "the committed update is whole");
  assert.equal(s.counts.rating_history, base.counts.rating_history, "the ratings are the old ones, whole (the recompute was rolled back, not half done)");
  assert.equal(s.runs, base.runs, "no run is recorded, so the data does not look freshly updated");
  const again = await recover(k.db, k.lockDir);
  assert.equal(again.hash, ref.hash, "the next run repairs the ratings");
  assert.equal(again.runs, base.runs + 1);
});

test("two overlapping runs: the second is refused with the first one's process id, the first finishes, and the next night's run changes nothing more", async () => {
  const k = copyDb(tpl, "overlap"), v = await serveFaulty(w1, { fault: (c) => (c.n === 1 ? { delayMs: 1500 } : undefined) });
  const env = { db: k.db, url: v.url, lockDir: k.lockDir };
  const a = start([...UPDATE, "--cache-dir", path.join(k.dir, "cacheA")], env);
  await waitFor(() => lockFiles(k.lockDir).length === 1);
  const b = await start([...UPDATE, "--cache-dir", path.join(k.dir, "cacheB")], env).wait();
  assert.equal(b.code, 75, "another run holds the key: EX_TEMPFAIL");
  assert.match(b.out, new RegExp(`Another backfill is already running with this API key \\(process ${a.child.pid}`));
  assert.match(b.out, /share the plan's hourly allowance/);
  assert.equal(state(k.db).hash, base.hash, "the refused run touched nothing, and the first has not written yet");
  const ra = await a.wait();
  assert.equal(ra.code, 0, ra.out);
  assert.equal(state(k.db).hash, ref.hash);
  const c = await start([...UPDATE, "--cache-dir", path.join(k.dir, "cacheC")], env).wait(); // the same night's feed again: nothing new
  assert.equal(c.code, 0, c.out);
  const s = state(k.db);
  assert.equal(s.hash, ref.hash, "an update is idempotent");
  assert.equal(s.runs, base.runs + 2);
  await v.close(); fs.rmSync(k.dir, { recursive: true, force: true });
});

test("another process (the site, a person with the sqlite shell) holds the write lock for a moment: the update waits for it instead of failing", async () => {
  const k = copyDb(tpl, "busy"), marker = path.join(k.dir, "marker"), v = await serveFaulty(w1);
  const holder = spawn(process.execPath, ["--import", "tsx", "tests/update-failures-child.ts", k.db, "lock:1500", marker], { cwd: ROOT, stdio: "ignore" });
  const held = new Promise<void>((r) => holder.on("close", () => r()));
  await waitFor(() => fs.existsSync(marker), 30_000);
  const r = await start([...UPDATE, "--cache-dir", path.join(k.dir, "cache")], { db: k.db, url: v.url, lockDir: k.lockDir }).wait();
  await held; await v.close();
  assert.equal(r.code, 0, `the update was refused by the lock: ${r.out.slice(-400)}`);
  assert.equal(state(k.db).hash, ref.hash);
  fs.rmSync(k.dir, { recursive: true, force: true });
});

test("the backup before the write cannot be made (the folder is not writable, as on a full or read-only disk): the run stops before the database is touched", async () => {
  await table([{ name: "no room for the backup", setup: (db) => fs.writeFileSync(path.join(path.dirname(db), "backups"), "a file where the folder should be"), code: 1, db: "untouched", out: [/backups/] }]);
});

/** A bigger night: 150 more fights, so the write needs room the database does not have. */
function bigNight(): MockWorld {
  const { world } = nextDay(w0);
  const careers = new Map([...world.careers].map(([id, c]) => [id, { ...c }]));
  const fights: MockFight[] = [...world.fights];
  const divisions = ["Lightweight", "Welterweight", "Middleweight", "Heavyweight"];
  for (let i = 0; i < 150; i++) {
    const block = i % 4, a = block * 15 + (Math.floor(i / 4) % 15), b = block * 15 + (((Math.floor(i / 4) % 15) + [9, 10, 11][Math.floor(i / 60)]) % 15);
    fights.push({ id: `big${i}`, date: DAY0, a: `f${a}`, b: `f${b}`, status: "FINISHED", winner: "a", outcome: "UD", round: null, division: divisions[block], event: `big-${i}` });
    careers.get(`f${a}`)!.wins++; careers.get(`f${b}`)!.losses++;
  }
  return { ...world, fights, careers };
}

test("the disk fills during the write (SQLite's own 'database or disk is full'): the transaction is rolled back, the database is valid and as it was, the next run applies the update. (A full filesystem cannot be made in a test; this is SQLite's limit on the file's size, which it reports in the same words.)", async () => {
  const k = copyDb(tpl, "full"), db = open(k.db);
  const pages = Number((db.prepare("PRAGMA page_count").get() as { page_count: number }).page_count);
  db.exec(`PRAGMA max_page_count = ${pages}`);
  await assert.rejects(updateInProcess(db, bigNight()), /full/i);
  db.close();
  const s = state(k.db);
  assert.equal(s.integrity, "ok");
  assert.equal(s.hash, base.hash, "nothing of the update is in");
  assert.equal(s.runs, base.runs);
  assert.equal((await recover(k.db, k.lockDir)).hash, ref.hash);
  fs.rmSync(k.dir, { recursive: true, force: true });
});

test("an error while the ratings are recomputed (the disk fills there) leaves no transaction open on the connection, and the old ratings whole", async () => {
  const k = copyDb(tpl, "ratings-error"), db = open(k.db);
  db.exec("CREATE TEMP TRIGGER boom BEFORE INSERT ON rating_history BEGIN SELECT RAISE(ABORT, 'database or disk is full (simulated)'); END");
  await assert.rejects(updateInProcess(db, w1), /disk is full/);
  assert.doesNotThrow(() => db.exec("BEGIN; ROLLBACK"), "a connection that is kept (the site's) must not be left inside a transaction by the failure");
  db.exec("DROP TRIGGER boom"); db.close();
  const s = state(k.db);
  assert.equal(s.integrity, "ok");
  assert.equal(s.counts.rating_history, base.counts.rating_history, "the old ratings are whole");
  assert.equal((await recover(k.db, k.lockDir)).hash, ref.hash);
  fs.rmSync(k.dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// 6. waiting out the vendor (injected sleeping: no test here waits for real)

const SINCE = "2026-09-18";
function make(fault: Parameters<typeof faultyFetch>[1], o: Record<string, unknown> = {}) {
  const f = faultyFetch(w1, fault), sleeps: number[] = [];
  const p = boxingDataApiProvider({ key: KEY, purpose: "evaluation", fetchImpl: f.fetchImpl, since: SINCE, scheduleDays: 0, gapMs: 0, perHour: 3_600_000, retries: 0, log: () => {}, sleep: async (ms: number) => { if (ms > 1) sleeps.push(ms); }, ...o });
  return { p, f, sleeps };
}
const settles = <T,>(p: Promise<T>, ms = 4000) => Promise.race([p, nap(ms).then(() => { throw new Error(`did not settle in ${ms} ms`); })]);

test("429: Retry-After is waited out when the run has patience, ignored when it is not a number, never waited for when the quota is used up, and given up on when the patience ends", async () => {
  let m = make((n) => (n === 1 ? { status: 429, headers: { "retry-after": "7" }, body: { message: "slow down" } } : undefined), { patienceMs: 600_000 });
  assert.ok((await m.p.fetchBouts()).length > 100); assert.deepEqual(m.sleeps, [7000], "waited exactly what the vendor said");
  m = make((n) => (n === 1 ? { status: 429, headers: { "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" }, body: { message: "slow down" } } : undefined), { patienceMs: 600_000 });
  assert.ok((await m.p.fetchBouts()).length > 100); assert.deepEqual(m.sleeps, [60_000], "a date is not a number of seconds: the first standard step, a minute");
  m = make(() => ({ status: 429, body: { message: "slow down" } }), { patienceMs: 200_000 });
  await assert.rejects(m.p.fetchBouts(), (e) => e instanceof HttpError && e.status === 429 && /still in force after waiting 3 minute/.test(e.message));
  assert.deepEqual(m.sleeps, [60_000, 120_000], "one, then two minutes, and no more than the patience allows");
  m = make(() => ({ status: 429, body: { message: "You have exceeded the MONTHLY quota" } }), { patienceMs: 600_000 });
  await assert.rejects(m.p.fetchBouts(), /quota used up/); assert.deepEqual(m.sleeps, [], "no wait can help");
  m = make((n) => (n === 1 ? { status: 429, headers: { "retry-after": "5" }, body: { message: "slow down" } } : undefined), { retries: 1 });
  assert.ok((await m.p.fetchBouts()).length > 100); assert.deepEqual(m.sleeps, [5000], "without patience a retry still honours Retry-After");
});

test("500, 502, 503, 504 bursts: retried with 1, 2, 4 s back-off up to the retries given, Retry-After honoured (capped at two minutes), then the failure is the run's", async () => {
  for (const status of [500, 502, 503, 504]) {
    const m = make((n) => (n <= 3 ? { status } : undefined), { retries: 4 });
    assert.ok((await m.p.fetchBouts()).length > 100, String(status)); assert.deepEqual(m.sleeps, [1000, 2000, 4000], `${status} burst of three`);
  }
  let m = make((n) => (n <= 5 ? { status: 503 } : undefined), { retries: 4 });
  await assert.rejects(m.p.fetchBouts(), (e) => e instanceof HttpError && e.status === 503); assert.equal(m.f.calls.length, 5, "five tries and no more");
  m = make((n) => (n === 1 ? { status: 503, headers: { "retry-after": "5" } } : undefined), { retries: 1 });
  await m.p.fetchBouts(); assert.deepEqual(m.sleeps, [5000]);
  m = make((n) => (n === 1 ? { status: 503, headers: { "retry-after": "99999" } } : undefined), { retries: 1 });
  await m.p.fetchBouts(); assert.deepEqual(m.sleeps, [120_000], "a vendor that asks for more than two minutes is given two minutes");
});

test("network failures: waited out with patience (10 s, 30 s ...), the run stops with 'the network looks down' when the patience ends; a body cut off in the middle is a network failure too", async () => {
  let m = make((n) => (n <= 2 ? { throws: new TypeError("fetch failed") } : undefined), { patienceMs: 600_000 });
  assert.ok((await m.p.fetchBouts()).length > 100); assert.deepEqual(m.sleeps, [10_000, 30_000]);
  m = make(() => ({ throws: new TypeError("fetch failed") }), { patienceMs: 100_000 });
  await assert.rejects(m.p.fetchBouts(), (e) => e instanceof NetworkError && /network looks down/.test(e.message)); assert.deepEqual(m.sleeps, [10_000, 30_000, 60_000]);
  m = make((n) => (n === 1 ? { cutBody: true } : undefined), { retries: 1 });
  assert.ok((await settles(m.p.fetchBouts())).length > 100, "a page cut off in the middle is fetched again"); assert.deepEqual(m.sleeps, [1000]);
  m = make((n) => (n === 1 ? { cutBody: true } : undefined), { patienceMs: 600_000 });
  assert.ok((await settles(m.p.fetchBouts())).length > 100); assert.deepEqual(m.sleeps, [10_000], "and waited out like an outage when the run has patience");
  m = make(() => ({ cutBody: true }));
  await assert.rejects(m.p.fetchBouts(), /unreachable on \/v2\/fights\/.*terminated/);
});

test("a vendor that accepts the request and never answers: the request times out instead of hanging the night for ever", async () => {
  const m = make((n) => (n === 1 ? { hang: true } : undefined), { retries: 1, timeoutMs: 200 });
  assert.ok((await settles(m.p.fetchBouts(), 3000)).length > 100); assert.deepEqual(m.sleeps, [1000], "timed out, waited, tried again");
  const dead = make(() => ({ hang: true }), { retries: 0, timeoutMs: 100 });
  await assert.rejects(settles(dead.p.fetchBouts(), 3000), /unreachable on \/v2\/fights\/.*(timeout|timed out|aborted)/i);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// 7. the site while the update runs, and the stale alarm

test("the running site keeps answering while the update runs (old data, then new on the version change, no error), and /api/health and the doctor go stale after 48 hours of failed nights and clear after a success", async () => {
  const site = process.env.DATABASE_PATH!;
  fs.copyFileSync(tpl, site);
  process.env.BOXING_PROVIDER = "licensed";
  const { getDb, dbVersion } = await import("../lib/db");
  const { GET } = await import("../app/api/health/route");
  const { latestUpdate } = await import("../lib/freshness");
  const { fileFindings } = await import("../lib/doctor");
  const errors: unknown[][] = [], logged = console.error;
  console.error = (...a: unknown[]) => { errors.push(a); };
  try {
    const db = await getDb();
    const health = async () => { const r = await GET(); return { http: r.status, ...(await r.json()) as { status: string; bouts: number; fighters: number; data: { updatedAt: string | null; ageHours: number | null; stale: boolean | null } } }; };
    const old = await health();
    assert.equal(old.http, 200);
    const version0 = dbVersion(db);

    // the update runs against the same file the site has open, slowly
    const v = await serveFaulty(w1, { fault: (c) => (c.path.startsWith("/v2/fighters/") && c.nth % 6 === 0 ? { delayMs: 120 } : undefined) });
    const run = start([...UPDATE, "--cache-dir", path.join(work, "cache-site")], { db: site, url: v.url, lockDir: path.join(work, "lock-site") });
    let done = false; const ended = run.wait().then((r) => { done = true; return r; });
    const seen = new Set<number>(); let probes = 0;
    while (!done) { const h = await health(); probes++; assert.equal(h.http, 200); seen.add(h.bouts); await nap(10); }
    const r = await ended; await v.close();
    assert.equal(r.code, 0, r.out);
    assert.ok(probes > 3, `the site was asked ${probes} times while the update ran`);
    assert.ok([...seen].every((n) => n === old.bouts || n === old.bouts + 1), `only the old or the new count was ever served: ${[...seen]}`);
    // the site keeps showing the old data until the update has settled (lib/world.ts, RINGSIDE_WORLD_SETTLE_MS), then shows the new, with no restart
    let fresh = await health();
    for (const t0 = Date.now(); fresh.bouts !== old.bouts + 1 && Date.now() - t0 < 60_000; ) { await nap(50); fresh = await health(); }
    assert.equal(fresh.bouts, old.bouts + 1, "the new data is picked up without a restart");
    assert.notEqual(dbVersion(db), version0, "because the version changed");
    assert.deepEqual(errors, [], "and nothing was logged as an error");

    // the nights after: the vendor is down, the command fails, the data does not move
    const T0 = Date.parse(latestUpdate(db)!.at);
    for (let night = 0; night < 2; night++) {
      const down = await serveFaulty(w1, { fault: () => ({ status: 503 }) });
      const f = await start([...UPDATE, "--cache-dir", path.join(work, "cache-site")], { db: site, url: down.url, lockDir: path.join(work, "lock-site") }).wait();
      await down.close();
      assert.equal(f.code, 2, f.out);
    }
    assert.equal(Date.parse(latestUpdate(db)!.at), T0, "failed nights record nothing");
    const probe = (): Parameters<typeof fileFindings>[1] => ({
      dir: () => ({ exists: true, writable: true }), file: () => false, newestBackup: () => null, freeBytes: () => null,
      db: (p: string) => (p.endsWith("accounts.db") ? { exists: false } : { exists: true, quickCheck: "ok", tables: ["boxers", "events", "bouts"], rows: { boxers: 60, events: 100, bouts: 170 }, lastUpdate: latestUpdate(db) }),
    }) as Parameters<typeof fileFindings>[1];
    const stale = (hours: number) => { const at = new Date(T0 + hours * 3_600_000); process.env.RINGSIDE_NOW = at.toISOString(); return at; };
    const doctor = (at: Date) => fileFindings({ BOXING_PROVIDER: "licensed", DATABASE_PATH: site }, probe(), { now: at, production: true }).filter((x) => x.id === "stale-data");
    for (const [hours, wantStale] of [[1, false], [24, false], [47.9, false], [48.2, true], [72, true]] as const) {
      const at = stale(hours), h = await health();
      assert.equal(h.http, 200, "stale is never a 503");
      assert.equal(h.data.stale, wantStale, `${hours} h after the last good update`);
      assert.equal(h.data.updatedAt, new Date(T0).toISOString());
      assert.deepEqual(doctor(at).map((x) => x.level), [wantStale ? "warn" : "ok"], `the doctor at ${hours} h`);
    }
    const warn = doctor(stale(72))[0];
    assert.match(warn.message, /last updated 3 days ago/);

    // a night that works clears it
    const good = await serveFaulty(w1);
    const ok = await start([...UPDATE, "--cache-dir", path.join(work, "cache-site")], { db: site, url: good.url, lockDir: path.join(work, "lock-site") }).wait();
    await good.close();
    assert.equal(ok.code, 0, ok.out);
    const T1 = Date.parse(latestUpdate(db)!.at);
    assert.ok(T1 > T0);
    process.env.RINGSIDE_NOW = new Date(T1 + 3_600_000).toISOString();
    const cleared = await health();
    assert.deepEqual([cleared.data.stale, cleared.data.updatedAt], [false, new Date(T1).toISOString()]);
    assert.deepEqual(doctor(new Date(T1 + 3_600_000)).map((x) => x.level), ["ok"]);
  } finally { console.error = logged; process.env.RINGSIDE_NOW = DAY1; delete process.env.BOXING_PROVIDER; }
});

test("a machine whose clock was wrong when the update ran (years ahead) cannot hide a dead nightly job: the stamp in the future counts as stale, and the doctor says the clock is wrong", async () => {
  const k = copyDb(tpl, "skew"), v = await serveFaulty(w1);
  const year = 365 * 86_400_000;
  const r = await start([...UPDATE, "--cache-dir", path.join(k.dir, "cache")], { db: k.db, url: v.url, lockDir: k.lockDir, extra: { UF_SKEW_MS: String(20 * year), NODE_OPTIONS: `--import ${path.join(ROOT, "tests", "update-failures-skew.mjs")}` } }).wait();
  await v.close();
  assert.equal(r.code, 0, r.out);
  const { latestUpdate, dataAge } = await import("../lib/freshness");
  const { fileFindings } = await import("../lib/doctor");
  const db = open(k.db);
  try {
    const last = latestUpdate(db)!, now = Date.now();
    assert.ok(Date.parse(last.at) > now + 19 * year, "the run stamped itself with the machine's wrong date");
    assert.equal(dataAge(last.at, now)!.stale, true, "a date that has not happened yet is not 'fresh'");
    const probe = { dir: () => ({ exists: true, writable: true }), file: () => false, newestBackup: () => null, freeBytes: () => null, db: (p: string) => (p.endsWith("accounts.db") ? { exists: false } : { exists: true, quickCheck: "ok", tables: ["boxers", "events", "bouts"], rows: { boxers: 60, events: 100, bouts: 170 }, lastUpdate: last }) } as Parameters<typeof fileFindings>[1];
    const f = fileFindings({ BOXING_PROVIDER: "licensed", DATABASE_PATH: k.db }, probe, { now: new Date(now), production: true }).filter((x) => x.id === "stale-data");
    assert.deepEqual(f.map((x) => x.level), ["warn"]);
    assert.match(f[0].message, /clock/i);
  } finally { db.close(); fs.rmSync(k.dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// the exit codes, the clock message and the end-of-run summary, as functions (the commands above prove them end to end)

test("exit codes: 2 the vendor is unreachable or refused, 3 a check refused the data, 75 the lock is held, everything else 1", () => {
  assert.equal(exitCodeFor(new HttpError("Boxing Data API 403 on /v2/fights/: Invalid API key", 403)), 2);
  assert.equal(exitCodeFor(new NetworkError("unreachable for 10 minute(s)")), 2);
  assert.equal(exitCodeFor(new BudgetError("Stopped after 5 requests")), 2);
  assert.equal(exitCodeFor(new Error("Boxing Data API unreachable on /v2/fights/: fetch failed (ECONNREFUSED)")), 2);
  assert.equal(exitCodeFor(new CheckRefusedError("The validator found 3 error(s)")), 3);
  for (const m of ["sent something that is not JSON on /v2/fights/: <html>", "sent an unexpected answer on /v2/fights/", "error on /v2/fights/: {}", "changed shape on /v2/fights/", "returned no usable fights for a to b"]) assert.equal(exitCodeFor(new Error(`Boxing Data API ${m}`)), 3, m);
  assert.equal(exitCodeFor(new LockHeldError("Another backfill is already running")), 75);
  for (const e of [new Error("There is nothing to update yet"), new Error("Set BOXING_API_KEY"), "a string", null, new TypeError("x is not a function")]) assert.equal(exitCodeFor(e), 1);
});

test("nothing to update: an empty database says run the backfill; a clock behind the newest card says both dates and asks if the clock is right", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE events (id INTEGER PRIMARY KEY, date TEXT, status TEXT)");
  assert.match(describeNothingToUpdate(db, "2026-10-04"), /no completed card\. Run the backfill first/);
  db.exec("INSERT INTO events (date, status) VALUES ('2026-12-01', 'cancelled')");
  assert.match(describeNothingToUpdate(db, "2026-10-04"), /no completed card/, "a cancelled card does not count");
  db.exec("INSERT INTO events (date, status) VALUES ('2026-09-20', NULL)");
  const m = describeNothingToUpdate(db, "2020-01-01");
  assert.match(m, /newest card in the database is dated 2026-09-20 and today is 2020-01-01 on this machine, so the newest card is \d+ day\(s\) in the future\. Is this machine's clock right\?/);
  db.close();
});

test("the end-of-run summary: one line naming what an update skipped or ignored, nothing when every counter is zero", () => {
  assert.equal(skippedSummary({}), null);
  assert.equal(skippedSummary({ fightsSkipped: 0, textCleaned: 0, divisionUnknown: 9, nationalityUnplaced: 4 }), null, "an approximation is not a skip");
  const line = skippedSummary({ fightsSkipped: 3, fightsSkippedUnreadable: 1, textCleaned: 2, outcomeUnreadable: 4, careerTotalImplausible: 1, finishedInFuture: 1 })!;
  assert.ok(!line.includes("\n"));
  for (const re of [/3 fight\(s\) skipped \(a field missing\)/, /1 fight\(s\) skipped as unreadable/, /2 text\(s\) cleaned/, /4 result\(s\) kept as unsettled/, /1 implausible career total/, /1 result\(s\) dropped/, /see "approximated or skipped" above/]) assert.match(line, re);
});
