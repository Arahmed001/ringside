import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { writeKeyFile } from "../lib/vendor-fetch";
import { addQuirks, degradeWorld, makeWorld, serveMockVendor } from "../lib/vendor-mock";
import { auditDatabase, describeAudit, failed } from "../lib/vendor-audit";

/**
 * Everything the first real load taught the importer, in one league and one run (round 111): a vendor that lists cancelled fights and cards, Olympic and games bouts, nationalities
 * as demonyms and home nations, and belts in the feed's own spelling, fetched and loaded by the real commands into a database, which `vendor:audit` then judges.
 * Each fix has its own test; this is the test that they work together, through the files and the commands the owner will run.
 */
const root = path.resolve(__dirname, "..");
const go = (script: string, args: string[], env: Record<string, string>) => new Promise<{ code: number | null; out: string }>((resolve) => {
  const c = spawn(process.execPath, ["--import", "tsx", script, ...args], { cwd: root, env: { ...process.env, BOXING_API_KEY: "", BOXING_API_STORAGE_CONFIRMED: "", RINGSIDE_NO_SEED: "1", RINGSIDE_NOW: "2026-10-03", ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let out = ""; c.stdout.on("data", (d) => (out += d)); c.stderr.on("data", (d) => (out += d));
  c.on("close", (code) => resolve({ code, out }));
});

test("a vendor with every quirk of the real feed: fetched, loaded and audited, the importer's fixes hold together and the audit passes", async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "vquirks-")), keyFile = path.join(d, ".key"), cache = path.join(d, "cache"), db = path.join(d, "real.db");
  const secret = "quirks-test-key-" + "k".repeat(34);
  writeKeyFile(keyFile, secret);
  const CANCELLED = 10, CARDS = 4, AMATEUR = 8, BELTS = 12;
  const world = degradeWorld(addQuirks(makeWorld({ fighters: 300, fights: 1200, upcoming: 0, seed: 21 }), { seed: 5, cancelled: CANCELLED, cancelledCards: CARDS, amateur: AMATEUR, belts: BELTS, demonyms: true }), { seed: 3, wrongTotals: 4, priorShare: 0.3 });
  const vendor = await serveMockVendor(world, { key: secret, offsetLimit: 10_000, beyond: "reject" });
  const base = ["--key-file", keyFile, "--cache-dir", cache, "--per-hour", "3600000", "--gap-ms", "0"];
  const env = { BOXING_API_URL: vendor.url, DATABASE_PATH: db };
  try {
    const fetched = await go("scripts/vendor-fetch.ts", [...base, "--no-caffeinate"], env);
    assert.ok(fetched.code === 0 || fetched.code === 1, fetched.out.slice(-600));
    const loaded = await go("scripts/vendor-load.ts", [...base, "--storage-confirmed", "--yes"], env);
    assert.equal(loaded.code, 0, loaded.out.slice(-1200));
    const note = (name: string) => Number(new RegExp(`^\\s+${name}\\s+(\\d+)`, "m").exec(loaded.out)?.[1] ?? NaN);
    // what the importer said it did
    assert.equal(note("cancelledFights"), CANCELLED + 2 * CARDS, "every cancelled fight is counted");
    assert.equal(note("amateurBoutsSkipped"), AMATEUR, "every Olympic and games bout is left out");
    assert.equal(note("cancelledCardsLeftOut"), Math.floor(CANCELLED / 2) + CARDS, "a card of only cancelled fights is left out: the lone ones and the whole cancelled cards");
    assert.ok(note("nationalityFromCode") > 20, "the demonyms were read through the feed's code");
    assert.ok(!loaded.out.includes(secret), "the key is nowhere in the output");

    const x = new DatabaseSync(db, { readOnly: true });
    const one = (sql: string) => Object.values(x.prepare(sql).get() as Record<string, number>)[0];
    try {
      // cancelled: the fights on a card that went ahead stay, as cancelled bouts; the rest are gone with their cards
      assert.equal(one("SELECT COUNT(*) FROM bouts WHERE status = 'cancelled'"), Math.ceil(CANCELLED / 2), "the cancelled fights that shared a card with a live one stay");
      assert.equal(one("SELECT COUNT(*) FROM events e WHERE NOT EXISTS (SELECT 1 FROM bouts b WHERE b.event_id = e.id AND COALESCE(b.status,'') <> 'cancelled')"), 0, "no card is left of nothing but cancelled fights");
      // amateur: none of the games' events is a card of the database
      assert.equal(one("SELECT COUNT(*) FROM events WHERE name LIKE '%Olympics%' OR name LIKE '%Commonwealth Games%'"), 0);
      // countries: spelled as countries, home nations kept, no demonym left
      assert.equal(one("SELECT COUNT(*) FROM boxers WHERE country IN ('Mexican','Japanese','American','Ukrainian','Filipino','Nigerian','Argentine','German','Cuban','British','Scottish','Croatia (Hrvatska)')"), 0, "no demonym is a country");
      assert.ok(one("SELECT COUNT(*) FROM boxers WHERE country = 'Scotland'") > 20 && one("SELECT COUNT(*) FROM boxers WHERE country = 'Croatia'") > 10 && one("SELECT COUNT(*) FROM boxers WHERE country = 'Mexico'") > 20);
      // belts: every one has its body, read from the feed's own name
      const belts = x.prepare("SELECT DISTINCT b.title, o.name org FROM bouts b LEFT JOIN orgs o ON o.id = b.title_org_id WHERE b.title IS NOT NULL").all() as { title: string; org: string | null }[];
      assert.ok(belts.length >= 4, `belts were loaded: ${belts.length}`);
      assert.deepEqual(belts.filter((b) => !b.org).map((b) => b.title), [], "no belt without a body");
      const bodyOf = Object.fromEntries(belts.map((b) => [b.title, b.org]));
      for (const [title, body] of [["WBC World Welterweight Champion", "World Boxing Council"], ["WBA Super World Lightweight Champion", "World Boxing Association"], ["IBF Interim World Heavyweight Champion", "International Boxing Federation"], ["The Ring Middleweight Champion", "The Ring"], ["WBO World Junior Welterweight Champion", "World Boxing Organization"], ["WBA World Minimumweight", "World Boxing Association"]] as const) if (title in bodyOf) assert.equal(bodyOf[title], body, title);
      // the audit, on what was loaded
      const checks = auditDatabase(x, "2026-10-03");
      assert.deepEqual(failed(checks).map((c) => `${c.id}: ${c.detail}`), [], describeAudit(checks).join("\n"));
      assert.ok(checks.find((c) => c.id === "disputed-share")!.detail.includes("fighters with a supplier record"), "the league does have supplier records, some of them disputed");
    } finally { x.close(); }
    // and the command the owner runs after the load
    const audit = await go("scripts/vendor-audit.ts", ["--database", db], {});
    assert.equal(audit.code, 0, audit.out); assert.match(audit.out, /All checks passed/); assert.match(audit.out, /PASS  every belt has a sanctioning body/);
  } finally { await vendor.close(); fs.rmSync(d, { recursive: true, force: true }); }
});
