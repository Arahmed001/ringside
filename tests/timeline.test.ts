import test from "node:test";
import assert from "node:assert/strict";
import { yearTicks } from "../lib/timeline";

test("year ticks: only years whose 1 January is inside the strip, so none is pushed onto its neighbour", () => {
  // a belt that began in June 2019 and runs to 3 October 2026: 2020 to 2026, no 2019
  const t = yearTicks("2019-06-14", "2026-10-03");
  assert.deepEqual(t.map((x) => x.year), [2020, 2021, 2022, 2023, 2024, 2025, 2026]);
  assert.ok(t.every((x) => x.at >= 0 && x.at <= 1), "every tick is on the strip");
  assert.ok(t[0].at > 0.05, "the first label is not on the left edge (it was clamped there before, on top of the next)");
  // a strip that starts exactly on 1 January labels that year, at 0
  assert.deepEqual(yearTicks("2020-01-01", "2022-06-01").map((x) => x.year), [2020, 2021, 2022]);
  assert.equal(yearTicks("2020-01-01", "2022-06-01")[0].at, 0);
});

test("year ticks: at most `max`, evenly thinned, and the positions follow the dates", () => {
  const long = yearTicks("1980-03-01", "2026-10-03");
  assert.ok(long.length <= 8 && long.length >= 4, `${long.length} ticks`);
  const gaps = long.slice(1).map((x, i) => x.year - long[i].year);
  assert.equal(new Set(gaps).size, 1, "one step between labels");
  const t = yearTicks("2020-01-01", "2024-01-01", 99);
  assert.deepEqual(t.map((x) => [x.year, Math.round(x.at * 4)]), [[2020, 0], [2021, 1], [2022, 2], [2023, 3], [2024, 4]], "a quarter of the way per year, leap day aside");
  assert.ok(Math.min(...t.slice(1).map((x, i) => x.at - t[i].at)) > 0.2);
});

test("year ticks: a strip shorter than a year, or backwards, has none and does not divide by zero", () => {
  assert.deepEqual(yearTicks("2026-02-01", "2026-09-01"), []);
  assert.deepEqual(yearTicks("2026-02-01", "2026-02-01"), []);
  assert.deepEqual(yearTicks("2026-09-01", "2025-01-01"), []);
});
