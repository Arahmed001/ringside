import test, { after } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { tempDb } from "./helpers";
import { checkFacts, shapeProblems } from "../lib/research/check";
import { matchFacts } from "../lib/research/match";
import type { ResearchFact } from "../lib/research/types";

const cleanup = tempDb("research-weighins");
after(cleanup);

const pages: Record<string, string> = {
  "https://espn.com/w": "Official weigh-in: Alpha 146.8 pounds, Bravo 147 pounds at the 147-pound limit.",
  "https://boxingscene.com/w": "Alpha weighed 147 lb at the 147 lb limit and Bravo 147 lb for Saturday's welterweight bout.",
  "https://sky.com/w": "Alpha came in at 140 lb.",
};
const getPage = async (url: string) => (url in pages ? { ok: true as const, url, text: pages[url], fromCache: false, status: 200 } : { ok: false as const, url, reason: "http" as const, detail: "404" });
const ev = { name: "Alpha vs Bravo", date: "2026-01-10", fighters: ["Alpha Smith", "Bravo Jones"] };
const claim = (url: string, quote: string, values: Record<string, number>, over: Partial<ResearchFact> = {}): ResearchFact =>
  ({ kind: "weigh_in", event: ev, fighter: "Alpha Smith", values, basis: "reported", source: new URL(url).host, sourceUrl: url, quote, accessedAt: "2026-10-10", ...over });

test("a weigh-in claim needs the fighter, and a weight is a number of pounds", () => {
  assert.deepEqual(shapeProblems(claim("https://espn.com/w", "Alpha 146.8 pounds", { officialLb: 146.8 })), []);
  assert.ok(shapeProblems(claim("https://espn.com/w", "q", { officialLb: 146.8 }, { fighter: undefined })).some((p) => /needs the fighter/.test(p)));
  assert.ok(shapeProblems(claim("https://espn.com/w", "q", { weightKg: 66 })).some((p) => /unknown value/.test(p)));
});

test("two sites agree on a weight within half a percent, and 140 against 147 is a conflict, not an agreement", async () => {
  const ok = await checkFacts([claim("https://espn.com/w", "Alpha 146.8 pounds", { officialLb: 146.8 }), claim("https://boxingscene.com/w", "Alpha weighed 147 lb", { officialLb: 147 })], { getPage });
  assert.deepEqual(ok.map((c) => c.fields?.officialLb), ["verified", "verified"]);
  const bad = await checkFacts([claim("https://espn.com/w", "Alpha 146.8 pounds", { officialLb: 146.8 }), claim("https://sky.com/w", "Alpha came in at 140 lb", { officialLb: 140 })], { getPage });
  assert.ok(bad.every((c) => c.fields?.officialLb !== "verified"), "seven pounds apart is not the same weight (5% would have said it was)");
});

test("a verified weight is matched to the fighter's bout, written with its source, and made weight is worked out from the limit", async () => {
  const db: DatabaseSync = await (await import("../lib/db")).getDb();
  const row = db.prepare(`SELECT b.external_id bout, e.date date, e.name en, r.name rn, r.external_id re, u.name un FROM bouts b JOIN events e ON e.id=b.event_id JOIN boxers r ON r.id=b.red_id JOIN boxers u ON u.id=b.blue_id LIMIT 1`).get() as { bout: string; date: string; en: string; rn: string; re: string; un: string };
  const e2 = { name: row.en, date: row.date, fighters: [row.rn, row.un] };
  const mk = (url: string, quote: string, values: Record<string, number>) => claim(url, quote, values, { event: e2, fighter: row.rn });
  const checked = await checkFacts([mk("https://espn.com/w", "Alpha 146.8 pounds and the 147-pound limit", { officialLb: 146.8, limitLb: 147 }), mk("https://boxingscene.com/w", "Alpha weighed 147 lb at the 147 lb limit", { officialLb: 147, limitLb: 147 })].map((c) => ({ ...c, quote: c.quote === "Alpha 146.8 pounds and the 147-pound limit" ? "Alpha 146.8 pounds, Bravo 147 pounds at the 147-pound limit" : c.quote })), { getPage });
  const m = matchFacts(db, checked, { today: "2026-10-10" });
  assert.equal(m.rows.weighIns!.length, 2, "one row for each source");
  const { ingestMoney } = await import("../lib/ingest-money");
  // the demo seed has a weight of its own for this fighter and bout, and a researched weight never overwrites a row another source holds: so it is cleared for the first half of the test, and kept for the second
  const held = db.prepare("SELECT w.* FROM weigh_ins w JOIN boxers x ON x.id = w.boxer_id WHERE w.bout_id = (SELECT id FROM bouts WHERE external_id = ?) AND x.external_id = ?").get(row.bout, row.re) as { official_lb: number } | undefined;
  db.prepare("DELETE FROM weigh_ins WHERE bout_id = (SELECT id FROM bouts WHERE external_id = ?) AND boxer_id = (SELECT id FROM boxers WHERE external_id = ?)").run(row.bout, row.re);
  const r = ingestMoney(db, m.rows, { label: "test" });
  assert.equal(r.written.weighIns, 2);
  db.exec("DELETE FROM weigh_ins WHERE source LIKE '%.com'"); // (the demo seed has weights of its own for this bout; the researched ones are the two hosts)
  const rows2 = m.rows.weighIns!;
  assert.equal(ingestMoney(db, { ...m.rows, weighIns: rows2 }, { label: "test" }).written.weighIns, 2, "running it again writes the same rows");
  const got = db.prepare("SELECT w.official_lb, w.limit_lb, w.made_weight, w.source, w.source_url, w.basis FROM weigh_ins w JOIN boxers x ON x.id = w.boxer_id WHERE w.bout_id = (SELECT id FROM bouts WHERE external_id = ?) AND x.external_id = ?").all(row.bout, row.re) as Record<string, unknown>[];
  assert.equal(got.length, 1, "one row per fighter and bout: the second source does not overwrite or duplicate the first");
  assert.equal(got[0].official_lb, 146.8);
  assert.equal(got[0].made_weight, 1, "146.8 under a 147 limit");
  assert.equal(got[0].basis, "reported");
  assert.match(String(got[0].source_url), /^https:\/\//);
  // a vendor's own weight for the same fighter and fight stays: a researched one never overwrites it
  db.prepare("UPDATE weigh_ins SET official_lb = 111.6, source = 'vendor' WHERE bout_id = (SELECT id FROM bouts WHERE external_id = ?) AND boxer_id = (SELECT id FROM boxers WHERE external_id = ?)").run(row.bout, row.re);
  ingestMoney(db, m.rows, { label: "test" });
  const after2 = db.prepare("SELECT official_lb, source FROM weigh_ins WHERE bout_id = (SELECT id FROM bouts WHERE external_id = ?) AND boxer_id = (SELECT id FROM boxers WHERE external_id = ?)").get(row.bout, row.re) as { official_lb: number; source: string };
  assert.deepEqual([after2.official_lb, after2.source], [111.6, "vendor"]);
  void held;
});
