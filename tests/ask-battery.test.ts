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

test("a year asked of an all-time list is refused with the reason, in the answer and in the API; other refusals say nothing special", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const { askData } = await import("../lib/ask");
  const { tEn } = await import("../lib/i18n/t");
  const ask = (q: string) => askData(q, { w, t: tEn, names: {} });
  for (const q of ["who has the most knockouts in 2024", "most wins this year", "longest win streak in 2023"]) {
    const a = await ask(q);
    assert.equal(a.understood, false, q);
    assert.equal(a.hint, "year", q);
  }
  for (const q of ["hello", "what is the meaning of life", "who has the most knockouts"]) {
    const a = await ask(q);
    assert.equal(a.hint, undefined, `${q}: no special reason`);
  }
  assert.equal((await ask("knockouts in 2024")).understood, true, "a year the bouts tool can answer is answered");
  // the API carries the same field
  const { GET } = await import("../app/api/ask/route");
  const res = await GET(new Request("http://localhost/api/ask?q=" + encodeURIComponent("most wins in 2024")));
  const body = await res.json();
  assert.equal(body.hint, "year");
  assert.equal(body.understood, false);
});

test("refusalReason: a year plus a list is the 'year' reason; either alone, or neither, is not", async () => {
  const { refusalReason } = await import("../lib/ask/rules");
  assert.equal(refusalReason("who has the most knockouts in 2024"), "year");
  assert.equal(refusalReason("longest reign this year"), "year");
  assert.equal(refusalReason("most wins last year?"), "year");
  assert.equal(refusalReason("who has the most knockouts"), null, "a list with no year");
  assert.equal(refusalReason("what happened in 2024"), null, "a year with no list");
  assert.equal(refusalReason("hello"), null);
});

test("a model that does answer a year question is not told it was refused: the hint is only for questions with no answer", async () => {
  const { askData } = await import("../lib/ask");
  const { tEn } = await import("../lib/i18n/t");
  const G = await import("../lib/ai-guard");
  const realFetch = globalThis.fetch;
  G.resetAiGuard();
  process.env.ANTHROPIC_API_KEY = "test-key";
  globalThis.fetch = (async (_u: unknown, init: { body: string }) => {
    const planning = JSON.parse(init.body).system.includes("choosing read-only tools");
    return new Response(JSON.stringify({ content: [{ type: "text", text: planning ? JSON.stringify({ calls: [{ tool: "record_list", args: { list: "kos" } }] }) : "The leader has the most knockouts." }] }), { status: 200 });
  }) as typeof fetch;
  try {
    const a = await askData("who has the most knockouts in 1999 and 2000", { w, t: tEn, names: {} });
    assert.equal(a.planner, "ai");
    assert.equal(a.understood, true);
    assert.equal(a.hint, undefined, "it was answered, so there is nothing to explain");
  } finally { globalThis.fetch = realFetch; delete process.env.ANTHROPIC_API_KEY; G.resetAiGuard(); }
});

test("the words fans use for a filter: 'or more', left handed, a nationality, a country the league has no one from, and the Arabic for 'never lost'", async () => {
  const { heuristicParse } = await import("../lib/ai");
  assert.equal(heuristicParse("welterweights with 25 or more wins", []).minWins, 25);
  assert.equal(heuristicParse("heavyweights with 20 plus knockouts", []).minKOs, 20);
  assert.equal(heuristicParse("left handed boxers", []).stance, "Southpaw");
  assert.equal(heuristicParse("lefties at lightweight", []).stance, "Southpaw");
  assert.equal(heuristicParse("boxers from Spain", ["Mexico"]).country, "Spain", "a country nobody in the data is from is still the country asked about, so the answer is 'no one' and not everyone");
  assert.equal(heuristicParse("Brazilian southpaws", []).country, "Brazil");
  assert.equal(heuristicParse("South African boxers", []).country, "South Africa");
  assert.equal(heuristicParse("Scottish boxers", []).country, "United Kingdom");
  assert.equal(heuristicParse("Mexican boxers", ["Mexico"]).country, "Mexico", "and the countries the league does have still work");
  assert.equal(heuristicParse("ملاكمون لم يخسروا", []).undefeated, true);
  assert.equal(heuristicParse("ملاكمون بيد يمنى", []).stance, "Orthodox", "Arabic words are read folded: a pattern with ى in it can never match");
  assert.equal(heuristicParse("ملاكمون يساريون", []).stance, "Southpaw");
  assert.equal(heuristicParse("الأقوى", []).sort, "rating");
  assert.equal(heuristicParse("ملاكمون مدى الذراع 190", []).minReach, 190, "مدى, folded");
  assert.equal(heuristicParse("welterweights with 25 wins", []).minWins, 25, "the plain form still works");
});

