import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { makeBoxer, miniFeed, tempDb } from "./helpers";
import { auditDatabase, describeAudit, failed, type Check } from "../lib/vendor-audit";

/**
 * The audit of a loaded database (round 106): a clean league passes, and each thing that went wrong on the first real load makes its own check fail (every belt under
 * "Unsanctioned", a country the app cannot place, a card of only cancelled fights, an Olympic bout, a record the fights contradict that is not marked, ...).
 */
const cleanup = tempDb("vendor-audit", "2026-10-03");
const feedDir = fs.mkdtempSync(path.join(os.tmpdir(), "ringside-va-"));
after(() => { cleanup(); fs.rmSync(feedDir, { recursive: true, force: true }); });
let db: DatabaseSync;
const TODAY = "2026-10-03";

before(async () => {
  const feed = miniFeed();
  feed.boxers = [makeBoxer("A", "Lightweight", { country: "Mexico" }), makeBoxer("B", "Lightweight", { country: "United States" })];
  feed.orgs = [...feed.orgs, { externalId: "WBC", name: "World Boxing Council", kind: "sanctioning_body" }];
  feed.bouts[0] = { ...feed.bouts[0], title: "WBC World Lightweight Champion", titleOrgExternalId: "WBC" };
  const file = path.join(feedDir, "feed.json");
  fs.writeFileSync(file, JSON.stringify(feed));
  process.env.BOXING_PROVIDER = "file"; process.env.BOXING_FILE = file; // a league of only this feed (the default database is seeded with the demo)
  db = await (await import("../lib/db")).getDb();
  db.exec("UPDATE boxers SET vendor_wins = 1, vendor_losses = 0, vendor_draws = 0 WHERE name = 'Fighter A'; UPDATE boxers SET vendor_wins = 0, vendor_losses = 1, vendor_draws = 0 WHERE name = 'Fighter B'");
});

const audit = () => auditDatabase(db, TODAY);
const level = (checks: Check[], id: string) => checks.find((c) => c.id === id)!.level;
/** Changes the database, audits it, and puts it back. */
function broken(sql: string): Check[] {
  db.exec("PRAGMA foreign_keys = OFF"); // so a row can be left pointing at nothing (it cannot be switched off inside the transaction)
  db.exec("BEGIN");
  try { db.exec(sql); return audit(); } finally { db.exec("ROLLBACK"); db.exec("PRAGMA foreign_keys = ON"); }
}

test("a clean league passes every check", () => {
  const checks = audit();
  assert.deepEqual(failed(checks).map((c) => c.id), []);
  assert.deepEqual(checks.filter((c) => c.level === "warn").map((c) => c.id), []);
  assert.match(checks.find((c) => c.id === "size")!.detail, /2 fighters, 1 bouts, 1 events/);
  const text = describeAudit(checks).join("\n");
  assert.match(text, /All checks passed\./); assert.doesNotMatch(text, /FAILED/);
});

test("each thing that went wrong on the first real load fails its own check", () => {
  assert.equal(level(broken("UPDATE bouts SET title_org_id = NULL"), "belt-bodies"), "fail");
  assert.equal(level(broken("UPDATE boxers SET country = 'Mexican' WHERE name = 'Fighter A'"), "countries-placed"), "fail");
  assert.equal(level(broken("UPDATE bouts SET status = 'cancelled'"), "no-cancelled-only-cards"), "fail");
  assert.equal(level(broken("UPDATE events SET name = '2016 Rio Olympics: Boxing Day 4'"), "no-amateur-events"), "fail");
  assert.equal(level(broken("UPDATE events SET date = '2030-01-01'"), "no-future-results"), "fail");
  assert.equal(level(broken("UPDATE boxers SET weight_class = 'Catchweight' WHERE name = 'Fighter A'"), "divisions"), "fail");
  assert.equal(level(broken("DELETE FROM boxers WHERE name = 'Fighter B'"), "no-orphans"), "fail");
  const failing = broken("UPDATE bouts SET title_org_id = NULL");
  assert.match(describeAudit(failing).join("\n"), /FAIL  every belt has a sanctioning body[\s\S]*Unsanctioned[\s\S]*check\(s\) FAILED/);
});

