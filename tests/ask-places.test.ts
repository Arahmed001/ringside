import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { tempDb } from "./helpers";
import { tEn } from "../lib/i18n/t";

/**
 * A place in a ranking ("who is ranked number two at welterweight" used to be answered with the number one), a measure to sort by ("the tallest heavyweight"
 * was the highest rated one), and counts ("how many fighters are there" got no answer). Each checked against the league's own data.
 */
const cleanup = tempDb("ask-places");
after(cleanup);

type World = Awaited<ReturnType<typeof import("../lib/world").getWorld>>;
let w: World;
let ask: typeof import("../lib/ask").askData;
let rk: typeof import("../lib/rankings");
before(async () => {
  w = await (await import("../lib/world")).getWorld();
  ask = (await import("../lib/ask")).askData;
  rk = await import("../lib/rankings");
});
const run = (q: string) => ask(q, { w, t: tEn, names: {} });

test("a place in a ranking is the fighter in that place, in a division and pound for pound", async () => {
  const rows = rk.rankDivision(w, "Welterweight", 25, "male");
  assert.ok(rows.length >= 5);
  for (const [q, n] of [["who is ranked number two at welterweight", 2], ["who is ranked third in the welterweight division", 3], ["who is the second best welterweight", 2], ["who is the 3rd best welterweight", 3], ["who is number four at welterweight", 4], ["who is number 5 at welterweight", 5], ["who is the fifth best welterweight", 5]] as [string, number][]) {
    const a = await run(q);
    assert.deepEqual(a.calls[0], { tool: "rankings", args: { division: "Welterweight", position: n } }, q);
    assert.equal(a.answer, `Welterweight rankings: ${rows[n - 1].boxer.name} is number ${n} (${(await import("../lib/world")).recordStr(rows[n - 1].boxer)}, rated ${Math.round(rows[n - 1].boxer.rating)}).`, q);
  }
  const p4p = rk.pound4pound(w, 5, "male");
  const second = await run("who is second in the pound for pound rankings");
  assert.deepEqual(second.calls[0].args, { position: 2 });
  assert.match(second.answer, new RegExp(`^Pound for pound: ${p4p[1].name} is number 2 `));
  assert.match((await run("who is the fifth best fighter in the world")).answer, new RegExp(`${p4p[4].name} is number 5 `));
  // the number one is the plain ranking, and a place nobody holds is no answer
  assert.deepEqual((await run("who is the number one welterweight")).calls[0], { tool: "rankings", args: { division: "Welterweight" } });
  const none = await run("who is number 25 at flyweight");
  assert.equal(none.answer, "Nobody is ranked there.", "flyweight has fewer than 25 ranked: say so, not another fighter");
  // an ordinal that is not about rankings is not a place in one
  for (const q of ["who won the third fight of the card", "what happened in the second round", "the first fight of the year", "who won the second welterweight fight last year", "the third welterweight bout on the card"]) assert.ok(!(await run(q)).calls.some((c) => c.args.position !== undefined), q);
});

test("a superlative of a measure is the order to sort by, and the first fighter listed is the one it names", async () => {
  const pool = (f: (b: World["boxers"][number]) => boolean) => w.boxers.filter((b) => b.bouts > 0 && f(b));
  const first = async (q: string) => { const a = await run(q); return { a, name: a.results[0]?.tables[0]?.rows[0]?.[1] as { text: string } | undefined }; };
  const tall = Math.max(...pool((b) => b.weightClass === "Heavyweight" && b.sex === "male" && b.heightCm !== null).map((b) => b.heightCm!));
  const tallest = await first("who is the tallest heavyweight");
  assert.equal(tallest.a.calls[0].args.sort, "height");
  assert.equal(w.boxers.find((b) => b.name === tallest.name!.text)!.heightCm, tall);
  const short = Math.min(...pool((b) => b.heightCm !== null).map((b) => b.heightCm!));
  const shortest = await first("who is the shortest fighter");
  assert.equal(shortest.a.calls[0].args.sort, "shortest");
  assert.equal(w.boxers.find((b) => b.name === shortest.name!.text)!.heightCm, short);
  const young = Math.min(...pool((b) => b.age !== null).map((b) => b.age!));
  const youngest = await first("who is the youngest fighter in the database");
  assert.equal(youngest.a.calls[0].args.sort, "youngest");
  assert.equal(w.boxers.find((b) => b.name === youngest.name!.text)!.age, young);
  const old = Math.max(...pool((b) => b.active && b.age !== null).map((b) => b.age!));
  const oldest = await first("who is the oldest active boxer");
  assert.deepEqual([oldest.a.calls[0].args.sort, oldest.a.calls[0].args.active, oldest.a.calls[0].args.minAge], ["age", true, undefined], "an age to sort by, not a filter at 35");
  assert.equal(w.boxers.find((b) => b.name === oldest.name!.text)!.age, old);
  // "young" is still a group, and the words that contain these are not the measure
  const { heuristicParse } = await import("../lib/ai");
  assert.equal(heuristicParse("young heavyweights", []).maxAge, 26);
  assert.equal(heuristicParse("young heavyweights", []).sort, undefined);
  assert.equal(heuristicParse("youngest heavyweight", []).maxAge, undefined);
  assert.equal(heuristicParse("the oldest boxers", []).minAge, undefined);
  assert.equal(heuristicParse("old boxers", []).minAge, 35);
  assert.equal(heuristicParse("the shortest reach", []).sort, undefined, "shortest reach is not shortest");
  assert.equal(heuristicParse("longest reach", []).sort, "reach");
});

