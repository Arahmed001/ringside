import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

/**
 * `npm run vendor:backfill` end to end: the real command, a real local HTTP server standing in for the vendor's API (so nothing leaves the
 * machine and no key is needed), and a real database file. It covers what the runbook promises: a plan that writes nothing, a refusal until
 * storage is confirmed, a resumable fetch, a refusal to mix the feed into another league, a backup before writing into a database that has
 * data, and a daily update that picks up a result that arrived late.
 */
const KEY = "sk-cli-test-key-0123456789abcdef0123456789";
const TODAY = "2026-10-03";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "bda-cli-"));
process.env.RINGSIDE_LOCK_DIR = path.join(root, "locks"); // the one-run-per-key lock lives with this test, not in the shared temp directory
after(() => fs.rmSync(root, { recursive: true, force: true }));

const fighter = (id: string, name: string, division: string) => ({
  id, name, gender: "m", birth_year: 1995, nationality: "Denmark", stance: "orthodox", debut: "2015", height_cm: 180, reach_cm: null, reach_in: 71,
  division: { id: "d", name: division, weight_lb: 147 },
});
const FIGHTERS: Record<string, ReturnType<typeof fighter>> = Object.fromEntries([
  ["f1", "Ace One", "Welterweight"], ["f2", "Bo Two", "Welterweight"], ["f3", "Cy Three", "Lightweight"], ["f4", "Di Four", "Lightweight"], ["f5", "Ed Five", "Welterweight"], ["f6", "Fy Six", "Welterweight"],
].map(([id, name, div]) => [id, fighter(id, name, div)]));
const fight = (id: string, a: string, b: string, date: string, over: Record<string, unknown> = {}) => ({
  id, title: `${a} vs ${b}`, date: `${date}T02:00:00`, venue: "Arena", location: "Aarhus, Denmark", scheduled_rounds: 10, status: "FINISHED",
  fighters: { fighter_1: { fighter_id: a, name: a, full_name: a, winner: true }, fighter_2: { fighter_id: b, name: b, full_name: b, winner: false } },
  results: { outcome: "UD", round: null }, event: { id: `e-${id}`, title: `Card ${id}`, date: `${date}T00:00:00`, location: "Aarhus, Denmark", venue: "Arena" },
  division: { name: "Welterweight" }, titles: [], ...over,
});
const pending = (id: string, a: string, b: string, date: string) => fight(id, a, b, date, { status: "NOT_STARTED", results: null, fighters: { fighter_1: { fighter_id: a, name: a, full_name: a, winner: false }, fighter_2: { fighter_id: b, name: b, full_name: b, winner: false } } });

const state = { limited: null as string | null, g3Finished: false, failing: new Set<string>(), requests: [] as string[], skew: {} as Record<string, { wins?: number; losses?: number; draws?: number }> };
const fights = () => [
  fight("g1", "f1", "f2", "2026-08-15"),
  fight("g2", "f3", "f4", "2026-09-05", { results: { outcome: "KO", round: "3" }, division: { name: "Lightweight" } }),
  state.g3Finished ? fight("g3", "f3", "f1", "2026-10-02", { division: { name: "Lightweight" } }) : pending("g3", "f3", "f1", "2026-10-02"), // past, no result in yet
];
const upcoming = () => [pending("g4", "f5", "f6", "2026-10-20")];

/** The career record the vendor would state: what the finished fights it serves give, plus any injected skew (a missing fight, a wrong total). */
const careerOf = (id: string) => {
  const s = { wins: 0, losses: 0, draws: 0 };
  for (const f of fights()) {
    if (f.status !== "FINISHED") continue;
    const a = f.fighters.fighter_1, b = f.fighters.fighter_2;
    if (a.fighter_id !== id && b.fighter_id !== id) continue;
    if ((a.fighter_id === id && a.winner) || (b.fighter_id === id && b.winner)) s.wins++; else s.losses++;
  }
  const k = state.skew[id] ?? {};
  const out = { wins: s.wins + (k.wins ?? 0), losses: s.losses + (k.losses ?? 0), draws: s.draws + (k.draws ?? 0) };
  return { ...out, total_bouts: out.wins + out.losses + out.draws };
};

