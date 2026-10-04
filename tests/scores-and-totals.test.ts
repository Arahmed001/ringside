import test, { after } from "node:test";
import assert from "node:assert/strict";
import { tempDb } from "./helpers";
import { makeWorld, mockVendor } from "../lib/vendor-mock";
import { boxingDataApiProvider, careerTotals, cleanScores, mapFight, type ApiFight, type Notes } from "../lib/providers/boxing-data-api";
import { koView } from "../lib/career";

process.env.RINGSIDE_NO_SEED = "1";
process.env.BOXING_API_STORAGE_CONFIRMED = "1";
const cleanup = tempDb("scores-and-totals");
after(cleanup);

/**
 * Two fields the supplier gives that the load used to ignore: the judges' scores of a decision, and a fighter's career knockouts and times stopped. The scores are
 * shown as given (the docs name no judges and no corners, so they are never assigned to a fighter); the totals stand in for the held fights' counts only when the
 * record shown is the supplier's own career total.
 */
test("scores: only real scores survive, at most three, with a dash as a hyphen", () => {
  assert.deepEqual(cleanScores(["116-109", "117-108", "116-109"]), ["116-109", "117-108", "116-109"]);
  assert.deepEqual(cleanScores([" 115–113 ", "114—114"]), ["115-113", "114-114"], "an en or em dash is a hyphen");
  assert.deepEqual(cleanScores(["116-109", "n/a", "", null, "1160-9", "a-b", "116-109", "117-108", "118-107"]), ["116-109", "116-109", "117-108"], "junk is dropped, and three cards at most");
  assert.deepEqual(cleanScores(null), []);
  assert.deepEqual(cleanScores(undefined), []);
});

const notes = () => new Proxy({} as Notes, { get: () => 0, set: () => true });
const fight = (o: Partial<ApiFight> = {}): ApiFight => ({
  id: "f1", status: "FINISHED", date: "2026-01-10T00:00:00", scheduled_rounds: 12, event: { id: "e1", title: "Card", date: "2026-01-10T00:00:00", location: "London, United Kingdom", venue: "Arena" },
  fighters: { fighter_1: { fighter_id: "a", winner: true, name: "A" }, fighter_2: { fighter_id: "b", winner: false, name: "B" } }, results: { outcome: "UD", round: "12" },
  scores: ["116-109", "117-108", "116-109"], division: { name: "Heavyweight" }, ...o,
});
test("a finished fight keeps its scores; a fight not yet fought has none", () => {
  assert.deepEqual(mapFight(fight(), notes())!.bout.scores, ["116-109", "117-108", "116-109"]);
  assert.equal(mapFight(fight({ status: "NOT_STARTED", results: null }), notes())!.bout.scores, undefined);
  assert.equal(mapFight(fight({ scores: null }), notes())!.bout.scores, undefined, "no scores is no field, not an empty one");
  assert.equal(mapFight(fight({ scores: ["bad"] }), notes())!.bout.scores, undefined);
  assert.equal(mapFight(fight({ results: { outcome: "KO", round: "5" } }), notes())!.bout.scores, undefined, "a stoppage has no scorecards, whatever the feed attached");
  assert.deepEqual(mapFight(fight({ fighters: { fighter_1: { fighter_id: "a", winner: false, name: "A" }, fighter_2: { fighter_id: "b", winner: false, name: "B" } } }), notes())!.bout.scores, ["116-109", "117-108", "116-109"], "a draw is decided on the cards too");
});

test("career totals: a number counts only if it is a whole number no larger than the wins or losses it is part of", () => {
  assert.deepEqual(careerTotals({ wins: 20, losses: 3, draws: 1, ko_wins: 15, stopped: 2 }), { koWins: 15, stopped: 2 });
  assert.deepEqual(careerTotals({ wins: 20, losses: 3, draws: 1, ko_wins: 21, stopped: 2 }), { stopped: 2 }, "more knockouts than wins contradicts the record");
  assert.deepEqual(careerTotals({ wins: 20, losses: 3, draws: 1, ko_wins: 15, stopped: 4 }), { koWins: 15 }, "more stoppages than losses too");
  assert.deepEqual(careerTotals({ wins: 20, losses: 3, draws: 1, ko_wins: 1.5, stopped: -1 }), {}, "not a whole number, not a count");
  assert.deepEqual(careerTotals({ wins: 20, losses: 3, draws: 1 }), {}, "a feed without them gives none");
  assert.deepEqual(careerTotals({ wins: 0, losses: 0, draws: 0, ko_wins: 0, stopped: 0 }), { koWins: 0, stopped: 0 }, "zero is a total too");
});

