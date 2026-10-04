import test from "node:test";
import assert from "node:assert/strict";
import { dictOf } from "../lib/i18n/dicts";

test("no Arabic string states a limit with ≥ or ≤ (round 56)", () => {
  // in a right-to-left line the signs are mirrored, so "سلسلة انتصارات ≥ 2" is drawn with the arrow of "at most" and reads either way; the words "فأكثر" and "فأقل" do not
  const bad = Object.entries(dictOf("ar")).filter(([, v]) => typeof v === "string" && /[≥≤]/.test(v)).map(([k]) => k);
  assert.deepEqual(bad, []);
});
