import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { tempDb } from "./helpers";

const cleanup = tempDb("search-record-ar");
after(cleanup);
let ai: typeof import("../lib/ai");
let rules: typeof import("../lib/ask/rules");
let w: Awaited<ReturnType<typeof import("../lib/world").getWorld>>;
let countries: string[];
const T = "2026-10-03";

before(async () => {
  ai = await import("../lib/ai");
  rules = await import("../lib/ask/rules");
  w = await (await import("../lib/world")).getWorld();
  countries = [...new Set(w.boxers.map((b) => b.country))];
});

// the sentence battery (groups H and I, in Arabic) runs with the other groups in tests/search-nl.test.ts

test("a fighter's record and form in Arabic are read as the fact they name (round 54)", () => {
  const p = (q: string) => ai.heuristicParse(q, countries, T);
  assert.deepEqual(p("ملاكمون لم يتعرضوا للضربة القاضية أبدا"), { maxStopped: 0 });
  assert.deepEqual(p("ملاكمون لم يخسروا بالضربة القاضية أبدا"), { maxStopped: 0 }, "it had been 'undefeated' for 'لم يخسروا'");
  assert.deepEqual(p("ملاكمون لم يخسر أي منهم بالضربة القاضية"), { maxStopped: 0 });
  assert.deepEqual(p("ملاكمون بدون هزائم بالضربة القاضية"), { maxStopped: 0 }, "and 'no losses by knockout' is not 'no losses'");
  assert.deepEqual(p("ملاكمون بدون هزائم"), { maxLosses: 0, undefeated: true }, "plain 'no losses' is still that");
  assert.deepEqual(p("ملاكمون خسروا بالضربة القاضية 3 مرات على الأقل"), { minStopped: 3 });
  assert.deepEqual(p("ملاكمون تعرضوا للضربة القاضية أكثر من مرتين"), { minStopped: 3 });
  assert.deepEqual(p("ملاكمون تعرضوا للضربة القاضية مرتين على الأقل"), { minStopped: 2 });
  assert.deepEqual(p("ملاكمون لديهم ثلاث هزائم بالضربة القاضية"), { minStopped: 3 });
  assert.deepEqual(p("ملاكمون لم يتعرضوا للايقاف أبدا"), { maxStopped: 0 }, "'للايقاف' (being stopped) is a way to say it");
  assert.deepEqual(p("ملاكمات لم يتعرضن للضربة القاضية أبدا"), { sex: "female", maxStopped: 0 }, "the feminine plural");
  assert.deepEqual(p("ملاكمون خاضوا كل نزالاتهم حتى النهاية"), { maxStopped: 0, maxKOs: 0 }, "went the distance every time");
  assert.deepEqual(p("ملاكمون لديهم 4 خسائر بالضربة القاضية"), { minStopped: 4 }, "'خسائر' and 'خسارة' too");
  assert.deepEqual(p("ملاكمون لديهم خسارة واحدة بالضربة القاضية").minStopped, undefined, "a number word the parser does not know is left alone");
  assert.deepEqual(p("ملاكمون دون تعادلات"), { maxDraws: 0 });
  assert.deepEqual(p("ملاكمون لديهم تعادل واحد"), { minDraws: 1, maxDraws: 1 }, "one draw is exactly one");
  assert.deepEqual(p("ملاكمون لم يخسروا في آخر نزالين"), { unbeatenIn: 2 }, "the dual");
  assert.equal(p("ملاكمون خسروا في آخر 3 نزالات بالضربة القاضية").minLossStreak, undefined, "how they ended is not a filter, here either");
  assert.deepEqual(p("ملاكمون خاضوا نزالا في آخر أسبوعين"), { lastFightAfter: "2026-09-19" }, "weeks are seven days");
  assert.deepEqual(p("ملاكمون لديهم تعادل"), { minDraws: 1 });
  assert.deepEqual(p("ملاكمون بدون تعادلات"), { maxDraws: 0 });
  assert.deepEqual(p("ملاكمون لم يتعادلوا أبدا"), { maxDraws: 0 });
  assert.deepEqual(p("ملاكمون لديهم أكثر من تعادلين"), { minDraws: 3 });
  assert.deepEqual(p("ملاكمون لديهم تعادلين على الأقل"), { minDraws: 2 });
  assert.deepEqual(p("ملاكمون في سلسلة انتصارات من 5 نزالات"), { minWinStreak: 5 }, "it had been '5 or more fights'");
  assert.deepEqual(p("ملاكمون في سلسلة انتصارات"), { minWinStreak: 2 }, "a streak is two or more");
  assert.deepEqual(p("ملاكمون في سلسلة هزائم من 3 نزالات"), { minLossStreak: 3 });
  assert.deepEqual(p("ملاكمون فازوا في آخر 3 نزالات"), { minWinStreak: 3 });
  assert.deepEqual(p("ملاكمون فازوا في آخر ثلاثة نزالات"), { minWinStreak: 3 }, "a number word");
  assert.deepEqual(p("ملاكمون خسروا آخر نزالين"), { minLossStreak: 2 }, "the dual");
  assert.deepEqual(p("ملاكمون خسروا نزالهم الأخير"), { minLossStreak: 1 });
  assert.deepEqual(p("ملاكمات خسرن نزالهن الأخير"), { sex: "female", minLossStreak: 1 });
  assert.deepEqual(p("ملاكمون لم يخسروا في آخر 5 نزالات"), { unbeatenIn: 5 }, "it had been 'undefeated, 5 or more fights'");
  assert.deepEqual(p("ملاكمون غير مهزومين في آخر 3 نزالات"), { unbeatenIn: 3 });
  assert.deepEqual(p("ملاكمون خاضوا نزالا في آخر 6 أشهر"), { lastFightAfter: "2026-04-03" });
  assert.deepEqual(p("ملاكمون خاضوا نزالا في آخر سنتين"), { lastFightAfter: "2024-10-03" });
  assert.deepEqual(p("ملاكمون خاضوا نزالا في آخر ثلاثة أشهر"), { lastFightAfter: "2026-07-03" });
  assert.deepEqual(p("ملاكمون خاضوا نزالا هذا العام"), { lastFightAfter: "2026-01-01" });
  assert.deepEqual(p("ملاكمون خاضوا نزالا العام الماضي"), { lastFightAfter: "2025-01-01", lastFightBefore: "2025-12-31" });
  assert.deepEqual(p("ملاكمون لم يخوضوا نزالا منذ أكثر من سنة"), { lastFightBefore: "2025-10-02" });
  assert.deepEqual(p("ملاكمون لم يخوضوا نزالا منذ 18 شهرا على الأقل"), { lastFightBefore: "2025-04-03" });
  assert.deepEqual(p("ملاكمون لا نشاط لهم منذ سنتين"), { lastFightBefore: "2024-10-03" });
  assert.deepEqual(p("ملاكمون لم يخوضوا نزالا منذ 2023"), { lastFightBefore: "2023-12-31" });
  assert.deepEqual(p("ملاكمون خاضوا آخر نزال لهم في 2024"), { lastFightAfter: "2024-01-01", lastFightBefore: "2024-12-31" });
  assert.deepEqual(p("ملاكمون آخر نزال لهم قبل 2023"), { lastFightBefore: "2022-12-31" });
  assert.deepEqual(p("ملاكمون آخر نزال لهم منذ 2025"), { lastFightAfter: "2025-01-01" });
  assert.deepEqual(p("ملاكمون احترفوا في 2015"), { debutAfter: 2015, debutBefore: 2015 });
  assert.deepEqual(p("ملاكمون بدأوا الاحتراف بعد 2018"), { debutAfter: 2019 });
  assert.deepEqual(p("ملاكمون احترفوا قبل 2013"), { debutBefore: 2012 });
  assert.deepEqual(p("ملاكمون احترفوا منذ 2020"), { debutAfter: 2020 });
  assert.deepEqual(p("ملاكمون بدأوا مسيرتهم الاحترافية في 2018"), { debutAfter: 2018, debutBefore: 2018 });
  assert.deepEqual(p("ملاكمون نسبة ضرباتهم القاضية أقل من 30%"), { maxKoRate: 0.3 });
  assert.deepEqual(p("ملاكمون نسبة ضرباتهم القاضية أكثر من 70%"), { minKoRate: 0.7 });
  assert.deepEqual(p("ملاكمون نسبة الضربات القاضية لديهم على الأقل 60%"), { minKoRate: 0.6 });
  assert.equal(ai.heuristicParse("ملاكمون خاضوا نزالا في آخر 6 أشهر", countries).lastFightAfter, undefined, "no date to count back from, no filter invented");
});

