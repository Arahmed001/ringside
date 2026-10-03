import test from "node:test";
import assert from "node:assert/strict";
import { paginate } from "../lib/paging";

test("paging: every result is reachable, and a bad page number lands on a real page", () => {
  assert.deepEqual(paginate(63, undefined, 48), { page: 1, pages: 2, first: 0 });
  assert.deepEqual(paginate(63, "2", 48), { page: 2, pages: 2, first: 48 });
  assert.deepEqual(paginate(48, "2", 48), { page: 1, pages: 1, first: 0 }, "exactly one page: page 2 is clamped back");
  assert.deepEqual(paginate(49, "2", 48), { page: 2, pages: 2, first: 48 });
  assert.equal(paginate(63, "99", 48).page, 2, "beyond the end");
  for (const bad of ["abc", "", "0", "-3", "NaN", "Infinity", undefined]) assert.equal(paginate(63, bad, 48).page, 1, String(bad));
  assert.equal(paginate(63, "1.9", 48).page, 1, "fractions round down");
  assert.deepEqual(paginate(0, "5", 48), { page: 1, pages: 1, first: 0 }, "an empty list has one empty page");
  let seen = 0; const total = 177;
  for (let p = 1; p <= paginate(total, undefined, 48).pages; p++) seen += Math.min(48, total - paginate(total, String(p), 48).first);
  assert.equal(seen, total, "the pages together cover the whole list");
});
