import test from "node:test";
import assert from "node:assert/strict";
import { careerStrip, stripLabels } from "../lib/career-strip";

const D = (years: number[]) => years.map((y) => `${y}-06-01`);

test("a career held in part: the years drawn, the fights held in each, the years before the first one marked as not in the data", () => {
  const s = careerStrip({ dates: D([2016, 2016, 2018, 2018, 2018, 2020]), total: 12, turnedPro: 2013 })!;
  assert.equal(s.fromYear, 2013); assert.equal(s.toYear, 2020); assert.equal(s.firstHeldYear, 2016); assert.equal(s.debutYear, 2013);
  assert.equal(s.held, 6); assert.equal(s.total, 12);
  assert.deepEqual(s.years.map((y) => [y.year, y.held, y.missing]), [[2013, 0, true], [2014, 0, true], [2015, 0, true], [2016, 2, false], [2017, 0, false], [2018, 3, false], [2019, 0, false], [2020, 1, false]]);
});

test("no debut year: the strip begins at the first fight held and nothing is claimed about the years before", () => {
  const s = careerStrip({ dates: D([2019, 2021]), total: 9, turnedPro: null })!;
  assert.equal(s.debutYear, null); assert.equal(s.fromYear, 2019); assert.deepEqual(s.years.map((y) => y.missing), [false, false, false]);
  const fromDate = careerStrip({ dates: D([2019]), total: 3, turnedPro: null, debutDate: "2015-03-02" })!;
  assert.equal(fromDate.debutYear, 2015, "a debut date is as good as a debut year");
});

test("a debut at or after the first fight held is an inconsistency in the data and is not drawn as a gap; absurd years are ignored", () => {
  assert.equal(careerStrip({ dates: D([2016, 2018]), total: 5, turnedPro: 2016 })!.debutYear, null, "the same year: nothing before");
  assert.equal(careerStrip({ dates: D([2016, 2018]), total: 5, turnedPro: 2019 })!.debutYear, null, "a debut after the first fight: ignored");
  assert.equal(careerStrip({ dates: D([2016, 2018]), total: 5, turnedPro: 1066 })!.debutYear, null, "an impossible year: ignored");
  assert.equal(careerStrip({ dates: ["bad", "2016-01-01", "0000-01-01"], total: 3, turnedPro: null })!.held, 1, "unreadable dates are not fights held");
});

test("nothing to explain: no fights held, or the fights held are the whole career", () => {
  assert.equal(careerStrip({ dates: [], total: 10, turnedPro: 2010 }), null);
  assert.equal(careerStrip({ dates: D([2016, 2017, 2018]), total: 3, turnedPro: 2010 }), null, "3 of 3");
  assert.equal(careerStrip({ dates: D([2016, 2017, 2018]), total: 2, turnedPro: 2010 }), null, "more held than the total (a disputed record) is the record's business, not the strip's");
});

test("a single year of fights, and a long career, are drawn", () => {
  const one = careerStrip({ dates: D([2022, 2022]), total: 4, turnedPro: null })!;
  assert.deepEqual(one.years, [{ year: 2022, held: 2, missing: false }]);
  const long = careerStrip({ dates: D([1990, 2024]), total: 60, turnedPro: 1988 })!;
  assert.equal(long.years.length, 37); assert.equal(long.years.filter((y) => y.missing).length, 2);
});

test("labels: every year when there are few, and otherwise the first, the last and an even spread, never more than the most asked for", () => {
  assert.deepEqual(stripLabels([2020, 2021, 2022]), [2020, 2021, 2022]);
  const years = Array.from({ length: 37 }, (_, i) => 1988 + i);
  const labels = stripLabels(years, 8);
  assert.ok(labels.length <= 8 && labels[0] === 1988 && labels.at(-1) === 2024, labels.join());
  assert.deepEqual(labels, [...labels].sort((a, b) => a - b)); assert.equal(new Set(labels).size, labels.length);
  const two = stripLabels(Array.from({ length: 9 }, (_, i) => 2000 + i), 8);
  assert.ok(two.length <= 8 && two[0] === 2000 && two.at(-1) === 2008, two.join());
});
