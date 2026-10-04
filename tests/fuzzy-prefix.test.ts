import test from "node:test";
import assert from "node:assert/strict";
import { editDistance, prefixDistance } from "../lib/fuzzy";

/** The original, one table per prefix: the single-pass `prefixDistance` must answer exactly as this does for every pair. */
function reference(typed: string, word: string, max: number): number {
  if (word.startsWith(typed)) return 0;
  let best = max + 1;
  for (let len = Math.max(1, typed.length - 1); len <= Math.min(word.length, typed.length + 1); len++) best = Math.min(best, editDistance(typed, word.slice(0, len), max));
  return best;
}

/** a small alphabet and a seeded generator, so slips, swaps and shared starts all come up often */
function random(seed: number) { let s = seed; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32; }

test("prefixDistance answers exactly as one table per prefix did, over thousands of near and far pairs", () => {
  const r = random(7), letters = "abcde";
  const word = (min: number, span: number) => Array.from({ length: min + Math.floor(r() * span) }, () => letters[Math.floor(r() * letters.length)]).join("");
  let compared = 0, close = 0;
  for (let i = 0; i < 20000; i++) {
    const w = word(1, 10);
    let typed = r() < 0.5 ? word(1, 8) : w.slice(0, 1 + Math.floor(r() * w.length)); // half unrelated, half the start of the word
    if (r() < 0.6 && typed.length > 1) { // then a slip: drop, change, add or swap a letter
      const k = Math.floor(r() * typed.length), kind = Math.floor(r() * 4);
      typed = kind === 0 ? typed.slice(0, k) + typed.slice(k + 1) : kind === 1 ? typed.slice(0, k) + letters[Math.floor(r() * 5)] + typed.slice(k + 1) : kind === 2 ? typed.slice(0, k) + letters[Math.floor(r() * 5)] + typed.slice(k) : (k + 1 < typed.length ? typed.slice(0, k) + typed[k + 1] + typed[k] + typed.slice(k + 2) : typed);
    }
    for (const max of [0, 1, 2]) {
      const a = prefixDistance(typed, w, max), b = reference(typed, w, max);
      assert.equal(a, b, `typed "${typed}" word "${w}" max ${max}`);
      compared++; if (a <= max && a > 0) close++;
    }
  }
  assert.ok(compared === 60000 && close > 2000, `the sample has plenty of one- and two-slip prefixes (${close})`);
});

test("the cases the scan depends on: a start is free, a missing, added, wrong or swapped letter is one slip, a word too short has none", () => {
  assert.equal(prefixDistance("balog", "balogun", 1), 0);
  assert.equal(prefixDistance("balgun", "balogun", 1), 1, "a letter missing");
  assert.equal(prefixDistance("baloogun", "balogun", 2) <= 2, true);
  assert.equal(prefixDistance("blaogun", "balogun", 1), 1, "two neighbours swapped");
  assert.equal(prefixDistance("kalogun", "balogun", 1), 1, "a letter wrong");
  assert.equal(prefixDistance("balogun", "ba", 1), 2, "a word shorter than what was typed cannot match it");
  assert.equal(prefixDistance("zzzzzz", "balogun", 1), 2, "far apart: reported as more than the allowance");
});
