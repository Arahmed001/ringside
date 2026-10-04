import test from "node:test";
import assert from "node:assert/strict";
import { applyControls, asSort, asStatus, koRateComparable, optionsOf } from "../lib/fighter-list";

/** The fighters list's controls: they filter and order, a value the page does not know is ignored, and a rate is never compared across careers that cannot be. */
const f = (id: number, o: Record<string, unknown> = {}) => ({ id, country: "Mexico", stance: "Orthodox", active: true, rating: 1500, lastFight: "2024-01-01", bouts: 10, wins: 8, losses: 2, draws: 0, kos: 4, koRate: 0.5, vendorRecord: null, ...o }) as never;
const ids = (xs: { id: number }[]) => xs.map((x) => x.id);

test("a value the page does not know is ignored, not turned into an empty page", () => {
  assert.equal(asSort("nonsense"), "rating");
  assert.equal(asSort(undefined), "rating");
  assert.equal(asSort("ko"), "ko");
  assert.equal(asStatus("both"), undefined);
  assert.equal(asStatus("retired"), "retired");
  const list = [f(1), f(2)];
  assert.deepEqual(ids(applyControls(list, { sort: "nonsense", status: "both" })), [1, 2]);
});

test("filters: country, stance and status each narrow the list, and together", () => {
  const list = [f(1), f(2, { country: "Japan" }), f(3, { stance: "Southpaw" }), f(4, { active: false }), f(5, { country: "Japan", stance: "Southpaw", active: false })];
  assert.deepEqual(ids(applyControls(list, { country: "Japan" })), [2, 5]);
  assert.deepEqual(ids(applyControls(list, { stance: "Southpaw" })), [3, 5]);
  assert.deepEqual(ids(applyControls(list, { status: "retired" })), [4, 5]);
  assert.deepEqual(ids(applyControls(list, { status: "active" })), [1, 2, 3]);
  assert.deepEqual(ids(applyControls(list, { country: "Japan", stance: "Southpaw", status: "retired" })), [5]);
  assert.deepEqual(ids(applyControls(list, { country: "Atlantis" })), [], "a country nobody is from is an honest empty list");
  assert.equal(optionsOf(list).countries.join(), "Japan,Mexico");
  assert.deepEqual(optionsOf([f(1, { stance: null })]).stances, [], "no stance known, none offered");
});

test("order: rating, latest fight (never-fought last), wins; ties are stable by rating then id", () => {
  const list = [f(1, { rating: 1500, lastFight: "2023-01-01", wins: 5 }), f(2, { rating: 1700, lastFight: null, wins: 20 }), f(3, { rating: 1600, lastFight: "2025-06-01", wins: 12 }), f(4, { rating: 1600, lastFight: "2025-06-01", wins: 12 })];
  assert.deepEqual(ids(applyControls(list, { sort: "rating" })), [2, 3, 4, 1]);
  assert.deepEqual(ids(applyControls(list, { sort: "recent" })), [3, 4, 1, 2], "newest first, no date last, a tie by rating then id");
  assert.deepEqual(ids(applyControls(list, { sort: "wins" })), [2, 3, 4, 1]);
  assert.deepEqual(ids(applyControls(list, {}, true)), [1, 2, 3, 4], "a search keeps its own order when no order is asked for");
  assert.deepEqual(ids(applyControls(list, { sort: "recent" }, true)), [3, 4, 1, 2], "but an order that is asked for wins");
});

test("most wins uses the career the page shows: the supplier's total for a career held in part", () => {
  const partial = f(1, { wins: 2, losses: 0, bouts: 2, vendorRecord: { wins: 30, losses: 1, draws: 0 } });
  const full = f(2, { wins: 20, losses: 2, bouts: 22 });
  assert.deepEqual(ids(applyControls([full, partial], { sort: "wins" })), [1, 2], "30 wins on the card outranks 20, though only 2 fights are held");
});

test("knockout rate: only careers that can be compared are ranked, the rest come last", () => {
  const sure = f(1, { koRate: 0.9, kos: 9, bouts: 10, wins: 10 });
  const few = f(2, { koRate: 1, kos: 4, bouts: 9, wins: 4, losses: 5 }); // 4 knockouts in 4 wins: not a harder puncher than 9 in 10
  const partial = f(3, { koRate: 1, kos: 6, bouts: 6, wins: 6, losses: 0, vendorRecord: { wins: 20, losses: 0, draws: 0 } });
  const mid = f(4, { koRate: 0.6, kos: 6, bouts: 12 });
  assert.equal(koRateComparable(sure), true);
  assert.equal(koRateComparable(few), false, "fewer than five wins, though nine fights");
  assert.equal(koRateComparable(partial), false, "career held in part: its rate is built from a few of its fights");
  assert.deepEqual(ids(applyControls([few, partial, mid, sure], { sort: "ko" })), [1, 4, 2, 3], "the two comparable ones by rate, then the others by rating and id");
});
