import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { diagnose, type Finding, type Probe } from "../lib/doctor";
import { tempDb } from "./helpers";
import { makeLeague, makeTemplate, makeVolume, readStatusFile, serveFaulty, startNightly, tmp } from "./nightly-helpers";
import { nextDay } from "./update-failures-helpers";

/**
 * Step E2 of the vendor gate: how a queue nobody reads shows (health, doctor), the first night of holding without a flag to remember, and what the nightly job says about it.
 */
process.env.RINGSIDE_NO_SEED = "1";
const cleanup = tempDb("vendor-gate-e2"); // pins the clock to 2026-10-03
const work = tmp("vendor-gate-e2");
let tpl = "";
before(async () => { tpl = await makeTemplate(work); });
after(() => { fs.rmSync(work, { recursive: true, force: true }); cleanup(); });
const NOW = Date.parse("2026-10-03T12:00:00Z");

test("waiting summary: nothing, a fresh queue, an overdue one; only waiting proposals count; the threshold is a setting", async () => {
  const { accountsDb, closeAccountsDb } = await import("../lib/accounts/store");
  const { waitingSummary, overdueDays } = await import("../lib/watch/waiting");
  const acc = accountsDb();
  acc.exec("DELETE FROM proposals");
  assert.deepEqual(waitingSummary(acc, NOW), { waiting: 0, oldestSeen: null, ageDays: null, overdue: false });
  assert.deepEqual(waitingSummary(null, NOW).waiting, 0);
  const ins = acc.prepare("INSERT INTO proposals (source, kind, target_key, label, fingerprint, status, first_seen, last_seen) VALUES ('vendor:boxing-data-api','field_change',?,?,?,?,?,?)");
  ins.run("boxer|a|height_cm", "A", "f1", "pending", "2026-10-02T06:00:00Z", "2026-10-03T00:00:00Z");
  ins.run("boxer|b|height_cm", "B", "f2", "approved", "2026-08-01T06:00:00Z", "2026-08-01T06:00:00Z");
  ins.run("boxer|c|height_cm", "C", "f3", "rejected", "2026-08-01T06:00:00Z", "2026-08-01T06:00:00Z");
  const fresh = waitingSummary(acc, NOW);
  assert.deepEqual([fresh.waiting, fresh.ageDays, fresh.overdue], [1, 1, false], "decided proposals, however old, do not count");
  ins.run("boxer|d|height_cm", "D", "f4", "pending", "2026-09-24T06:00:00Z", "2026-10-03T00:00:00Z");
  const old = waitingSummary(acc, NOW);
  assert.deepEqual([old.waiting, old.ageDays, old.overdue, old.oldestSeen], [2, 9, true, "2026-09-24T06:00:00Z"]);
  assert.equal(waitingSummary(acc, NOW, 10).overdue, false, "a longer threshold");
  assert.deepEqual([overdueDays(undefined), overdueDays("14"), overdueDays("0"), overdueDays("soon")], [7, 14, 7, 7]);
  acc.exec("DELETE FROM proposals");
  closeAccountsDb();
});

test("/api/health: nothing waiting says nothing, a fresh queue gives a count, an overdue one gives the days; stale is untouched", async () => {
  const { accountsDb } = await import("../lib/accounts/store");
  const health = await import("../app/api/health/route");
  const acc = accountsDb();
  acc.exec("DELETE FROM proposals");
  const data = async () => (await (await health.GET()).json()).data as Record<string, unknown>;
  const none = await data();
  assert.equal("updatesWaiting" in none, false); assert.equal("updatesOverdueDays" in none, false);
  const ins = acc.prepare("INSERT INTO proposals (source, kind, target_key, label, fingerprint, status, first_seen, last_seen) VALUES ('vendor:boxing-data-api','field_change',?,'x',?,'pending',?,'2026-10-03T00:00:00Z')");
  ins.run("boxer|a|height_cm", "f1", "2026-10-02T06:00:00Z");
  const fresh = await data();
  assert.equal(fresh.updatesWaiting, 1); assert.equal("updatesOverdueDays" in fresh, false);
  ins.run("boxer|b|height_cm", "f2", "2026-09-20T06:00:00Z");
  const late = await data();
  assert.deepEqual([late.updatesWaiting, late.updatesOverdueDays], [2, 12]);
  assert.equal(late.stale, none.stale, "whether the update ran is a different question");
  acc.exec("DELETE FROM proposals");
});

