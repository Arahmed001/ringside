import test from "node:test";
import assert from "node:assert/strict";
import { numbersOf } from "../lib/by-the-numbers";

const F = 7;
const bout = (id: number, date: string, method: string | null, winnerId: number | null, o: Record<string, unknown> = {}) =>
  ({ id, date, method, winnerId, status: "completed", upcoming: false, rounds: 12, endRound: null, eventId: id, ...o }) as never;
const events: Record<number, { country: string; venue: string; city: string }> = {
  1: { country: "England", venue: "The O2", city: "London" }, 2: { country: "England", venue: "The O2", city: "London" },
  3: { country: "United States", venue: "MSG", city: "New York" }, 4: { country: "England", venue: "Wembley", city: "London" }, 5: { country: "Mexico", venue: "Arena", city: "Mexico City" },
};
const ev = (id: number) => events[id];

const career = [
  bout(1, "2018-01-10", "KO", F, { endRound: 1, rounds: 10 }),
  bout(2, "2018-06-10", "TKO", F, { endRound: 3, rounds: 10 }),
  bout(3, "2019-02-10", "UD", F, { rounds: 12 }),
  bout(4, "2020-09-10", "KO", 8, { endRound: 2, rounds: 12 }), // a loss inside three rounds: a stoppage, but not his win
  bout(5, "2022-05-10", "DRAW", null, { rounds: 12 }),
];

test("rounds boxed, the distance rate, quick wins, where he fought, the busiest year and the longest layoff", () => {
  const n = numbersOf(career, F, ev);
  assert.equal(n.fights, 5);
  assert.equal(n.rounds, 1 + 3 + 12 + 2 + 12, "a stoppage counts the round it ended in, a decision or draw its scheduled rounds");
  assert.deepEqual(n.distance, { n: 2, of: 5 }, "the decision and the draw went the distance");
  assert.equal(n.quick, 2, "wins by stoppage inside three rounds: round 1 and round 3, not his round-2 loss and not the decision");
  assert.deepEqual(n.countries, [{ name: "England", n: 3 }, { name: "Mexico", n: 1 }, { name: "United States", n: 1 }]);
  assert.deepEqual(n.venue, { name: "The O2", city: "London", n: 2 });
  assert.deepEqual(n.busiestYear, { year: 2018, n: 2 });
  assert.equal(n.layoff?.from, "2020-09-10"); assert.equal(n.layoff?.to, "2022-05-10"); assert.equal(n.layoff?.days, 607);
});

test("what is not counted: a no-contest, a cancelled fight, an upcoming fight; and a technical decision ended early, so it is not 'the distance'", () => {
  const n = numbersOf([
    bout(1, "2018-01-10", "UD", F), bout(2, "2018-03-10", "NC", null, { rounds: 10 }),
    bout(3, "2018-05-10", null, null, { status: "cancelled" }), bout(4, "2030-01-10", null, null, { upcoming: true }),
    bout(5, "2018-07-10", "TD", F, { endRound: 4 }),
  ], F, ev);
  assert.equal(n.fights, 2);
  assert.deepEqual(n.distance, { n: 1, of: 2 });
  assert.equal(n.rounds, 12 + 4);
});

test("a figure the data cannot give is null, not a guess: a stoppage with no round, a decision with no scheduled rounds", () => {
  assert.equal(numbersOf([bout(1, "2018-01-10", "KO", F), bout(2, "2018-06-10", "UD", F)], F, ev).rounds, null, "the knockout has no round");
  assert.equal(numbersOf([bout(1, "2018-01-10", "KO", F)], F, ev).quick, null);
  assert.equal(numbersOf([bout(1, "2018-01-10", "UD", F, { rounds: 0 })], F, ev).rounds, null, "no scheduled rounds");
  assert.equal(numbersOf([bout(1, "2018-01-10", "UD", F)], F, ev).quick, 0, "no stoppage wins is a true zero, not an unknown");
});

test("a venue, a year or a layoff is shown only when it says something: twice or more, half a year or more", () => {
  const n = numbersOf([bout(1, "2018-01-10", "UD", F), bout(3, "2019-02-10", "UD", F), bout(5, "2019-06-10", "UD", F)], F, ev);
  assert.equal(n.venue, null, "three different venues");
  assert.deepEqual(n.busiestYear, { year: 2019, n: 2 });
  assert.equal(n.layoff?.days, 396, "January 2018 to February 2019");
  assert.equal(numbersOf([bout(1, "2018-01-10", "UD", F), bout(3, "2018-05-10", "UD", F)], F, ev).layoff, null, "a four-month gap is not a layoff");
  assert.equal(numbersOf([bout(1, "2018-01-10", "UD", F)], F, ev).busiestYear, null);
});

test("a fight whose event is unknown still counts, it just adds no place", () => {
  const n = numbersOf([bout(1, "2018-01-10", "UD", F, { eventId: 99 })], F, ev);
  assert.equal(n.fights, 1); assert.deepEqual(n.countries, []); assert.equal(n.venue, null);
});
