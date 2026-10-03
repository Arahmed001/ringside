import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { tempDb } from "./helpers";
import { battery, type Case } from "./ask-battery";

const cleanup = tempDb("ask-battery");
after(cleanup);

type World = Awaited<ReturnType<typeof import("../lib/world").getWorld>>;
let w: World;
let cases: Case[];
let plan: (q: string) => { tool: string; args: Record<string, unknown> }[];
before(async () => {
  w = await (await import("../lib/world")).getWorld();
  const { planByRules } = await import("../lib/ask/rules");
  cases = battery(w);
  plan = (q) => planByRules(q, w, {}) as never;
});

/** What a case expects, and whether the planner's first call is it. */
function problem(c: Case): string | null {
  const calls = plan(c.q), first = calls[0];
  if (c.tool === null) return calls.length === 0 ? null : `answered with ${first.tool}${JSON.stringify(first.args)}; the honest answer is none`;
  const want = Array.isArray(c.tool) ? c.tool : [c.tool];
  if (!first) return `no tool; wanted ${want.join("|")}`;
  if (!want.includes(first.tool)) return `${first.tool}${JSON.stringify(first.args)}; wanted ${want.join("|")}`;
  for (const [k, v] of Object.entries(c.args ?? {})) if (JSON.stringify(first.args[k]) !== JSON.stringify(v)) return `${first.tool} has ${k}=${JSON.stringify(first.args[k])}; wanted ${JSON.stringify(v)}`;
  return null;
}

test("the question battery: every question is read as a sensible reader would read it (or honestly not at all)", () => {
  assert.ok(cases.length >= 200, `${cases.length} questions`);
  const bad = cases.map((c) => [c, problem(c)] as const).filter(([, p]) => p).map(([c, p]) => `"${c.q}": ${p}`);
  assert.deepEqual(bad, []);
});

test("the battery covers every tool, both languages, and questions that should get no answer", async () => {
  const tools = new Set(cases.flatMap((c) => (c.tool === null ? [] : Array.isArray(c.tool) ? c.tool : [c.tool])));
  const { TOOLS } = await import("../lib/ask/tools");
  assert.deepEqual(TOOLS.map((t) => t.name).filter((n) => !tools.has(n)), [], "a tool no question in the battery is meant to reach");
  assert.ok(cases.filter((c) => c.lang === "ar").length >= 15);
  assert.ok(cases.filter((c) => c.tool === null).length >= 15);
});

test("a question with a year is never answered from an all-time list (the list has no year, so the answer would look right and be wrong)", () => {
  for (const q of ["who has the most knockouts in 2024", "most wins in 2023", "longest win streak this year", "highest ko rate during 2022", "greatest boxer of 2021"]) {
    const calls = plan(q);
    assert.ok(!calls.some((c) => c.tool === "record_list"), `${q} -> ${JSON.stringify(calls)}`);
  }
  // and the same list with no year still is
  assert.equal(plan("who has the most knockouts")[0].tool, "record_list");
});

test("names are found beside punctuation and possessives, and a name that is also a boxer's is not stolen from the trainers tool by a trainer word", () => {
  const names = w.boxers.slice().sort((a, b) => b.rating - a.rating).slice(0, 2).map((b) => b.name);
  assert.equal(plan(`what is ${names[0]}'s record`)[0].tool, "fighter");
  assert.equal(plan(`${names[0]}, who is better than ${names[1]}?`)[0].tool, "head_to_head");
  assert.equal(plan(`${names[0]} vs ${names[1]}: who wins?`)[0].tool, "head_to_head");
  assert.equal(plan(`“${names[0]}”`)[0].tool, "fighter");
});

test("the bouts tool's 'stoppage' and 'decision' groups mean KO/TKO/retirement and any decision, and count the right fights", async () => {
  const { TOOLS } = await import("../lib/ask/tools");
  const { tEn } = await import("../lib/i18n/t");
  const { isDecision, isStoppage } = await import("../lib/methods");
  const bouts = TOOLS.find((t) => t.name === "bouts")!;
  const done = w.bouts.filter((b) => !b.upcoming && b.status === "completed" && !!b.method); // as the tool counts them: a no contest is a completed fight with a result on record
  const total = (args: Record<string, unknown>) => Number(bouts.run({ w, t: tEn, names: {} }, args).lines[0].match(/^(\d+) completed/)![1]);
  const all = total({}), stop = total({ method: "stoppage" }), dec = total({ method: "decision" });
  assert.equal(all, done.length);
  assert.equal(stop, done.filter((b) => isStoppage(b.method)).length);
  assert.equal(dec, done.filter((b) => isDecision(b.method)).length);
  assert.ok(stop > 0 && dec > 0 && stop < all && dec < all, "each group is a real subset");
  assert.equal(total({ method: "KO" }) + total({ method: "TKO" }) + total({ method: "RTD" }), stop, "the group is exactly the three");
});

test("a knockout rate named in words is read as a filter: 'knockout rate over 70%'", async () => {
  const { heuristicParse } = await import("../lib/ai");
  assert.equal(heuristicParse("fighters with a knockout rate over 70%", []).minKoRate, 0.7);
  assert.equal(heuristicParse("ko percentage above 60 %", []).minKoRate, 0.6);
  assert.equal(heuristicParse("80% knockouts", []).minKoRate, 0.8, "the older form still works");
  assert.equal(heuristicParse("knockout rate", []).minKoRate, undefined, "no number, no filter");
});
