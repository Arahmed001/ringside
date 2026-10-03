import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { tempDb } from "./helpers";
import { judge, nameCases, type NameCase } from "./ask-names-battery";

/** The generated battery (tests/ask-names-battery.ts) over the demo league: how well the rule-based Ask planner reads names spelt with a slip, group by group. */
const cleanup = tempDb("ask-names-battery");
after(cleanup);

type World = Awaited<ReturnType<typeof import("../lib/world").getWorld>>;
let w: World;
let ar: Record<string, string>;
let cases: NameCase[];
const wrong = new Map<NameCase, string>();
before(async () => {
  delete process.env.ANTHROPIC_API_KEY;
  w = await (await import("../lib/world")).getWorld();
  ar = await (await import("../lib/i18n/names")).getNames("ar");
  cases = nameCases(w, ar);
  for (const c of cases) { const p = await judge(w, c, ar); if (p) wrong.set(c, p); }
});

const rate = (group: NameCase["group"]) => { const all = cases.filter((c) => c.group === group); return { n: all.length, ok: all.filter((c) => !wrong.has(c)).length }; };
const show = (group: NameCase["group"]) => [...wrong].filter(([c]) => c.group === group).slice(0, 8).map(([c, p]) => `${c.q} => ${p}`).join("\n");

test("the battery is big enough to mean something, in every group, in both languages, for fighters, pairs and trainers", () => {
  for (const g of ["A", "B", "C", "N"] as const) assert.ok(rate(g).n >= 40, `group ${g}: ${rate(g).n}`);
  assert.ok(cases.filter((c) => c.ar).length >= 40, "Arabic cases");
  assert.ok(cases.filter((c) => c.tool === "head_to_head").length >= 40, "pairs");
  assert.ok(cases.filter((c) => c.tool === "trainers").length >= 100, "trainers");
  assert.ok(new Set(cases.map((c) => c.kind)).size >= 25, "kinds of slip");
});

test("a name written as it should be is always read (the controls), and a name that is nobody's is never made someone's", () => {
  const controls = cases.filter((c) => /\(control\)|^all lower case$|^accents left off$/.test(c.kind));
  assert.ok(controls.length >= 60);
  assert.deepEqual(controls.filter((c) => wrong.has(c)).map((c) => `${c.q} => ${wrong.get(c)}`), []);
  assert.equal(rate("N").ok, rate("N").n, show("N"));
});

test("names spelt with a slip are read in at least 97% of the questions of each group, and at least 90% of each kind of slip", () => {
  for (const g of ["A", "B", "C"] as const) { const { n, ok } = rate(g); assert.ok(ok / n >= 0.97, `group ${g}: ${ok}/${n}\n${show(g)}`); }
  const kinds = new Map<string, NameCase[]>();
  for (const c of cases) kinds.set(c.kind, [...(kinds.get(c.kind) ?? []), c]);
  for (const [k, cs] of kinds) if (cs.length >= 8) { const ok = cs.filter((c) => !wrong.has(c)).length; assert.ok(ok / cs.length >= 0.9, `${k}: ${ok}/${cs.length}`); }
});
