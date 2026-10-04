import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { tempDb } from "./helpers";

const cleanup = tempDb("ask-arabic-questions");
after(cleanup);
let ai: typeof import("../lib/ai");
let rules: typeof import("../lib/ask/rules");
let w: Awaited<ReturnType<typeof import("../lib/world").getWorld>>;
let countries: string[];
const NAMES = { "Marcus Larkin": "ماركوس لاركن" };
before(async () => { ai = await import("../lib/ai"); rules = await import("../lib/ask/rules"); w = await (await import("../lib/world")).getWorld(); countries = [...new Set(w.boxers.map((b) => b.country))]; });
const p = (q: string) => ai.heuristicParse(q, countries, w.today);
const plan = (q: string) => rules.planByRules(q, w, NAMES);

test("a nationality in Arabic is a country, never dropped (round 59)", () => {
  for (const [q, c] of [["أفضل 5 ملاكمين سعوديين", "Saudi Arabia"], ["ملاكمون مكسيكيون", "Mexico"], ["ملاكمات يابانيات", "Japan"], ["ملاكمون أرجنتينيون", "Argentina"], ["ملاكمون أوكرانيون", "Ukraine"], ["ملاكمون نيجيريون", "Nigeria"], ["ملاكمون فلبينيون", "Philippines"], ["ملاكمون ألمان", "Germany"], ["ملاكمون ألمانيون", "Germany"], ["ملاكمون أمريكيون", "United States"], ["ملاكمون بريطانيون", "United Kingdom"]] as const) assert.equal(p(q).country, c, q);
  assert.equal(p("ملاكمون").country, undefined);
});

test("right-handed in the plural, and the youngest and the oldest as an order to sort in", () => {
  assert.equal(p("ملاكمون يمينيون في وزن الريشة").stance, "Orthodox");
  assert.equal(p("ملاكمون يساريون").stance, "Southpaw");
  assert.equal(p("من هو أصغر ملاكم لم يهزم").sort, "youngest", "it had been the best-rated of the unbeaten");
  assert.equal(p("من هو أكبر ملاكم سنا").sort, "age");
  assert.equal(p("الأكبر سنا بين الملاكمين").sort, "age");
  assert.equal(p("ملاكمون أكبر من 35 سنة").sort, undefined, "'older than 35' is a limit, not an order");
  assert.equal(p("متى قاتل ماركوس لاركن آخر مرة").archetype, undefined, "'قاتل' is 'fought' here, not 'a killer'");
});

test("the planner answers or refuses each Arabic question as its English twin", () => {
  assert.deepEqual(plan("متى نزال ماركوس لاركن القادم"), [{ tool: "fighter", args: { name: "Marcus Larkin", about: "next_fight" } }]);
  assert.deepEqual(plan("متى قاتل ماركوس لاركن آخر مرة"), [{ tool: "fighter", args: { name: "Marcus Larkin", about: "last_fight" } }]);
  assert.deepEqual(plan("من هزم ماركوس لاركن"), [], "who beat him is no answer, not his profile");
  assert.deepEqual(plan("من يدرب أكثر الأبطال"), [], "and who trains the most champions, not the champions");
  assert.deepEqual(plan("من فاز بآخر نزال رئيسي"), [], "who won the last main event is not 'a winning streak of one'");
  assert.deepEqual(plan("ملاكمون فازوا في آخر 3 نزالات"), [{ tool: "fighters", args: { minWinStreak: 3 } }], "but the plural is a search");
  assert.deepEqual(plan("النزالات القادمة"), [{ tool: "events", args: { when: "upcoming" } }], "and the upcoming cards are still the cards");
  assert.deepEqual(plan("أفضل 5 ملاكمين سعوديين"), [{ tool: "fighters", args: { country: "Saudi Arabia", sort: "rating", limit: 5 } }]);
});