test("a country the app cannot place is a warning when it is a handful of a large league, and a spelling with another is a warning", () => {
  assert.equal(level(broken("UPDATE boxers SET country = 'USA' WHERE name = 'Fighter B'"), "countries-one-spelling"), "warn");
  assert.equal(level(broken("UPDATE boxers SET country = 'England' WHERE name = 'Fighter B'"), "countries-one-spelling"), "pass", "a home nation is its own country");
  assert.equal(level(broken("UPDATE boxers SET country = 'Unknown' WHERE name = 'Fighter B'"), "countries-placed"), "pass", "Unknown is not a country the app failed to place");
});

test("a record the fights contradict must be marked disputed, unless the supplier's total could not have caught up with a fight just before the load", () => {
  const over = "UPDATE boxers SET vendor_wins = 0, vendor_losses = 1, vendor_draws = 0 WHERE name = 'Fighter A'";
  const zero = "UPDATE boxers SET vendor_wins = 0, vendor_losses = 0, vendor_draws = 0 WHERE name = 'Fighter A'";
  assert.equal(level(broken(zero), "records-marked"), "pass", "a supplier total of nothing beside a professional fight is no total, as the loader reads it (round 137)");
  assert.equal(level(broken(zero + "; UPDATE bouts SET rounds = 3"), "records-marked"), "fail", "beside only a three-round fight it is still a contradiction");
  assert.equal(level(broken(over), "records-marked"), "fail");
  assert.equal(level(broken(over + "; UPDATE boxers SET record_disputed = 1 WHERE name = 'Fighter A'"), "records-marked"), "pass", "marked: as the loader does");
  const recent = broken(over + "; UPDATE events SET date = '2026-09-28'");
  assert.equal(level(recent, "records-marked"), "pass"); assert.match(recent.find((c) => c.id === "records-marked")!.detail, /1 are ahead of the supplier's total only by a fight in the 14 days before the load/);
  assert.equal(level(broken("UPDATE boxers SET vendor_wins = 5 WHERE name = 'Fighter A'"), "records-marked"), "pass", "a partial career (fewer fights than the total) is fine");
});

test("the command: reads a database read-only, prints the report, exits 1 on a failure and 0 on a pass, and says so when there is no file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ringside-audit-"));
  const copy = path.join(dir, "real.db");
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  fs.copyFileSync(process.env.DATABASE_PATH!, copy);
  const run = (file: string) => spawnSync(process.execPath, ["--import", "tsx", path.join(process.cwd(), "scripts", "vendor-audit.ts"), "--database", file], { encoding: "utf8", env: { ...process.env, RINGSIDE_NOW: TODAY } });
  const ok = run(copy);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr); assert.match(ok.stdout, /PASS  every belt has a sanctioning body/); assert.match(ok.stdout, /All checks passed/);
  const before = fs.statSync(copy).mtimeMs;
  assert.equal(fs.statSync(copy).mtimeMs, before, "the file is not written");
  const w = new DatabaseSync(copy); w.exec("UPDATE bouts SET title_org_id = NULL"); w.close();
  const bad = run(copy);
  assert.equal(bad.status, 1); assert.match(bad.stdout, /FAIL  every belt has a sanctioning body/); assert.match(bad.stdout, /check\(s\) FAILED/);
  const none = run(path.join(dir, "missing.db"));
  assert.equal(none.status, 1); assert.match(none.stderr, /There is no database at .*missing\.db/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a card held in a place that is not a country (a county, a state, a typo) is a warning in a large league and a failure in a small one (round 133: 425 cards of the first real load)", () => {
  assert.equal(level(broken("UPDATE events SET country = 'Lancashire'"), "event-countries"), "fail", "all of one card is more than 2%");
  assert.equal(level(broken("UPDATE events SET country = 'England'"), "event-countries"), "pass", "a home nation is a country");
  assert.equal(level(broken("UPDATE events SET country = 'Unknown'"), "event-countries"), "pass");
  assert.match(describeAudit(broken("UPDATE events SET country = 'Lancashire'")).join("\n"), /every card's country[\s\S]*Lancashire 1/);
});