test("counts: fighters, fights by how they ended, title fights and cards, in total and in a year", async () => {
  const fighters = w.boxers.filter((b) => b.bouts > 0);
  assert.match((await run("how many fighters are there")).answer, new RegExp(`^${fighters.length} fighters match\\.`));
  assert.match((await run("how many welterweights are there")).answer, new RegExp(`^${fighters.filter((b) => b.weightClass === "Welterweight").length} fighters match\\.`), "men and women");
  assert.match((await run("how many female boxers are there")).answer, new RegExp(`^${fighters.filter((b) => b.sex === "female").length} fighters match\\.`));
  assert.match((await run("how many southpaws are there")).answer, new RegExp(`^${fighters.filter((b) => b.stance === "Southpaw").length} fighters match\\.`));
  const { isDecision, isStoppage } = await import("../lib/methods");
  const done = w.bouts.filter((b) => !b.upcoming && b.status === "completed" && !!b.method);
  const n = (re: RegExp, q: string) => run(q).then((a) => { const m = a.answer.match(re); return m ? Number(m[1].replace(/,/g, "")) : NaN; });
  assert.equal(await n(/^([\d,]+) fights? match/, "how many fights have there been"), done.length);
  assert.equal(await n(/^([\d,]+) fights? match/, "how many knockouts were there in total"), done.filter((b) => isStoppage(b.method)).length);
  assert.equal(await n(/^([\d,]+) fights? match/, "how many decisions were there"), done.filter((b) => isDecision(b.method)).length);
  assert.equal(await n(/^([\d,]+) fights? match/, "how many title fights have there been"), done.filter((b) => !!b.title).length);
  const cards = w.events.filter((e) => !e.upcoming && e.status !== "cancelled");
  const year = cards[cards.length - 1].date.slice(0, 4);
  const inYear = cards.filter((e) => e.date.startsWith(year)).length;
  const y = await run(`how many events in ${year}`);
  assert.deepEqual(y.calls[0], { tool: "events", args: { year: +year } });
  assert.match(y.answer, new RegExp(`^There (was|were) ${inYear} completed cards? in ${year};`));
  assert.match((await run("how many events have there been")).answer, new RegExp(`^There have been ${cards.length} completed cards;`));
  const tb = await run("title bouts in 2024");
  assert.deepEqual(tb.calls[0], { tool: "bouts", args: { year: 2024, title: true } }, "bouts as well as fights");
  // a count of what a named fighter has is that fighter's, not the league's
  const star = rk.pound4pound(w, 1)[0];
  assert.equal((await run(`how many fights has ${star.name} had`)).calls[0].tool, "fighter");
});

test("the youngest and oldest champion are the champions in order of age, and no tool answers the average age or which gym has the most champions", async () => {
  const { belts } = await import("../lib/lineage");
  const champs = belts(w).filter((b) => b.sex === "male" && b.current && !b.stale).map((b) => w.byId.get(b.current!.boxerId)!).filter((c) => c.age !== null);
  const youngest = await run("who is the youngest champion"), oldest = await run("who is the oldest champion");
  assert.deepEqual([youngest.calls[0].tool, youngest.calls[0].args.by], ["champions", "youngest"]);
  const ageOf = (text: string) => Number(text.match(/, (\d+), who holds/)![1]);
  assert.equal(ageOf(youngest.answer), Math.min(...champs.map((c) => c.age!)));
  assert.equal(ageOf(oldest.answer), Math.max(...champs.map((c) => c.age!)));
  for (const q of ["what is the average age of a champion", "which gym has the most champions", "who trains the most champions", "which promoter has the most belts", "who is the tallest champion"]) assert.equal((await run(q)).understood, false, q);
});
