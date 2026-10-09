import test, { after } from "node:test";
import assert from "node:assert/strict";
import { tempDb } from "./helpers";

/**
 * How the adapter reads a fight's outcome. The validator rejects a fight with a winner and no method (and one whose method says there was no winner), and both
 * fighters then lose a real result from their record, form and rating. So an outcome word the feed's own list does not show must be mapped when it is a known
 * method, and a fight whose winner and outcome cannot be reconciled stays in the history as "no result yet": never dropped, never given a result nobody stated.
 */
process.env.RINGSIDE_NO_SEED = "1";
const cleanup = tempDb("outcome");
after(cleanup);
delete process.env.BOXING_API_STORAGE_CONFIRMED;

import * as B from "../lib/providers/boxing-data-api";
import type { ProviderBout, ProviderEvent } from "../lib/providers/index";
import { sanitizeFeed } from "../lib/validate";
import { emptyFeed } from "../lib/feed";

const KEY = "sk-test-key-0123456789abcdef0123456789";
const notes = () => ({ ...B.boxingDataApiProvider({ key: KEY, purpose: "evaluation", fetchImpl: (async () => new Response("{}")) as typeof fetch }).notes() });
const side = (id: string, winner: boolean) => ({ name: "x", full_name: "x x", winner, fighter_id: id });
const fight = (id: string, o: { outcome?: string | null; round?: string | number | null; a?: boolean; b?: boolean; status?: string }): B.ApiFight => ({
  id, title: "Card", date: "2024-12-21T21:00:00+00:00", location: "London, United Kingdom", venue: "Arena", scheduled_rounds: 12, status: o.status ?? "FINISHED",
  fighters: { fighter_1: side("A", o.a ?? true), fighter_2: side("B", o.b ?? false) },
  results: { outcome: "outcome" in o ? o.outcome : "UD", round: o.round ?? null }, event: { id: `ev-${id}`, title: "Card", date: "2024-12-21T21:00:00+00:00", location: "London, United Kingdom", venue: "Arena" },
  division: { name: "Heavyweight" }, titles: [],
}) as B.ApiFight;
const bout = (o: Parameters<typeof fight>[1], n = notes()) => ({ b: B.mapFight(fight("f1", o), n)!.bout, n });

test("outcome words the feed's list does not show but a real feed has are read as the method they name, and counted", () => {
  for (const [word, want] of [["DQ", "DQ"], ["Disqualification", "DQ"], ["RTD", "RTD"], ["Corner Retirement", "RTD"], ["TD", "TD"], ["Technical Decision", "TD"]] as const) {
    const { b, n } = bout({ outcome: word, round: 4 });
    assert.equal(b.method, want, word); assert.equal(b.winnerExternalId, "bda-f-A", `${word} keeps its winner`); assert.equal(n.outcomeMapped, 1, word); assert.equal(n.outcomeUnreadable, 0, word);
  }
});

test("the outcomes the adapter always read are read as before and are not counted as mapped", () => {
  for (const word of ["UD", "MD", "SD", "KO", "TKO"]) { const { b, n } = bout({ outcome: word, round: 5 }); assert.equal(b.method, word); assert.equal(n.outcomeMapped, 0, word); }
  const pts = bout({ outcome: "PTS" }); assert.equal(pts.b.method, "UD"); assert.equal(pts.n.ptsAsUnanimousDecision, 1); assert.equal(pts.n.outcomeMapped, 0);
});

test("a no-contest or a draw word with no winner marked is that result, with no winner", () => {
  const nc = bout({ outcome: "No Contest", a: false, b: false }); assert.equal(nc.b.method, "NC"); assert.equal(nc.b.winnerExternalId, null);
  const d = bout({ outcome: "Majority Draw", a: false, b: false }); assert.equal(d.b.method, "DRAW"); assert.equal(d.b.winnerExternalId, null);
});

test("a winner with an outcome nobody can read, or no outcome, or one that says there was no winner, stays as 'no result yet' and is counted: never dropped, never guessed", () => {
  for (const [label, o] of [["an unknown word", { outcome: "Walkover Forfeit?!" }], ["no outcome", { outcome: null }], ["a no-contest with a winner marked", { outcome: "NC" }], ["a draw with a winner marked", { outcome: "Draw" }]] as const) {
    const { b, n } = bout(o as never);
    assert.equal(b.method, null, label); assert.equal(b.winnerExternalId, null, `${label}: no winner is named when the result is not`); assert.equal(n.outcomeUnreadable, 1, label);
  }
});

test("a result that needs a winner and has none is no result, as a knockout with no winner always was (and now a disqualification too)", () => {
  for (const word of ["KO", "TKO", "DQ", "RTD"]) { const { b, n } = bout({ outcome: word, round: 3, a: false, b: false }); assert.equal(b.method, null, word); assert.equal(b.winnerExternalId, null); assert.equal(n.stoppageWithoutWinner, 1, word); }
  const ud = bout({ outcome: "UD", a: false, b: false }); assert.equal(ud.b.method, null, "a decision with no winner marked is a missing winner, not a draw (the feed writes a draw as D)"); assert.equal(ud.n.drawInferred, 0); assert.equal(ud.n.decisionWithoutWinner, 1);
  const dr = bout({ outcome: "D", a: false, b: false }); assert.equal(dr.b.method, "DRAW"); assert.equal(dr.b.winnerExternalId, null);
});

test("both fighters marked the winner: neither is picked and it is not read as a draw", () => {
  const { b, n } = bout({ outcome: "UD", a: true, b: true });
  assert.equal(b.method, null); assert.equal(b.winnerExternalId, null); assert.equal(n.bothMarkedWinner, 1); assert.equal(n.drawInferred, 0);
});

test("a round of 0 is not a round: the end round is unknown, not a fight the validator rejects", () => {
  const ko = bout({ outcome: "KO", round: 0 }); assert.equal(ko.b.endRound, null); assert.equal(ko.n.roundUnreadable, 1);
  const neg = bout({ outcome: "TKO", round: "-2" }); assert.equal(neg.b.endRound, null); assert.equal(neg.n.roundUnreadable, 1);
  const ok = bout({ outcome: "KO", round: 7 }); assert.equal(ok.b.endRound, 7); assert.equal(ok.n.roundUnreadable, 0);
});

test("every one of these fights passes the validator: none is dropped as a bad fight", () => {
  const cases: Parameters<typeof fight>[1][] = [
    { outcome: "DQ", round: 4 }, { outcome: "Technical Decision", round: 6 }, { outcome: "Corner Retirement", round: 8 }, { outcome: "Walkover" }, { outcome: null },
    { outcome: "NC", a: true, b: false }, { outcome: "KO", round: 0 }, { outcome: "UD", a: true, b: true }, { outcome: "KO", a: false, b: false },
  ];
  const n = notes(), bouts: ProviderBout[] = [], events: ProviderEvent[] = [];
  cases.forEach((o, i) => { const m = B.mapFight(fight(`f${i}`, o), n, i)!; bouts.push(m.bout); events.push(m.event); });
  const boxer = (id: string) => ({ externalId: `bda-f-${id}`, name: id, country: "United Kingdom", birthYear: 1990, stance: "Orthodox", sex: "male", heightCm: 180, reachCm: 180, weightClass: "Heavyweight", turnedPro: 2010, active: true });
  const { issues } = sanitizeFeed({ ...emptyFeed(), boxers: [boxer("A"), boxer("B")] as never, events, bouts }, { today: "2026-10-03" });
  assert.deepEqual(issues.filter((i) => i.severity === "error").map((i) => `${i.code}: ${i.message}`), [], "no fight is rejected");
});
