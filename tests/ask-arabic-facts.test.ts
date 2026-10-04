import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { tempDb } from "./helpers";

const cleanup = tempDb("ask-arabic-facts");
after(cleanup);
let rules: typeof import("../lib/ask/rules");
let ai: typeof import("../lib/ai");
let w: Awaited<ReturnType<typeof import("../lib/world").getWorld>>;
const N = { "Marcus Larkin": "ماركوس لاركن", "Ryota Morishita": "ريوتا موريشيتا", "Lukas Hartmann": "لوكاس هارتمان" };
before(async () => { rules = await import("../lib/ask/rules"); ai = await import("../lib/ai"); w = await (await import("../lib/world")).getWorld(); });
const plan = (q: string) => rules.planByRules(q, w, N);

test("an Arabic question about one fighter asks for the fact it names (round 63)", () => {
  for (const [q, fact] of [["متى احترف ماركوس لاركن", "debut"], ["ما لقب ماركوس لاركن", "nickname"], ["ما أسلوب ماركوس لاركن", "style"], ["من مروج ماركوس لاركن", "promoter"],
    ["ما أطول سلسلة انتصارات لماركوس لاركن", "streak"], ["كم نزالا فاز بالنقاط ماركوس لاركن", "decisions"], ["هل ماركوس لاركن معتزل", "status"], ["من يدرب ماركوس لاركن", "trainer"],
    ["كم طول ماركوس لاركن", "height"], ["هل لدى ماركوس لاركن حزام", "belts"]] as const) assert.deepEqual(plan(q), [{ tool: "fighter", args: { name: "Marcus Larkin", about: fact } }], q);
});

test("'أطول' (the longest, the taller) is not a height when it is a streak, and still is one between two fighters", () => {
  assert.equal(plan("ما أطول سلسلة انتصارات لماركوس لاركن")[0].args.about, "streak");
  assert.deepEqual(plan("أطول سلسلة انتصارات"), [{ tool: "record_list", args: { list: "win-streak" } }], "with no name it is the list");
  assert.deepEqual(plan("من الأطول ريوتا موريشيتا أم لوكاس هارتمان").map((c) => c.args.about), ["height", "height"]);
  assert.deepEqual(plan("من الأكبر سنا ريوتا موريشيتا أم لوكاس هارتمان").map((c) => c.args.about), ["age", "age"], "it had been a prediction of who would win");
});

test("the interim belt is no answer, the best woman is a woman, 'وزن الوسط' is the middleweights, the most fights is a sort", () => {
  assert.deepEqual(plan("من هو البطل المؤقت"), []);
  assert.deepEqual(plan("من هو أفضل ملاكمة"), [{ tool: "fighters", args: { sex: "female", sort: "rating" } }]);
  assert.deepEqual(plan("أفضل ملاكمين في وزن الوسط"), [{ tool: "rankings", args: { division: "Middleweight" } }]);
  assert.deepEqual(plan("من هو أكثر ملاكم نزالا"), [{ tool: "fighters", args: { sort: "bouts" } }]);
  assert.equal(ai.heuristicParse("ملاكمون وزن الوسط", []).weightClass, "Middleweight");
});