const probe = (u: { waiting: number; oldestSeen: string | null } | null): Probe => ({
  dir: () => ({ exists: true, writable: true }),
  db: () => ({ exists: true, quickCheck: "ok", lastUpdate: { at: "2026-10-03T06:17:00.000Z", provider: "boxing-data-api" }, tables: ["boxers", "events", "bouts", "users", "sessions", "picks", "forum_posts"], rows: { boxers: 9, events: 9, bouts: 9, users: 1, sessions: 1, picks: 1, forum_posts: 1 } }),
  file: () => true, newestBackup: () => new Date("2026-10-03T03:00:00Z"), freeBytes: () => 50 * 1024 ** 3, updates: () => u,
});
const find = (fs: Finding[]) => fs.filter((x) => x.id === "updates-waiting");
const doctor = (u: { waiting: number; oldestSeen: string | null } | null, env: Record<string, string> = {}) => diagnose({ NODE_ENV: "production", ...env }, probe(u), { cwd: "/srv/app", now: new Date(NOW), production: true, nodeVersion: "22.23.2" });

test("the doctor: nothing waiting is not mentioned, a fresh queue is a note, an overdue one is a warning with what to do; the threshold is a setting", () => {
  assert.deepEqual(find(doctor(null)), []);
  assert.deepEqual(find(doctor({ waiting: 0, oldestSeen: null })), []);
  const fresh = find(doctor({ waiting: 5, oldestSeen: "2026-10-01T00:00:00Z" }));
  assert.deepEqual(fresh.map((x) => x.level), ["info"]); assert.match(fresh[0].message, /5 source update\(s\) are waiting/);
  const late = find(doctor({ waiting: 40, oldestSeen: "2026-09-20T00:00:00Z" }));
  assert.deepEqual(late.map((x) => x.level), ["warn"]);
  assert.match(late[0].message, /waiting for an administrator for 13 days/); assert.match(late[0].message, /last approved data/); assert.match(late[0].fix ?? "", /\/review\/updates/);
  assert.deepEqual(find(doctor({ waiting: 40, oldestSeen: "2026-09-20T00:00:00Z" }, { UPDATES_OVERDUE_DAYS: "30" })).map((x) => x.level), ["info"]);
});

test("the first night of holding: no flag to remember, and a night over the guard is then refused; the nightly job says what was held", async () => {
  const { hasHeldBefore, writeGateReport } = await import("../lib/watch/vendor-gate");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-first-"));
  try {
    assert.equal(hasHeldBefore(dir), false);
    const rep = (mode: "observe" | "hold") => ({ version: 1 as const, at: `2026-01-0${mode === "hold" ? 2 : 1}T00:00:00.000Z`, mode, touched: {}, newRows: {}, fields: [], results: { arrived: 0, changed: 0, cleared: 0, details: 0, samples: [] }, rankings: { firstSnapshot: false, changed: 0, removed: 0, added: 0, unchanged: 0, samples: [] }, wouldHold: 0, passes: {}, ungated: {}, refuse: [], acceptedByRule: [] });
    writeGateReport(dir, rep("observe"));
    assert.equal(hasHeldBefore(dir), false, "observing is not holding");
    writeGateReport(dir, rep("hold"));
    assert.equal(hasHeldBefore(dir), true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }

  const worldWith = (ids: string[]) => { const { world } = nextDay(makeLeague()); for (const id of ids) world.fighters.set(id, { ...world.fighters.get(id)!, country: "Ireland" }); return world; };
  const v = makeVolume(tpl, "first-night");
  v.accounts = path.join(v.dir, "accounts-real.db");
  const run = async (world: ReturnType<typeof worldWith>) => { const vendor = await serveFaulty(world); try { return await startNightly(v, { url: vendor.url, env: { VENDOR_GATE: "hold", VENDOR_GATE_MAX_NIGHT: "2", RINGSIDE_NIGHTLY_UPDATE_ARGS: "--refetch-all --gap-ms 0 --retries 0 --patience-min 0" } }).wait(); } finally { await vendor.close(); } };
  const first = await run(worldWith(["f0", "f1", "f2"])); // three changes, over a ceiling of two
  assert.equal(first.code, 0, first.out);
  assert.match(first.out, /first night of holding/);
  const upd = readStatusFile(v).steps.find((s) => s.name === "update")!;
  assert.match(upd.message, /3 change\(s\) held for approval/, "the nightly job's own line says what waits");
  const second = await run(worldWith(["f0", "f1", "f2", "f3", "f4", "f5"]));
  assert.equal(second.code, 3, second.out);
  assert.doesNotMatch(second.out, /first night of holding/);
  assert.match(second.out, /refused this night/);
});