test("a country alone, or another sport, is not a boxing question; with a boxing word it is", () => {
  for (const q of ["how many people live in Mexico", "weather in Mexico City", "population of Japan", "who won the game last night", "who won the football match last night", "best tennis player of all time"]) assert.deepEqual(plan(q), [], q);
  assert.equal(plan("who won the fight last night")[0].tool, "events", "the same question about a fight is answered");
  assert.equal(plan("Mexican boxers")[0].tool, "fighters");
  assert.equal(plan("tell me about boxing in Saudi Arabia")[0].tool, "fighters");
  assert.equal(plan("fighters from Mexico")[0].tool, "fighters");
  assert.equal(plan("Mexican southpaws")[0].tool, "fighters", "a second filter makes a country a search");
});

test("'best three middleweights' in Arabic is the ranking, with the number and the division", () => {
  const three = plan("أفضل ثلاثة ملاكمين في الوزن المتوسط")[0];
  assert.equal(three.tool, "rankings");
  assert.equal(three.args.limit, 3);
  assert.equal(three.args.division, "Middleweight");
  assert.equal(plan("أفضل 5 ملاكمين في الوزن الخفيف")[0].args.limit, 5);
  assert.equal(plan("كم عدد الضربات القاضية في 2024")[0].args.method, "stoppage");
  assert.equal(plan("أكثر ضربات قاضية في 2024").length, 0, "a superlative with a year is still refused (the lists have no year)");
});

test("each way of saying it is its own rule: quality wins, upset-watch favourites, and the Arabic for the latest results", () => {
  for (const q of ["who has beaten the most good opponents", "who has beaten the most strong opponents".replace("strong", "top"), "wins over top-rated opposition", "who has beaten the highest rated fighters"]) {
    const c = plan(q)[0];
    assert.equal(`${c?.tool}:${c?.args.list}`, "record_list:quality-wins", q);
  }
  for (const q of ["which favourites are at risk", "any favourites looking wobbly", "which favourites look shaky", "which favourites are in danger", "which favourites are in trouble"]) assert.equal(plan(q)[0]?.tool, "upset_watch", q);
  for (const q of ["نتائج آخر فعالية", "نتائج الفعاليات", "آخر نتائج", "آخر فعاليات الملاكمة", "النتائج الأخيرة", "النزالات الأخيرة"]) { const c = plan(q)[0]; assert.equal(`${c?.tool}:${c?.args.when}`, "events:recent", q); }
});

test("a country nobody in the data is from is answered 'no fighters', in both languages, not by listing everyone", async () => {
  const fs = await import("node:fs");
  const { askData } = await import("../lib/ask");
  const { tEn, makeT } = await import("../lib/i18n/t");
  const arT = makeT("ar", JSON.parse(fs.readFileSync("i18n/ar.json", "utf8")));
  const en = await askData("Brazilian southpaws", { w, t: tEn, names: {} });
  assert.equal(en.calls[0].tool, "fighters");
  assert.equal(en.results[0].tables.length, 0, "no table of fighters");
  assert.match(en.answer, /No fighters in the data are from Brazil/);
  assert.match((await askData("boxers from Spain", { w, t: tEn, names: {} })).answer, /from Spain/);
  const ar = await askData("ملاكمون من البرازيل", { w, t: arT, names: {} });
  assert.equal(ar.results[0]?.tables.length, 0, "the Arabic question names Brazil too");
  assert.match(ar.answer, /لا يوجد في البيانات ملاكمون من/);
  // a country the league has still lists its fighters
  assert.ok((await askData("Mexican boxers", { w, t: tEn, names: {} })).results[0].tables.length > 0);
});