test("'stopped' with no vowel marks is not guessed, and how the last fight ended is not a cut", () => {
  const p = (q: string) => ai.heuristicParse(q, countries, T);
  assert.equal(p("ملاكمون أوقفوا أكثر من مرتين").minStopped, undefined, "'أوقفوا' is both 'stopped' and 'were stopped' once the vowel marks are gone");
  assert.equal(p("ملاكمون لم يوقفوا أبدا").maxStopped, undefined);
  assert.equal(p("ملاكمون خسروا نزالهم الأخير بالضربة القاضية").minLossStreak, undefined, "how it ended is not a filter: not everyone who lost");
  assert.deepEqual(rules.planByRules("ملاكمون خسروا نزالهم الأخير بالضربة القاضية", w, {}), [], "no answer rather than everyone who lost");
  assert.equal(p("ملاكمات خسرن نزالهن الأخير بالضربة القاضية").minLossStreak, undefined, "the feminine form too");
  assert.deepEqual(rules.planByRules("ملاكمون خسروا نزالهم الأخير امام بطل", w, {}), []);
  assert.deepEqual(rules.planByRules("ملاكمات خسرن نزالهن الأخير بالضربة القاضية", w, {}), [], "the feminine form too");
});

test("the planner sends an Arabic record question to the fighter search and keeps the lists", () => {
  const first = (q: string) => rules.planByRules(q, w, {})[0];
  assert.deepEqual(first("ملاكمون لم يتعرضوا للضربة القاضية أبدا"), { tool: "fighters", args: { maxStopped: 0 } });
  assert.deepEqual(first("ملاكمون خسروا نزالهم الأخير"), { tool: "fighters", args: { minLossStreak: 1 } });
  assert.deepEqual(first("ملاكمون خاضوا نزالا في آخر 6 أشهر"), { tool: "fighters", args: { lastFightAfter: "2026-04-03" } });
  assert.deepEqual(first("ملاكمون احترفوا في 2015"), { tool: "fighters", args: { debutAfter: 2015, debutBefore: 2015 } });
  assert.deepEqual(rules.planByRules("النزالات القادمة للملاكمين في سلسلة انتصارات", w, {}), [], "an events word and a cut: no tool has both");
  assert.equal(first("من هو بطل الوزن الثقيل")?.tool, "champions", "plain champions are still the champions list");
  assert.equal(first("أطول سلسلة انتصارات")?.tool, "record_list", "and the longest streak is still the list");
});
