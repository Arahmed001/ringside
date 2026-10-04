import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { tempDb } from "./helpers";

const cleanup = tempDb("search-nl-ar");
after(cleanup);
let ai: typeof import("../lib/ai");
let rules: typeof import("../lib/ask/rules");
let w: Awaited<ReturnType<typeof import("../lib/world").getWorld>>;
let countries: string[];

before(async () => {
  ai = await import("../lib/ai");
  rules = await import("../lib/ask/rules");
  w = await (await import("../lib/world")).getWorld();
  countries = [...new Set(w.boxers.map((b) => b.country))];
});

// the sentence battery (groups D and E, in Arabic) runs with the English groups in tests/search-nl.test.ts

test("Arabic numbers are read as the measure they count, and the comparison word keeps its direction (round 52)", () => {
  const p = (q: string) => ai.heuristicParse(q, countries);
  assert.deepEqual(p("ملاكمون لديهم أكثر من 10 هزائم"), { minLosses: 11 });
  assert.deepEqual(p("ملاكمون لديهم أكثر من ١٠ هزائم"), { minLosses: 11 }, "Arabic-Indic digits");
  assert.deepEqual(p("ملاكمون لديهم أقل من 3 هزائم"), { maxLosses: 2 });
  assert.deepEqual(p("ملاكمون لديهم 3 هزائم على الأكثر"), { maxLosses: 3 }, "'at most' after the count");
  assert.deepEqual(p("ملاكمون لديهم 4 هزائم بالضبط"), { minLosses: 4, maxLosses: 4 });
  assert.deepEqual(p("ملاكمون لديهم 20 فوزا"), { minWins: 20 }, "a bare number is a minimum, as in English");
  assert.deepEqual(p("ملاكمون لديهم أكثر من 20 فوزا"), { minWins: 21 }, "more than 20 is 21 and up (it had been 20)");
  assert.deepEqual(p("ملاكمون لديهم 25 فوزا فأكثر"), { minWins: 25 });
  assert.deepEqual(p("ملاكمون لديهم 8 انتصارات فأقل"), { maxWins: 8 });
  assert.deepEqual(p("ملاكمون لديهم أكثر من عشرين فوزا"), { minWins: 21 }, "a number word before a count");
  assert.deepEqual(p("ملاكمون لديهم ثلاث هزائم على الأكثر"), { maxLosses: 3 });
  assert.deepEqual(p("ملاكمون لديهم بين 15 و25 فوزا"), { minWins: 15, maxWins: 25 });
  assert.deepEqual(p("ملاكمون لديهم من 20 إلى 30 فوزا"), { minWins: 20, maxWins: 30 });
  assert.deepEqual(p("ملاكمون لديهم 10 ضربات قاضية أو أكثر"), { minKOs: 10 });
  assert.deepEqual(p("ملاكمون لديهم أقل من 10 نزالات"), { maxBouts: 9 });
  assert.deepEqual(p("ملاكمون تحت 25 سنة"), { maxAge: 24 });
  assert.deepEqual(p("ملاكمون أعمارهم فوق 35"), { minAge: 36 });
  assert.deepEqual(p("ملاكمون لديهم فوز واحد"), { minWins: 1, maxWins: 1 }, "'one win' is exactly one");
  assert.deepEqual(p("ملاكمون 36 سنة أو أكثر"), { minAge: 36 }, "'or more' after an age");
  assert.deepEqual(p("ملاكمون 25 سنة أو أقل"), { maxAge: 25 }, "'or less' after an age");
  assert.deepEqual(p("ملاكمون لديهم 15 ضربة قاضية أو أقل"), { maxKOs: 15 });
  assert.deepEqual(p("ملاكمون لديهم أكثر من 15 ضربة قاضية"), { minKOs: 16 }, "the singular noun");
  assert.deepEqual(p("ملاكمون 30 عاما"), { minAge: 30, maxAge: 30 });
  assert.deepEqual(p("ملاكمون لديهم أكثر من ثلاثين فوزا"), { minWins: 31 }, "the tens as words");
  assert.equal(p("ملاكمون لديهم 2.5 فوزا").minWins, undefined, "a decimal is not read as its last digit");
  assert.deepEqual(p("ملاكمون لم يفوزوا بالضربة القاضية"), { maxKOs: 0 }, "'never won by knockout' is not 'never won'");
  assert.equal(p("ملاكمون فوق 70").minAge, undefined, "70 is not an age");
  assert.deepEqual(p("ملاكمون امتداد ذراعيهم بين 190 و180"), { minReach: 180, maxReach: 190 }, "a range said backwards");
  assert.deepEqual(p("ملاكمون بين 30 و25 سنة"), { minAge: 25, maxAge: 30 });
  assert.deepEqual(p("ملاكمون عمرهم 30 سنة"), { minAge: 30, maxAge: 30 }, "an age is exactly that age");
  assert.deepEqual(p("ملاكمون يزيد عمرهم عن 40 سنة"), { minAge: 41 }, "the comparison as a verb on the count");
  assert.deepEqual(p("ملاكمون لا يزيد عدد هزائمهم عن 5"), { maxLosses: 5 });
  assert.deepEqual(p("ملاكمون أطول من 185 سم"), { minHeight: 186 });
  assert.deepEqual(p("ملاكمون امتداد ذراعيهم 190 سم على الأقل"), { minReach: 190 });
  assert.deepEqual(p("ملاكمون امتداد ذراعيهم بين 180 و190"), { minReach: 180, maxReach: 190 });
  assert.deepEqual(p("ملاكمون بدون هزائم"), { maxLosses: 0, undefeated: true });
  assert.deepEqual(p("ملاكمون لم يفوزوا أبدا"), { maxWins: 0 });
  assert.deepEqual(p("ملاكمون بدون ضربات قاضية"), { maxKOs: 0 });
  assert.deepEqual(p("ملاكمون سجلهم خاسر"), { record: "losing" });
  assert.deepEqual(p("ملاكمون بسجل رابح"), { record: "winning" });
  assert.deepEqual(p("ملاكمون لديهم أكثر من 15 فوزا وأقل من 4 هزائم"), { minWins: 16, maxLosses: 3 });
});