test("a list asked about a group it cannot be cut to is a fighter search that honours the group, or no answer: never the list for everybody", () => {
  const first = (q: string) => plan(q)[0];
  // the three lists a fighter search can stand in for: same sort, plus the group
  assert.deepEqual(first("most wins among Mexican fighters"), { tool: "fighters", args: { country: "Mexico", sort: "wins" } });
  assert.deepEqual(first("most knockouts among southpaws"), { tool: "fighters", args: { stance: "Southpaw", sort: "kos" } });
  assert.deepEqual(first("highest ko rate among active fighters"), { tool: "fighters", args: { active: true, sort: "koRate", minWins: 15 } }, "a knockout rate needs a record to rest on, as the list's own 15 wins");
  assert.equal(first("highest ko rate among Germans over 20 wins")?.args.minWins, 21, "and the reader's own minimum stands: over 20 is 21 and up (round 51)");
  // any other list: no answer
  for (const q of ["longest win streak among southpaws", "most title defenses among Mexican champions", "biggest upsets by southpaws", "most title wins among undefeated fighters"]) assert.deepEqual(plan(q), [], q);
  // what a list is scoped to is still a list
  assert.deepEqual(first("most knockouts among women"), { tool: "record_list", args: { list: "kos", sex: "female" } });
  assert.equal(first("longest unbeaten run among heavyweights")?.args.list, "win-streak", "'unbeaten' in a streak is the list, not a group of unbeaten fighters");
  // a group of fighters is not a ranking by division
  assert.deepEqual(first("top 5 southpaws"), { tool: "fighters", args: { stance: "Southpaw", sort: "rating", limit: 5 } });
});

test("a stretch of time, or a region, is no answer: 'since 2018' is not the year 2018, and 'Europe' is not a country", () => {
  for (const q of ["most knockouts in the 2010s", "greatest fighters of the 80s", "biggest upsets in the nineties", "longest win streak in the last five years", "most title defenses this decade", "fastest knockout before 2015", "most wins since 2020", "most knockouts after 2019", "knockouts since 2020", "most knockouts in recent years", "who has the most wins over the last decade"]) assert.deepEqual(plan(q), [], q);
  for (const q of ["who has the most knockouts in Europe", "best welterweight from South America", "most wins by an African fighter", "most title defenses in Asia"]) assert.deepEqual(plan(q), [], q);
  // one year is still one year, and a search that is about debuts keeps its year
  assert.equal(plan("knockouts in 2024")[0].tool, "bouts");
  assert.equal(plan("best fight of 2023")[0].tool, "fight_of_the_year");
  assert.equal(plan("fighters who debuted since 2020")[0].tool, "fighters");
});

test("the reason an unanswered question gets: a year, a stretch of years, or a group", async () => {
  const { refusalReason } = await import("../lib/ask/rules");
  assert.equal(refusalReason("who has the most knockouts in 2024"), "year");
  for (const q of ["most knockouts in the 2010s", "biggest upsets since 2018", "longest win streak in the last five years", "knockouts since 2020"]) assert.equal(refusalReason(q), "span", q);
  for (const q of ["longest win streak among southpaws", "most title defenses among Mexican champions", "who has the most knockouts in Europe", "biggest upsets by southpaws"]) assert.equal(refusalReason(q), "group", q);
  assert.equal(refusalReason("longest unbeaten run among heavyweights"), null, "that one has an answer");
  assert.equal(refusalReason("most knockouts among women"), null);
  assert.equal(refusalReason("hello"), null);
  const { askData } = await import("../lib/ask");
  const { tEn } = await import("../lib/i18n/t");
  assert.equal((await askData("most knockouts in the 2010s", { w, t: tEn, names: {} })).hint, "span");
  assert.equal((await askData("longest win streak among southpaws", { w, t: tEn, names: {} })).hint, "group");
  const ok = await askData("most knockouts among southpaws", { w, t: tEn, names: {} });
  assert.equal(ok.understood, true);
  assert.equal(ok.hint, undefined);
});

test("words that only contain a filter word do not set the filter: 'holds' and 'gold' are not an age, 'technical knockouts' are not a style, 'Mexicans' are Mexican", async () => {
  const { heuristicParse } = await import("../lib/ai");
  assert.equal(heuristicParse("who holds the heavyweight belt", []).minAge, undefined);
  assert.equal(heuristicParse("gold medallists", []).minAge, undefined);
  assert.equal(heuristicParse("the oldest boxers", []).minAge, undefined, "oldest is the order to sort in (round 50), not a minimum age");
  assert.equal(heuristicParse("the oldest boxers", []).sort, "age");
  assert.equal(heuristicParse("old boxers", []).minAge, 35);
  assert.equal(heuristicParse("veterans with 30 wins", []).minAge, 35);
  assert.equal(heuristicParse("most technical knockouts", []).archetype, undefined);
  assert.equal(heuristicParse("technical boxers", []).archetype, "Technician");
  assert.equal(heuristicParse("Mexicans with 10 knockouts", []).country, "Mexico");
  assert.equal(heuristicParse("Germans", []).country, "Germany");
});