const f = (o: Record<string, unknown>) => ({ wins: 1, losses: 0, draws: 0, kos: 1, koRate: 1, koLosses: 0, vendorRecord: null, ...o }) as never;
test("what a page shows: the supplier's knockouts only beside the supplier's record, and the rate is over the wins shown", () => {
  // a career held in part (1-0 held of 19-0-1), supplier gives 14 knockouts and 0 times stopped
  assert.deepEqual(koView(f({ vendorRecord: { wins: 19, losses: 0, draws: 1, koWins: 14, stopped: 0 } })), { kos: 14, rate: 14 / 19, stopped: 0, source: "supplier" });
  // a complete career: counted from the fights, whatever the supplier says
  assert.deepEqual(koView(f({ wins: 19, losses: 0, draws: 1, kos: 13, koRate: 13 / 19, vendorRecord: { wins: 19, losses: 0, draws: 1, koWins: 14 } })), { kos: 13, rate: 13 / 19, stopped: 0, source: "loaded" });
  // held in part and the supplier gives no knockouts: what is held, labelled as such by the page
  assert.equal(koView(f({ vendorRecord: { wins: 19, losses: 0, draws: 1 } })).source, "loaded");
  // knockouts without times stopped: the stopped figure is unknown, not zero
  assert.equal(koView(f({ vendorRecord: { wins: 19, losses: 0, draws: 1, koWins: 14 } })).stopped, null);
  // no wins: no division by zero
  assert.equal(koView(f({ wins: 0, vendorRecord: { wins: 0, losses: 3, draws: 0, koWins: 0 }, losses: 1 })).rate, 0);
});

const league = makeWorld({ fighters: 120, fights: 260, upcoming: 3, seed: 21 });
test("end to end: a partial load stores the supplier's knockouts and the scores, and the world serves them", async () => {
  const { getDb } = await import("../lib/db");
  const { ingest } = await import("../lib/ingest");
  const { getWorld } = await import("../lib/world");
  const provider = boxingDataApiProvider({ key: "k".repeat(40), purpose: "evaluation", fetchImpl: mockVendor(league).fetchImpl, scheduleDays: 0, maxRequests: 1e6, retries: 0, gapMs: 0, maxFighters: 40, log: () => {}, sleep: async () => {} });
  const db = await getDb();
  await ingest(db, provider, { strict: false });
  const rows = db.prepare("SELECT external_id, vendor_ko_wins k, vendor_stopped s FROM boxers").all() as { external_id: string; k: number | null; s: number | null }[];
  assert.equal(rows.length, 40);
  for (const r of rows) {
    const id = r.external_id.replace("bda-f-", "");
    let ko = 0, st = 0;
    for (const x of league.fights) { if (x.status !== "FINISHED" || (x.outcome !== "KO" && x.outcome !== "TKO") || (x.a !== id && x.b !== id)) continue; const won = x.winner === "a" ? x.a : x.winner === "b" ? x.b : null; if (won === id) ko++; else if (won) st++; }
    assert.deepEqual([r.k, r.s], [ko, st], `${id}: the supplier's totals are stored as given`);
  }
  const w = await getWorld();
  const partial = w.boxers.find((b) => b.vendorRecord && b.vendorRecord.wins > b.wins);
  assert.ok(partial, "the load is partial: some fighter holds fewer wins than the career total");
  const v = koView(partial);
  assert.equal(v.source, "supplier");
  assert.equal(v.kos, partial.vendorRecord!.koWins, "the page shows the supplier's knockouts beside the supplier's record");
  const scored = db.prepare("SELECT vendor_scores s FROM bouts WHERE vendor_scores IS NOT NULL").all() as { s: string }[];
  assert.ok(scored.length > 0 && scored.every((r) => JSON.parse(r.s).length === 3));
  assert.ok([...w.boutById.values()].some((b) => b.vendorScores?.length === 3), "the world carries them to the bout page");
  assert.ok([...w.boutById.values()].every((b) => b.method === "UD" || b.method === "DRAW" || !b.vendorScores), "only a fight that went to the cards has scores");
});