test("a division said the way people say it is found, so it is not silently dropped", () => {
  const p = (q: string) => ai.heuristicParse(q, countries);
  for (const [q, d] of [["ثقيلو الوزن بسجل خاسر", "Heavyweight"], ["أكثر ملاكم فوزا بين ثقيلي الوزن", "Heavyweight"], ["ملاكمو الوزن المتوسط", "Middleweight"], ["متوسطي الوزن", "Middleweight"], ["ملاكمون من نصف الثقيل", "Light Heavyweight"], ["خفيفو الوزن", "Lightweight"], ["فوق المتوسط", "Super Middleweight"], ["وزن فوق الريشة", "Super Featherweight"]] as const) assert.equal(p(q).weightClass, d, q);
});

test("champions in Arabic: now, formerly or ever, and a qualifier is applied", () => {
  const p = (q: string) => ai.heuristicParse(q, countries);
  assert.equal(p("أبطال سابقون").champion, "former");
  assert.equal(p("بطل سابق").champion, "former");
  assert.equal(p("أبطال معتزلون").champion, "ever");
  assert.equal(p("أبطال معتزلون").active, false);
  assert.equal(p("ملاكمون سبق لهم حمل حزام").champion, "ever");
  assert.equal(p("من كان بطلا").champion, "ever");
  assert.equal(p("أبطال من المكسيك").champion, "current");
  assert.equal(p("ملاكمون عاديون").champion, undefined);
});

test("the planner keeps each Arabic qualifier on the way to the fighter search", () => {
  const first = (q: string) => rules.planByRules(q, w, {})[0];
  assert.deepEqual(first("ملاكمون لديهم أكثر من 20 فوزا"), { tool: "fighters", args: { minWins: 21 } }, "'more than 20 wins' is not the list of most wins");
  assert.deepEqual(first("من لديه أكثر فوزا"), { tool: "record_list", args: { list: "wins" } }, "and 'who has the most wins' still is");
  assert.deepEqual(first("أبطال سابقون"), { tool: "fighters", args: { champion: "former" } }, "former champions are not the live champions");
  assert.deepEqual(first("أبطال من المكسيك"), { tool: "fighters", args: { country: "Mexico", champion: "current" } });
  assert.deepEqual(first("من هو بطل الوزن الثقيل"), { tool: "champions", args: { division: "Heavyweight" } }, "plain champions are still the champions list");
  assert.deepEqual(first("أكثر ملاكم فوزا بين ثقيلي الوزن")?.args, { list: "wins", division: "Heavyweight" }, "the division is kept");
  assert.equal(first("أكثر دفاعا عن اللقب")?.tool, "record_list", "a list about champions is not 'among champions'");
  assert.deepEqual(first("أفضل ٥ ملاكمين"), { tool: "fighters", args: { sort: "rating", limit: 5 } }, "Arabic-Indic digits in the planner");
  assert.deepEqual(first("أفضل 5 ملاكمون ويلتر لديهم بين 10 و20 فوزا"), { tool: "fighters", args: { minWins: 10, maxWins: 20, weightClass: "Welterweight", sort: "rating", limit: 5 } }, "a ranking question with a cut is a search with the cut, not the ranking");
  assert.deepEqual(first("top 5 welterweights with more than 10 wins"), { tool: "fighters", args: { minWins: 11, weightClass: "Welterweight", sort: "rating", limit: 5 } }, "in English too");
  assert.deepEqual(first("top 5 welterweights"), { tool: "rankings", args: { division: "Welterweight", limit: 5 } }, "and with no cut it is still the ranking");
  assert.notEqual(first("who is ranked number two among welterweights over 30")?.tool, "rankings", "a place in a ranking with a cut the ranking lacks");
  assert.equal(first("the best welterweights over 30 right now")?.tool, "fighters", "'right now' does not make the ranking answer a cut");
  assert.equal(first("أفضل ثلاثة ملاكمين")?.args.limit, 3, "a number word that counts nothing is left alone");
  assert.deepEqual(first("كم عدد الملاكمين الذين لديهم أكثر من 10 هزائم"), { tool: "fighters", args: { minLosses: 11 } });
});
