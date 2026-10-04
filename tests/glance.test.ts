import test from "node:test";
import assert from "node:assert/strict";
import { form, goingIn, resultFor, since } from "../lib/glance";

/** The first-glance facts on a fighter's page: the last five results, how long ago, and what an opponent was going into a fight. */
const bout = (id: number, date: string, winnerId: number | null, method: string | null = "UD", extra: Record<string, unknown> = {}) =>
  ({ id, date, winnerId, method, status: "completed", upcoming: false, ...extra }) as never;

test("resultFor: a fight with a result has one, an upcoming or cancelled fight does not", () => {
  assert.equal(resultFor(bout(1, "2020-01-01", 7), 7), "W");
  assert.equal(resultFor(bout(1, "2020-01-01", 8), 7), "L");
  assert.equal(resultFor(bout(1, "2020-01-01", null, "DRAW"), 7), "D");
  assert.equal(resultFor(bout(1, "2020-01-01", null, "NC"), 7), "NC");
  assert.equal(resultFor(bout(1, "2020-01-01", null, null, { upcoming: true }), 7), null, "not fought yet");
  assert.equal(resultFor(bout(1, "2020-01-01", null, null, { status: "cancelled" }), 7), null, "cancelled");
});

test("form: the last five that count in the record, newest first; a no-contest, a cancelled and an upcoming fight are not in it", () => {
  const fights = [
    bout(1, "2019-01-01", 7), bout(2, "2019-06-01", 8), bout(3, "2020-01-01", 7), bout(4, "2020-06-01", null, "NC"),
    bout(5, "2021-01-01", null, null, { status: "cancelled" }), bout(6, "2021-06-01", 7), bout(7, "2022-01-01", null, "DRAW"), bout(8, "2022-06-01", 8),
    bout(9, "2023-01-01", null, null, { upcoming: true }),
  ];
  assert.deepEqual(form(fights, 7), ["L", "D", "W", "W", "L"], "newest first, five of the six that count");
  assert.deepEqual(form(fights, 7, 2), ["L", "D"]);
  assert.deepEqual(form([], 7), []);
  assert.deepEqual(form([bout(1, "2019-01-01", 7)], 7), ["W"], "a short career gives a short strip");
});

test("since: the unit a person would say, and nothing for a date in the future", () => {
  assert.deepEqual(since("2026-10-03", "2026-10-03"), { unit: "days", n: 0 });
  assert.deepEqual(since("2026-10-03", "2026-09-26"), { unit: "days", n: 7 });
  assert.deepEqual(since("2026-10-03", "2026-08-05"), { unit: "days", n: 59 }, "under two months is still days");
  assert.deepEqual(since("2026-10-03", "2026-08-03"), { unit: "months", n: 2 });
  assert.deepEqual(since("2026-10-03", "2025-02-01"), { unit: "months", n: 20 });
  assert.deepEqual(since("2026-10-03", "2024-10-03"), { unit: "years", n: 2 });
  assert.deepEqual(since("2026-10-03", "2014-03-26"), { unit: "years", n: 12 });
  assert.equal(since("2026-10-03", "2026-10-04"), null, "a fight in the future is not 'ago'");
  assert.equal(since("2026-10-03", "not a date"), null);
});

test("goingIn: the opponent's record before the fight, only when their whole career is held", () => {
  const theirs = [bout(1, "2018-01-01", 9), bout(2, "2018-06-01", 9), bout(3, "2019-01-01", 5), bout(4, "2019-06-01", null, "DRAW"), bout(5, "2020-01-01", 9), bout(6, "2021-01-01", 9)];
  assert.deepEqual(goingIn(theirs, 5, 9, 1612, true), { rating: 1612, record: "2-1-1", debut: false }, "the fight itself and later ones are not counted");
  assert.deepEqual(goingIn(theirs, 1, 9, 1500, true), { rating: 1500, record: null, debut: true }, "their first fight: a debut, not '0-0-0'");
  assert.deepEqual(goingIn(theirs, 5, 9, 1612, false), { rating: 1612, record: null, debut: false }, "a career held in part: the count would be short, so no record is stated");
  assert.deepEqual(goingIn(theirs, 1, 9, 1500, false), { rating: 1500, record: null, debut: false }, "and a partial career is never called a debut");
  const withNc = [bout(1, "2018-01-01", 9), bout(2, "2018-06-01", null, "NC"), bout(3, "2019-01-01", 5)];
  assert.equal(goingIn(withNc, 3, 9, 1500, true).record, "1-0-0", "a no-contest is not in a record");
  const withCancelled = [bout(1, "2018-01-01", 9), bout(2, "2018-06-01", null, null, { status: "cancelled" }), bout(3, "2019-01-01", 5)];
  assert.equal(goingIn(withCancelled, 3, 9, 1500, true).record, "1-0-0", "a cancelled fight is not either");
});
