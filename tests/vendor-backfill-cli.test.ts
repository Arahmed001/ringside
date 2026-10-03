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
const KEY = "sk-cli-test-key";
const TODAY = "2026-10-03";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "bda-cli-"));
after(() => fs.rmSync(root, { recursive: true, force: true }));

const fighter = (id: string, name: string, division: string) => ({
  id, name, gender: "m", birth_year: 1995, nationality: "Denmark", stance: "orthodox", debut: "2015", height_cm: 180, reach_cm: null, reach_in: 71,
  division: { id: "d", name: division, weight_lb: 147 }, stats: { wins: 10, losses: 1, draws: 0, total_bouts: 11 },
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

const state = { g3Finished: false, failing: new Set<string>(), requests: [] as string[] };
const fights = () => [
  fight("g1", "f1", "f2", "2026-08-15"),
  fight("g2", "f3", "f4", "2026-09-05", { results: { outcome: "KO", round: "3" }, division: { name: "Lightweight" } }),
  state.g3Finished ? fight("g3", "f3", "f1", "2026-10-02", { division: { name: "Lightweight" } }) : pending("g3", "f3", "f1", "2026-10-02"), // past, no result in yet
];
const upcoming = () => [pending("g4", "f5", "f6", "2026-10-20")];

let server: http.Server, url = "";
before(async () => {
  server = http.createServer((req, res) => {
    const u = new URL(req.url!, "http://x"), p = u.pathname;
    state.requests.push(p);
    const send = (status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    const env = (data: unknown) => ({ metadata: {}, pagination: { page: 1, total_pages: 1, next_page: null }, error: {}, data });
    if (req.headers["x-rapidapi-key"] !== KEY) return send(403, { message: "Invalid API key." });
    const from = u.searchParams.get("date_from"), to = u.searchParams.get("date_to");
    if (p === "/v2/fights/") {
      if (from && !to) return send(400, { code: "InvalidDateRange", message: "date_from must be earlier than or equal to date_to and in format YYYY-MM-DD" });
      return send(200, env(fights().filter((f) => (!from || f.event.date.slice(0, 10) >= from) && (!to || f.event.date.slice(0, 10) <= to))));
    }
    if (p === "/v2/fights/schedule") return send(200, env(upcoming()));
    const m = p.match(/^\/v2\/fighters\/(.+)$/);
    if (m && state.failing.has(m[1])) return send(500, { message: "upstream hiccup" });
    if (m && FIGHTERS[m[1]]) return send(200, env(FIGHTERS[m[1]]));
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
      env: { ...process.env, BOXING_API_KEY: KEY, BOXING_API_URL: url, RINGSIDE_NOW: TODAY, BOXING_API_STORAGE_CONFIRMED: undefined, BOXING_PROVIDER: undefined, ...env }, cwd: process.cwd(),
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d)); child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ code, out }));
  });
}
const seen = (part: string) => state.requests.filter((r) => r.includes(part)).length;
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

test("--check fetches into the cache and reports the validator, and never opens the database", async () => {
  const m = mark();
  const r = await run(["--check", "--cache-dir", cache], live);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /fetched: 6 fighters, 4 events, 4 bouts; 8 request\(s\) made, 0 answered from the cache/); // the list, the schedule (the list had no coming fight) and six fighters
  assert.match(r.out, /validator: 0 error\(s\)/); assert.match(r.out, /--check: the database was not touched/);
  assert.ok(!fs.existsSync(dbFile), "no database file");
  assert.equal(fs.readdirSync(cache).length, 8, "every answer is kept");
  assert.equal(since(m).length, 8);
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
  assert.equal(failed.code, 1);
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

test("--update is the daily job: it sees today's result (list pages are never reused), reuses cached fighters, and a late result replaces 'no result yet'", async () => {
  state.g3Finished = true;
  const m = mark();
  const r = await run(["--update", "--cache-dir", cache], live);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /updating from 2026-09-18/, "the latest card in the database (2026-10-02) less 14 days");
  assert.deepEqual(since(m), ["/v2/fights/", "/v2/fights/schedule"], "the list and the coming weeks; every fighter came from the cache");
  const db = new DatabaseSync(dbFile, { readOnly: true });
  assert.equal(count(db, "SELECT COUNT(*) c FROM bouts WHERE external_id = 'bda-b-g3' AND method = 'UD' AND winner_id = (SELECT id FROM boxers WHERE external_id = 'bda-f-f3')"), 1, "the late result is in");
  assert.equal(count(db, "SELECT COUNT(*) c FROM bouts"), 4, "and nothing was duplicated");
  db.close();
  const m2 = mark();
  const again = await run(["--update", "--cache-dir", cache], live);
  assert.equal(again.code, 0, again.out);
  assert.deepEqual(since(m2), ["/v2/fights/", "/v2/fights/schedule"], "a second update asks again: yesterday's cached list would hide today's results");
});

test("--update on an empty database says to backfill first, and loads nothing", async () => {
  const db3 = path.join(root, "third.db");
  const r = await run(["--update", "--cache-dir", path.join(root, "cache3")], { DATABASE_PATH: db3, BOXING_API_STORAGE_CONFIRMED: "1" });
  assert.equal(r.code, 1);
  assert.match(r.out, /nothing to update yet: the database has no completed card\. Run the backfill first/);
});

test("a wrong key stops the run with the vendor's own message, and never prints the key", async () => {
  const r = await run(["--plan"], { BOXING_API_KEY: "wrong-key-value-xyz" });
  assert.equal(r.code, 1);
  assert.match(r.out, /403 on \/v2\/fights\/: Invalid API key\./); assert.ok(!r.out.includes("wrong-key-value-xyz"));
});