let server: http.Server, url = "";
before(async () => {
  server = http.createServer((req, res) => {
    const u = new URL(req.url!, "http://x"), p = u.pathname;
    state.requests.push(p);
    const send = (status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    const env = (data: unknown) => ({ metadata: {}, pagination: { page: 1, total_pages: 1, next_page: null }, error: {}, data });
    if (req.headers["x-rapidapi-key"] !== KEY) return send(403, { message: "Invalid API key." });
    if (state.limited && p.startsWith("/v2/")) return send(429, { message: state.limited }); // the gateway refusing, as the real one did: a JSON message and no Retry-After
    const from = u.searchParams.get("date_from"), to = u.searchParams.get("date_to");
    if (p === "/v2/fights/") {
      if (from && !to) return send(400, { code: "InvalidDateRange", message: "date_from must be earlier than or equal to date_to and in format YYYY-MM-DD" });
      return send(200, env(fights().filter((f) => (!from || f.event.date.slice(0, 10) >= from) && (!to || f.event.date.slice(0, 10) <= to))));
    }
    if (p === "/v2/fights/schedule") return send(200, env(upcoming()));
    if (p === "/v2/rankings/") return send(200, env([])); // the official lists: this little league has none (the adapter's own tests cover them), but asking costs a request like any other
    const m = p.match(/^\/v2\/fighters\/(.+)$/);
    if (m && state.failing.has(m[1])) return send(500, { message: "upstream hiccup" });
    if (m && FIGHTERS[m[1]]) return send(200, env({ ...FIGHTERS[m[1]], stats: careerOf(m[1]) }));
    send(404, { message: "not found" });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
after(() => server.close());

type Out = { code: number | null; out: string };
function run(args: string[], env: Record<string, string | undefined>): Promise<Out> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--import", "tsx", "scripts/vendor-backfill.ts", "--gap-ms", "0", ...args], {
      env: { ...process.env, BOXING_API_KEY: KEY, BOXING_API_URL: url, RINGSIDE_NOW: TODAY, BOXING_API_STORAGE_CONFIRMED: undefined, BOXING_PROVIDER: undefined, VENDOR_RANKINGS_CONFIRMED: "1", ...env }, cwd: process.cwd(),
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d)); child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ code, out }));
  });
}
const mark = () => state.requests.length;
const since = (n: number) => state.requests.slice(n);

const dbFile = path.join(root, "real.db"), cache = path.join(root, "cache");
const live = { DATABASE_PATH: dbFile, BOXING_API_STORAGE_CONFIRMED: "1" };
const count = (db: DatabaseSync, sql: string) => (db.prepare(sql).get() as { c: number }).c;

test("--plan reads the fight list, prices the fighters, and writes nothing: no cache, no database, and no storage warning because nothing is stored", async () => {
  const m = mark();
  const r = await run(["--plan"], { DATABASE_PATH: dbFile });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /fights 4, events 4, fighters 6/); assert.match(r.out, /fight list pages fetched to find out: 2 request\(s\)/); assert.match(r.out, /fighters still to fetch: 6 request\(s\)/); assert.match(r.out, /Nothing was written/);
  assert.equal(since(m).filter((p) => p.startsWith("/v2/fighters/")).length, 0, "no fighter was fetched to find out");
  assert.ok(!fs.existsSync(dbFile) && !fs.existsSync(cache));
  assert.doesNotMatch(r.out, /PROVISIONALLY/);
});

test("--plan with --cache-dir keeps the fight-list pages, so the --check that follows asks for no list page; storing switched off refuses it before anything is created", async () => {
  const dir = path.join(root, "cache-plan");
  const m = mark();
  const plan = await run(["--plan", "--cache-dir", dir], { DATABASE_PATH: dbFile });
  assert.equal(plan.code, 0, plan.out);
  assert.match(plan.out, /fights 4, events 4, fighters 6/);
  assert.match(plan.out, /PROVISIONALLY/, "keeping the pages is storing, and says so until storing is confirmed");
  assert.ok(fs.readdirSync(dir).some((f) => /fights/.test(f)), "the list pages are on disk");
  assert.ok(!fs.existsSync(dbFile), "still no database");
  const listAsked = since(m).filter((p) => p.startsWith("/v2/fights")).length;
  assert.ok(listAsked >= 2, "the plan paid for the list");
  const m2 = mark();
  const check = await run(["--check", "--cache-dir", dir], { DATABASE_PATH: dbFile, BOXING_API_STORAGE_CONFIRMED: "1" });
  assert.match(check.out, /fetched: 6 fighters/, check.out);
  assert.equal(since(m2).filter((p) => p.startsWith("/v2/fights")).length, 0, "the list came from the cache: not one list request");
  const off = path.join(root, "cache-plan-off");
  const refused = await run(["--plan", "--cache-dir", off], { DATABASE_PATH: dbFile, BOXING_API_STORAGE_CONFIRMED: "0" });
  assert.equal(refused.code, 1); assert.match(refused.out, /switched off/);
  assert.ok(!fs.existsSync(off), "nothing was created");
});

