import test from "node:test";
import assert from "node:assert/strict";
import "./db-isolation";
import { cleanText } from "../lib/providers/boxing-data-api";

/** Notes is a bag of counters; the function only adds to `textCleaned`. */
const notes = () => ({ textCleaned: 0 }) as unknown as Parameters<typeof cleanText>[1];

test("a name with its unicode escapes still in it is decoded (two on the first real league: Rodríguez, Solís)", () => {
  const n = notes();
  assert.equal(cleanText("Diego Rodr\\u00edguez Soancartl", n), "Diego Rodríguez Soancartl");
  assert.equal(cleanText("Roberto Leal Sol\\[u00eds]", n), "Roberto Leal Solís", "the stray bracketed form");
  assert.equal(cleanText("Smile \\ud83d\\ude00", n), "Smile 😀", "a surrogate pair");
  assert.equal(n.textCleaned, 3, "each is counted as changed");
});

test("an escape that hides a control or a direction override is decoded and then removed like any other", () => {
  const n = notes();
  assert.equal(cleanText("Ab\\u202ecd\\u0000ef", n), "Abcdef");
});

test("a name that runs on into the JSON of its record is cut where the next key begins (one on the first real league)", () => {
  const n = notes();
  assert.equal(cleanText('Kevin P", "nationality": "Mexico", "nationality_code": "MX", "boxing_record": { "wins": 6 }', n), "Kevin P");
  assert.equal(n.textCleaned, 1);
});

test("ordinary text is untouched: quotes, commas, backslashes and the word u00ed without a backslash", () => {
  const n = notes();
  for (const t of ['Anthony "Pitbull" Cruz', 'Rodrigo "El Toro", Jr.', "C:\\temp name", "u00ed", "O'Brien, Conor", 'He said "hello", then left']) assert.equal(cleanText(t, n), t, t);
  assert.equal(n.textCleaned, 0);
});
