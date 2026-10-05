import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cacheState, describeStatus, keyState, runningBackfills } from "../lib/vendor-status";

/** `npm run vendor:status` (round 83): where a long fetch stands, from files on this machine only. */
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "vstatus-"));
const touch = (dir: string, name: string, agoMs = 0) => { const f = path.join(dir, name); fs.writeFileSync(f, "{}"); const t = new Date(Date.now() - agoMs); fs.utimesSync(f, t, t); };
const base = { cacheDir: "/c", running: [], key: { set: true, length: 50, placeholder: false }, storageConfirmed: "1", databasePath: "/db" };

test("the cache is counted by kind, with how many fighters arrived in the last hour and six, and a leftover temp file is not an answer", () => {
  const d = tmp();
  for (let i = 0; i < 3; i++) touch(d, `v2-fighters-a${i}.json`, 10 * 60_000);          // 10 minutes ago
  for (let i = 0; i < 2; i++) touch(d, `v2-fighters-b${i}.json`, 3 * 3_600_000);        // 3 hours ago
  touch(d, "v2-fighters-old.json", 30 * 3_600_000);
  touch(d, "v2-fights__date_from-1900-01-01__page_num-1.json"); touch(d, "v2-fights-schedule__days-60.json"); touch(d, "v2-rankings__page_num-1.json");
  touch(d, "v2-fighters-half.json.123.tmp");
  const c = cacheState(d);
  assert.deepEqual([c.fighters, c.listPages, c.rankingPages, c.staleTemp, c.fightersLastHour, c.fightersLast6Hours], [6, 2, 1, 1, 3, 5]);
  assert.ok(c.newest && Date.now() - c.newest.getTime() < 60_000, "the newest file is the temp one just written");
  assert.deepEqual(cacheState(path.join(d, "missing")), { fighters: 0, listPages: 0, rankingPages: 0, staleTemp: 0, newest: null, fightersLastHour: 0, fightersLast6Hours: 0 }, "a missing folder is an empty cache");
});

test("a running fetch is found by its lock; a lock whose process is gone is not a running fetch; the key is only described", () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, "ringside-backfill-aaaaaaaaaaaa.lock"), JSON.stringify({ pid: 111, startedAt: "2026-10-05T00:21:55.144Z", command: "--check --per-hour 400" }));
  fs.writeFileSync(path.join(d, "ringside-backfill-bbbbbbbbbbbb.lock"), JSON.stringify({ pid: 222, startedAt: "x", command: "" }));
  fs.writeFileSync(path.join(d, "ringside-backfill-cccccccccccc.lock"), "not json");
  fs.writeFileSync(path.join(d, "other.lock"), JSON.stringify({ pid: 111 }));
  assert.deepEqual(runningBackfills(d, (pid) => pid === 111).map((r) => r.pid), [111]);
  assert.deepEqual(runningBackfills(d, () => false), []);
  assert.deepEqual(keyState(undefined), { set: false, length: 0, placeholder: false });
  assert.equal(keyState("your-key-here").placeholder, true); assert.equal(keyState("paste-your-real-key-here").placeholder, true);
  assert.deepEqual(keyState("k".repeat(50)), { set: true, length: 50, placeholder: false });
  assert.ok(!JSON.stringify(keyState("sk-secret-secret-secret-secret-secret-12345")).includes("secret"), "the key never appears in what is reported");
});

test("the report says how long is left from the recent pace, and the next command fits the state", () => {
  const cache = { fighters: 11000, listPages: 477, rankingPages: 0, staleTemp: 0, newest: new Date("2026-10-05T06:00:00Z"), fightersLastHour: 380, fightersLast6Hours: 2280 };
  const running = describeStatus({ ...base, cache, total: 35000, running: [{ pid: 77155, startedAt: "2026-10-05T00:21:55.144Z", command: "--check" }] }).join("\n");
  assert.match(running, /11,000 fighters of 35,000 \(31\.4%\)/); assert.match(running, /24,000 to fetch: about 2\.6 days at 380 an hour/);
  assert.match(running, /fetch: RUNNING \(process 77155/); assert.match(running, /leave it running/); assert.doesNotMatch(running, /\(re\)start/);
  const idle = describeStatus({ ...base, cache, total: 35000 }).join("\n");
  assert.match(idle, /fetch: not running/); assert.match(idle, /\(re\)start the fetch, one run only, paced:.*--per-hour 400 --patience-min 240 --cache-dir \/c/);
  const nokey = describeStatus({ ...base, cache, total: 35000, key: { set: false, length: 0, placeholder: false } }).join("\n");
  assert.match(nokey, /key: NOT set in this terminal tab/); assert.match(nokey, /vendor:fetch -- --setup/);
  const fake = describeStatus({ ...base, cache, total: 35000, key: { set: true, length: 13, placeholder: true } }).join("\n");
  assert.match(fake, /looks like a placeholder/);
  const done = describeStatus({ ...base, cache: { ...cache, fighters: 35000 }, total: 35000 }).join("\n");
  assert.match(done, /every fighter in the fight list is in the cache/); assert.match(done, /the cache is complete: run the check, then follow docs\/real-data-runbook\.md section 2c/);
  // an hour that crawls inside a steady six: the estimate uses the six-hour pace, and the report says the fetch has slowed
  const crawl = describeStatus({ ...base, cache: { ...cache, fightersLastHour: 81, fightersLast6Hours: 1429 }, total: 35000, running: [{ pid: 1, startedAt: "2026-10-05T00:00:00Z", command: "" }] }).join("\n");
  assert.match(crawl, /about 4\.\d days at 238 an hour/); assert.match(crawl, /SLOWED: 81 fighters in the last hour against 238 an hour over six/); assert.match(crawl, /network error/);
  assert.doesNotMatch(describeStatus({ ...base, cache, total: 35000, running: [{ pid: 1, startedAt: "", command: "" }] }).join("\n"), /SLOWED/, "a steady pace is not reported as slowed");
  assert.doesNotMatch(describeStatus({ ...base, cache: { ...cache, fightersLastHour: 81, fightersLast6Hours: 1429 }, total: 35000 }).join("\n"), /SLOWED/, "nothing running: not slowed, just idle");
  const slow = describeStatus({ ...base, cache: { ...cache, fightersLastHour: 0, fightersLast6Hours: 0 }, total: 35000 }).join("\n");
  assert.match(slow, /at 400 an hour/, "with no recent pace the Mega plan's 400 an hour is assumed");
  assert.match(describeStatus({ ...base, cache, total: null }).join("\n"), /11,000 fighters, 477 fight-list pages/);
  assert.match(describeStatus({ ...base, cache, total: 35000, storageConfirmed: undefined, databasePath: undefined }).join("\n"), /not set \(storing is on[\s\S]*database: not set/);
});