test("storing switched off (BOXING_API_STORAGE_CONFIRMED=0) refuses before anything is created: no cache, no empty database", async () => {
  const r = await run(["--cache-dir", cache], { DATABASE_PATH: dbFile, BOXING_API_STORAGE_CONFIRMED: "0" });
  assert.equal(r.code, 1);
  assert.match(r.out, /switched off \(BOXING_API_STORAGE_CONFIRMED=0\)/);
  assert.ok(!fs.existsSync(cache) && !fs.existsSync(dbFile));
});

test("by default it stores provisionally and says so; once confirmed (=1) the warning goes", async () => {
  const dir = path.join(root, "cache-provisional");
  const r = await run(["--check", "--cache-dir", dir], { DATABASE_PATH: dbFile });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /PROVISIONALLY: it has not yet confirmed in writing that stored data may be kept/);
  assert.ok(fs.existsSync(dir) && fs.readdirSync(dir).length > 0, "it did store: that is the default now");
  const confirmed = await run(["--check", "--cache-dir", dir], { DATABASE_PATH: dbFile, BOXING_API_STORAGE_CONFIRMED: "1" });
  assert.equal(confirmed.code, 0, confirmed.out);
  assert.doesNotMatch(confirmed.out, /PROVISIONALLY/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("without VENDOR_RANKINGS_CONFIRMED the official lists are not asked for: no request to the endpoint, and the run says so", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ringside-held-"));
  try {
    const m = mark();
    const r = await run(["--check", "--cache-dir", dir], { ...live, VENDOR_RANKINGS_CONFIRMED: undefined });
    assert.equal(r.code, 0, r.out);
    assert.ok(!since(m).includes("/v2/rankings/"), "the endpoint was never asked");
    assert.match(r.out, /official rankings: left out until VENDOR_RANKINGS_CONFIRMED=1/);
    assert.match(r.out, /rankingsHeldBack\s+1/);
    assert.match(r.out, /8 request\(s\) made/, "one request fewer than with the lists");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("--check fetches into the cache and reports the validator, and never opens the database", async () => {
  const m = mark();
  const r = await run(["--check", "--cache-dir", cache], live);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /fetched: 6 fighters, 4 events, 4 bouts; 9 request\(s\) made, 0 answered from the cache, \d+\.\d MB downloaded/); // the list, the schedule (the list had no coming fight) and six fighters
  assert.match(r.out, /validator: 0 error\(s\)/); assert.match(r.out, /--check: the database was not touched/);
  assert.match(r.out, /records: 6 of 6 fighters \(100\.0%\) have loaded fights that add up exactly to the vendor's career record/);
  assert.doesNotMatch(r.out, /a load would be refused/);
  assert.ok(!fs.existsSync(dbFile), "no database file");
  assert.equal(fs.readdirSync(cache).length, 9, "every answer is kept (the list, the schedule, six fighters and the official lists)");
  assert.equal(since(m).length, 9);
});

test("the load itself: it needs no new requests (everything was cached), writes the league with ratings, and leaves a late result as 'no result yet'", async () => {
  const m = mark();
  const r = await run(["--cache-dir", cache], live);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /loaded: .*boxers 6.*bouts 4/); assert.match(r.out, /8 answered from the cache|0 request\(s\) made/);
  assert.equal(since(m).length, 0, "not one request: the check had already fetched it all");
  assert.doesNotMatch(r.out, /backed up/, "an empty database has nothing to back up");
  const db = new DatabaseSync(dbFile, { readOnly: true });
  assert.equal(count(db, "SELECT COUNT(*) c FROM boxers"), 6); assert.equal(count(db, "SELECT COUNT(*) c FROM bouts"), 4); assert.equal(count(db, "SELECT COUNT(*) c FROM events"), 4);
  assert.ok(count(db, "SELECT COUNT(*) c FROM boxers WHERE rating != 1500") > 0, "ratings were recomputed");
  assert.equal(count(db, "SELECT reach_cm c FROM boxers WHERE external_id = 'bda-f-f1'"), 180, "71 inches, read from reach_in");
  assert.equal(count(db, "SELECT COUNT(*) c FROM bouts WHERE external_id = 'bda-b-g3' AND winner_id IS NULL AND method IS NULL"), 1, "the card with no result yet stays without one");
  assert.equal(count(db, "SELECT COUNT(*) c FROM bouts WHERE external_id = 'bda-b-g1' AND winner_id = (SELECT id FROM boxers WHERE external_id = 'bda-f-f1')"), 1);
  db.close();
});

test("loading again is safe: the same league, updated in place, and still no requests", async () => {
  const m = mark();
  const r = await run(["--cache-dir", cache], live);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /already holds 6 fighters from this feed/);
  assert.equal(since(m).length, 0);
  const db = new DatabaseSync(dbFile, { readOnly: true });
  assert.deepEqual([count(db, "SELECT COUNT(*) c FROM boxers"), count(db, "SELECT COUNT(*) c FROM bouts")], [6, 4]);
  db.close();
});

test("it will not load the feed into a database that holds somebody else's fighters, and with --into-existing it backs the database up first", async () => {
  const backupDirs = () => (fs.existsSync(path.join(root, "backups")) ? fs.readdirSync(path.join(root, "backups")).sort() : []);
  const w = new DatabaseSync(dbFile);
  w.exec("INSERT INTO boxers (external_id, slug, name, country, birth_year, stance, height_cm, reach_cm, weight_class, turned_pro, active) VALUES ('demo-1', 'demo-one', 'Demo One', 'Mexico', 1990, 'Orthodox', 175, 175, 'Welterweight', 2010, 1)");
  w.close();
  try {
    const before = backupDirs();
    const refused = await run(["--cache-dir", cache], live);
    assert.equal(refused.code, 1);
    assert.match(refused.out, /already holds 1 fighter\(s\) that did not come from this feed \(for example Demo One\)/);
    assert.deepEqual(backupDirs(), before, "a refusal backs up nothing and changes nothing");
    const ok = await run(["--cache-dir", cache, "--into-existing"], live);
    assert.equal(ok.code, 0, ok.out);
    assert.match(ok.out, /backed up the database first: /);
    const after = backupDirs();
    assert.equal(after.length, before.length + 1, "one new backup");
    const copy = new DatabaseSync(path.join(root, "backups", after[after.length - 1], "ringside.db"), { readOnly: true });
    assert.equal(count(copy, "SELECT COUNT(*) c FROM boxers WHERE external_id = 'demo-1'"), 1, "the backup is of the database as it was before the load");
    copy.close();
  } finally {
    const w2 = new DatabaseSync(dbFile); w2.exec("DELETE FROM boxers WHERE external_id = 'demo-1'"); w2.close();
  }
});

test("every load into a database that has data is backed up first, so the daily update leaves a rolling set of backups (the last 14)", async () => {
  const before = fs.readdirSync(path.join(root, "backups")).length;
  const r = await run(["--cache-dir", cache], live);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /backed up the database first: /);
  assert.equal(fs.readdirSync(path.join(root, "backups")).length, before + 1);
  const off = await run(["--cache-dir", cache, "--no-backup"], live);
  assert.equal(off.code, 0, off.out);
  assert.doesNotMatch(off.out, /backed up/); assert.equal(fs.readdirSync(path.join(root, "backups")).length, before + 1, "--no-backup skips it");
});

test("a fighter that cannot be fetched stops the load with the cure; the next run retries only that fighter", async () => {
  const cache2 = path.join(root, "cache2"), db2 = path.join(root, "second.db");
  const env = { DATABASE_PATH: db2, BOXING_API_STORAGE_CONFIRMED: "1" };
  state.failing.add("f4");
  const failed = await run(["--cache-dir", cache2, "--retries", "0"], env);
  assert.equal(failed.code, 3);
  assert.match(failed.out, /fighter f4 skipped: Boxing Data API 500/); assert.match(failed.out, /left out because a fighter could not be fetched/); assert.match(failed.out, /Run the same command again/);
  const empty = new DatabaseSync(db2, { readOnly: true });
  assert.equal(count(empty, "SELECT COUNT(*) c FROM boxers"), 0, "nothing was loaded");
  empty.close();

  state.failing.delete("f4");
  const m = mark();
  const again = await run(["--cache-dir", cache2, "--retries", "0"], env);
  assert.equal(again.code, 0, again.out);
  assert.deepEqual(since(m), ["/v2/fighters/f4"], "exactly the one request that never completed");
  const db = new DatabaseSync(db2, { readOnly: true });
  assert.deepEqual([count(db, "SELECT COUNT(*) c FROM boxers"), count(db, "SELECT COUNT(*) c FROM bouts")], [6, 4]);
  db.close();
});

test("--update is the daily job: it sees today's result and fresh career records (nothing is reused from the cache), and a late result replaces 'no result yet'", async () => {
  state.g3Finished = true;
  const m = mark();
  const r = await run(["--update", "--cache-dir", cache], live);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /updating from 2026-09-18/, "the latest card in the database (2026-10-02) less 14 days");
  assert.deepEqual(since(m), ["/v2/fights/", "/v2/fights/schedule", "/v2/fighters/f3", "/v2/fighters/f1", "/v2/rankings/"], "the list, the coming weeks, then only the fighters of the fight that CHANGED (the late result: f3 and f1), fresh; the coming fight (f5, f6) is already loaded and unchanged, so it is not fetched again; then the official lists: a cached record predates the result and a cached list the body's latest change");
  assert.match(r.out, /after the update:\nrecords: 2 of 2 fighters \(100.0%\)/, `the careers of the two fighters whose fight changed, as the database now has them, checked against the vendor's totals: ${r.out.slice(r.out.indexOf("after the update"))}`);
  const db = new DatabaseSync(dbFile, { readOnly: true });
  assert.equal(count(db, "SELECT COUNT(*) c FROM bouts WHERE external_id = 'bda-b-g3' AND method = 'UD' AND winner_id = (SELECT id FROM boxers WHERE external_id = 'bda-f-f3')"), 1, "the late result is in");
  assert.equal(count(db, "SELECT COUNT(*) c FROM bouts"), 4, "and nothing was duplicated");
  db.close();
  const m2 = mark();
  const again = await run(["--update", "--cache-dir", cache], live);
  assert.equal(again.code, 0, again.out);
  assert.deepEqual(since(m2), ["/v2/fights/", "/v2/fights/schedule", "/v2/rankings/"], "a second update with nothing new asks for the lists (yesterday's cached answers would hide today's results) and fetches no fighter at all");
  assert.match(again.out, /2 of 2 listed fights are already loaded and unchanged: left out, with their fighters; 0 new or changed/);
  // a fighter whose saved record is more than a week old is fetched again even when nothing about the fights changed (a profile change never shows in a fight)
  const stale = path.join(cache, "v2-fighters-f5.json"), old = new Date(Date.now() - 8 * 86_400_000);
  assert.ok(fs.existsSync(stale), "the saved record of f5 (the file name is the endpoint with its slashes turned into dashes)");
  fs.utimesSync(stale, old, old);
  const mAge = mark();
  const aged = await run(["--update", "--cache-dir", cache], live);
  assert.equal(aged.code, 0, aged.out);
  assert.deepEqual(since(mAge), ["/v2/fights/", "/v2/fights/schedule", "/v2/fighters/f5", "/v2/fighters/f6", "/v2/rankings/"], "the coming fight's two fighters are fetched again because one record is 8 days old; nothing else is");
  assert.match(aged.out, /1 unchanged but a fighter's saved record is more than 7 days old/);
  const m3 = mark();
  const all = await run(["--update", "--refetch-all", "--cache-dir", cache], live);
  assert.equal(all.code, 0, all.out);
  assert.equal(since(m3).length, 7, "--refetch-all brings back the old behaviour: every fighter in the window again");
});

test("--update's audit tells a total that trails yesterday's result (lagging) from a contradiction about an old fight (still a conflict); neither changes the data or the exit code", async () => {
  state.g3Finished = true;
  try {
    // the vendor has not yet counted g3 (2026-10-02, yesterday): Cy Three is 1 win short of the fights we hold, Ace One 1 loss
    state.skew = { f3: { wins: -1 }, f1: { losses: -1 } };
    const lag = await run(["--update", "--refetch-all", "--cache-dir", cache], live);
    assert.equal(lag.code, 0, lag.out);
    const after = lag.out.slice(lag.out.indexOf("after the update"));
    assert.match(after, /2 career total\(s\) probably lagging/); assert.match(after, /Cy Three loaded 2-0-0 vs vendor 1-0-0/); assert.ok(!/CONFLICT/.test(after), after);
    // the vendor contradicts an OLD fight (g1, 2026-08-15): Ace One has a win we hold and it has none
    state.skew = { f1: { wins: -1 } };
    const old = await run(["--update", "--refetch-all", "--cache-dir", cache], live);
    assert.equal(old.code, 0, old.out);
    assert.match(old.out.slice(old.out.indexOf("after the update")), /1 CONFLICT.*Ace One loaded 1-1-0 vs vendor 0-1-0/);
  } finally { state.skew = {}; }
});

test("--update on an empty database says to backfill first, and loads nothing", async () => {
  const db3 = path.join(root, "third.db");
  const r = await run(["--update", "--cache-dir", path.join(root, "cache3")], { DATABASE_PATH: db3, BOXING_API_STORAGE_CONFIRMED: "1" });
  assert.equal(r.code, 1);
  assert.match(r.out, /nothing to update yet: the database has no completed card\. Run the backfill first/);
});

test("a wrong key stops the run with the vendor's own message, and never prints the key", async () => {
  const r = await run(["--plan"], { BOXING_API_KEY: "wrong-key-value-xyz" });
  assert.equal(r.code, 2);
  assert.match(r.out, /403 on \/v2\/fights\/: Invalid API key\./); assert.ok(!r.out.includes("wrong-key-value-xyz"));
});

test("a pasted placeholder instead of the key (an ellipsis, a space) stops the run before any request, and says what to do", async () => {
  for (const bad of ["…", "...", "your key here"]) {
    const n = mark();
    const r = await run(["--plan"], { BOXING_API_KEY: bad });
    assert.equal(r.code, 1, bad);
    assert.match(r.out, /not a plausible API key/); assert.match(r.out, /read -s/);
    assert.equal(since(n).length, 0, `no request for ${JSON.stringify(bad)}`);
  }
});

test("a career the loaded fights do not add up to is refused: a partial history is not a clean one, so it needs a deliberate override or a lower bar", async () => {
  state.g3Finished = false;
  state.skew = { f1: { wins: 5 } }; // the vendor says Ace One has five more wins than the fights we can see
  const cache4 = path.join(root, "cache4"), db4 = path.join(root, "fourth.db");
  const env = { DATABASE_PATH: db4, BOXING_API_STORAGE_CONFIRMED: "1" };
  try {
    const check = await run(["--check", "--cache-dir", cache4], env);
    assert.equal(check.code, 1, "--check reports it as a failure too");
    assert.match(check.out, /records: 5 of 6 fighters \(83\.3%\)/); assert.match(check.out, /1 partial: fights are missing, so the page shows the vendor's career total with a note that fewer fights are held \(e\.g\. Ace One loaded 1-0-0 vs vendor 6-0-0\)/);
    assert.match(check.out, /a load would be refused/);

    const refused = await run(["--cache-dir", cache4], env);
    assert.equal(refused.code, 3);
    assert.match(refused.out, /Nothing was loaded, because only 83\.3% of fighters \(5 of 6\) have loaded fights that add up to the vendor's career record; 90% is required/);
    assert.match(refused.out, /hold fewer fights than the vendor's career total/); assert.match(refused.out, /--allow-partial loads anyway; --min-complete changes the bar/);
    const empty = new DatabaseSync(db4, { readOnly: true });
    assert.equal(count(empty, "SELECT COUNT(*) c FROM boxers"), 0, "nothing was written");
    empty.close();

    const m = mark();
    const lower = await run(["--cache-dir", cache4, "--min-complete", "0.8"], env);
    assert.equal(lower.code, 0, lower.out);
    assert.equal(since(m).length, 0, "the fetch was cached: deciding differently costs nothing");
    const db = new DatabaseSync(db4, { readOnly: true });
    assert.equal(count(db, "SELECT COUNT(*) c FROM boxers"), 6);
    db.close();
    const partial = await run(["--cache-dir", cache4, "--allow-partial"], env);
    assert.equal(partial.code, 0, partial.out);
  } finally { state.skew = {}; }
});

test("a career LOWER than the loaded fights is a contradiction in the feed itself: refused, and a lower bar does not excuse it", async () => {
  state.g3Finished = false;
  state.skew = { f1: { wins: -1, losses: 1 } }; // the vendor says Ace One has no wins and a loss, though a fight we hold says he won
  const cache5 = path.join(root, "cache5"), db5 = path.join(root, "fifth.db");
  const env = { DATABASE_PATH: db5, BOXING_API_STORAGE_CONFIRMED: "1" };
  try {
    const r = await run(["--cache-dir", cache5, "--min-complete", "0.5", "--allow-partial"], env);
    assert.equal(r.code, 3, "allowing partial records does not allow conflicts");
    assert.match(r.out, /1 CONFLICT: more than the vendor's own career total, so the feed contradicts itself \(e\.g\. Ace One loaded 1-0-0 vs vendor 0-1-0\)/);
    assert.match(r.out, /Nothing was loaded, because 1 fighter\(s\) have MORE wins, losses or draws in the loaded fights than the vendor's own career total/);
    const ok = await run(["--cache-dir", cache5, "--allow-conflicts", "--min-complete", "0.5"], env);
    assert.equal(ok.code, 0, ok.out);
  } finally { state.skew = {}; }
});

test("a plan's own hourly limit: --plan prices a paced run in the plan's terms; a refusal ends the run with the vendor's words; a used-up quota ends it at once", async () => {
  const paced = await run(["--plan", "--per-hour", "7200"], { DATABASE_PATH: dbFile }); // two list pages half a second apart: the flag paces the plan's own requests too
  assert.equal(paced.code, 0, paced.out);
  assert.match(paced.out, /fighters still to fetch: 6 request\(s\), about \d+ minute\(s\) at 7200 requests an hour/);
  const viaEnv = await run(["--plan"], { DATABASE_PATH: dbFile, BOXING_API_PER_HOUR: "7200" });
  assert.equal(viaEnv.code, 0, viaEnv.out);
  assert.match(viaEnv.out, /at 7200 requests an hour/, "BOXING_API_PER_HOUR does what --per-hour does");
  const flagWins = await run(["--plan", "--per-hour", "3600"], { DATABASE_PATH: dbFile, BOXING_API_PER_HOUR: "7200" });
  assert.match(flagWins.out, /at 3600 requests an hour/, "the flag wins over the environment");
  const bad = await run(["--plan", "--per-hour", "fast"], { DATABASE_PATH: dbFile });
  assert.equal(bad.code, 1); assert.match(bad.out, /--per-hour .* must be a number above 0, not "fast"/);
  const dir = path.join(root, "cache-limited");
  try {
    state.limited = "You have exceeded the rate limit per hour for your plan, MEGA, by the API provider";
    const hourly = await run(["--check", "--retries", "0", "--patience-min", "0", "--cache-dir", dir], { DATABASE_PATH: dbFile, BOXING_API_STORAGE_CONFIRMED: "1" });
    assert.equal(hourly.code, 2, hourly.out);
    assert.match(hourly.out, /rate limit per hour for your plan, MEGA, by the API provider/); assert.match(hourly.out, /--patience-min/); assert.doesNotMatch(hourly.out, /retry after unknown s\)\.$/m);
    state.limited = "You have exceeded the MONTHLY quota for Requests on your current plan, MEGA.";
    const started = Date.now();
    const quota = await run(["--check", "--patience-min", "90", "--cache-dir", dir], { DATABASE_PATH: dbFile, BOXING_API_STORAGE_CONFIRMED: "1" });
    assert.equal(quota.code, 2, quota.out);
    assert.match(quota.out, /quota used up/); assert.match(quota.out, /RapidAPI dashboard/);
    assert.doesNotMatch(quota.out, /waiting \d/);
    assert.ok(Date.now() - started < 60_000, "it did not wait");
  } finally { state.limited = null; }
});
