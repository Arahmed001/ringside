import test from "node:test";
import assert from "node:assert/strict";
import { grade, type PickInfo } from "../lib/picks-grade";

/** A visitor's picks graded against results and against the model's pre-fight call. Pure logic: the browser runs it. */
const info = (id: number, date: string, status: PickInfo["status"], winner: "red" | "blue" | null, modelPRed: number | null): PickInfo => ({
  boutId: id, date, eventName: `Night ${id}`, red: { id: id * 10 + 1, name: `R${id}` }, blue: { id: id * 10 + 2, name: `B${id}` },
  status, winnerId: winner === "red" ? id * 10 + 1 : winner === "blue" ? id * 10 + 2 : null, modelPRed,
});
const red = (id: number) => id * 10 + 1, blue = (id: number) => id * 10 + 2;

test("each pick is right, wrong, pending or void according to the fight, and never graded before there is a result", () => {
  const infos = [
    info(1, "2026-01-01", "decided", "red", 0.7), info(2, "2026-01-02", "decided", "red", 0.7), info(3, "2026-01-03", "upcoming", null, 0.6),
    info(4, "2026-01-04", "void", null, 0.6), info(5, "2026-01-05", "cancelled", null, null), info(6, "2026-01-06", "awaiting", null, 0.5),
  ];
  const { rows, summary: s } = grade({ 1: red(1), 2: blue(2), 3: red(3), 4: red(4), 5: red(5), 6: blue(6) }, infos);
  const state = (id: number) => rows.find((r) => r.info.boutId === id)!.state;
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(state), ["right", "wrong", "pending", "void", "void", "pending"]);
  assert.deepEqual({ made: s.made, graded: s.graded, right: s.right, pending: s.pending, voided: s.voided }, { made: 6, graded: 2, right: 1, pending: 2, voided: 2 });
  assert.equal(s.accuracy, 0.5);
});

test("a pick for someone who is not in the fight, or for a fight we know nothing about, is ignored", () => {
  const { rows, summary } = grade({ 1: 999, 77: 5 }, [info(1, "2026-01-01", "decided", "red", 0.7)]);
  assert.equal(rows.length, 0); assert.equal(summary.made, 0); assert.equal(summary.accuracy, 0);
});

test("the model is compared only on graded fights it had a prediction for, and the four outcomes add up", () => {
  const infos = [
    info(1, "2026-01-01", "decided", "red", 0.8),  // you red (right), model red (right): both
    info(2, "2026-01-02", "decided", "red", 0.2),  // you red (right), model blue (wrong): you only
    info(3, "2026-01-03", "decided", "blue", 0.9), // you red (wrong), model red (wrong): neither
    info(4, "2026-01-04", "decided", "blue", 0.1), // you red (wrong), model blue (right): model only
    info(5, "2026-01-05", "decided", "red", null), // you right, but the model had nothing on file: not compared
    info(6, "2026-01-06", "upcoming", null, 0.9),  // not graded
  ];
  const { summary: s } = grade(Object.fromEntries(infos.map((i) => [i.boutId, i.red.id])), infos);
  assert.deepEqual(s.versus, { both: 1, youOnly: 1, modelOnly: 1, neither: 1, n: 4 });
  assert.equal(s.versus.both + s.versus.youOnly + s.versus.modelOnly + s.versus.neither, s.versus.n);
  assert.deepEqual(s.model, { n: 4, right: 2, accuracy: 0.5 });
  assert.equal(s.graded, 5); assert.equal(s.right, 3);
  const row = grade({ 5: red(5) }, [infos[4]]).rows[0];
  assert.equal(row.model, null); assert.equal(row.modelPickId, null);
});

test("a 50% prediction counts as a pick for red, the same rule the track record uses", () => {
  const { rows } = grade({ 1: red(1) }, [info(1, "2026-01-01", "decided", "red", 0.5)]);
  assert.equal(rows[0].modelPickId, red(1)); assert.equal(rows[0].model, "right");
});

test("streak: counted in date order whatever order the picks came in, broken by a wrong pick, void fights neither add nor break", () => {
  const infos = [
    info(1, "2026-01-01", "decided", "red", 0.6), info(2, "2026-01-02", "decided", "red", 0.6), info(3, "2026-01-03", "decided", "red", 0.6),
    info(4, "2026-01-04", "decided", "blue", 0.6), // wrong
    info(5, "2026-01-05", "void", null, 0.6),
    info(6, "2026-01-06", "decided", "red", 0.6), info(7, "2026-01-07", "decided", "red", 0.6),
  ];
  const picks = Object.fromEntries(infos.map((i) => [i.boutId, i.red.id]));
  const shuffled = [infos[6], infos[2], infos[0], infos[4], infos[3], infos[5], infos[1]];
  const { summary: s } = grade(picks, shuffled);
  assert.deepEqual(s.streak, { current: 2, best: 3 }, "3 right, a miss, a void, 2 right");
  const { summary: ended } = grade({ ...picks }, infos.slice(0, 4));
  assert.deepEqual(ended.streak, { current: 0, best: 3 }, "a wrong pick last leaves no current streak");
});

test("rows are listed newest first, and an empty set of picks is a clean zero", () => {
  const infos = [info(1, "2026-01-01", "decided", "red", 0.6), info(2, "2026-02-01", "upcoming", null, 0.6)];
  assert.deepEqual(grade({ 1: red(1), 2: red(2) }, infos).rows.map((r) => r.info.boutId), [2, 1]);
  const z = grade({}, infos).summary;
  assert.deepEqual({ made: z.made, graded: z.graded, accuracy: z.accuracy, current: z.streak.current }, { made: 0, graded: 0, accuracy: 0, current: 0 });
});
