import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeBoxer, miniFeed, tempDb } from "./helpers";

/**
 * The rule-based Ask planner reads a name with a slip or two ("tell me about Tomás Vilalba"). A league worked out by hand, with look-alike names on purpose, to
 * check what it must and must not forgive (tests/ask-names-battery.test.ts runs the generated battery over a whole league).
 */
const cleanup = tempDb("ask-names");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ringside-an-"));
after(() => { cleanup(); fs.rmSync(dir, { recursive: true, force: true }); });

type World = Awaited<ReturnType<typeof import("../lib/world").getWorld>>;
let w: World;
let plan: (q: string, names?: Record<string, string>) => { tool: string; args: Record<string, unknown> }[];
const NO_NAMES = {};
const AR: Record<string, string> = { "Tomás Villalba": "توماس فيلالبا", "Rakan Al-Qahtani": "راكان القحطاني", "Zhang Wei": "تشانغ وي" };

before(async () => {
  const feed = miniFeed();
  feed.boxers = [
    makeBoxer("x1", "Lightweight", { name: "Tomás Villalba" }), makeBoxer("x2", "Lightweight", { name: "Tomás Villalta" }), makeBoxer("x3", "Lightweight", { name: "Rakan Al-Qahtani" }),
    makeBoxer("x4", "Lightweight", { name: "Zhang Wei" }), makeBoxer("x5", "Lightweight", { name: "Wei Zhang" }), makeBoxer("x6", "Lightweight", { name: "Yazan H. Al-Ghamdi" }),
    makeBoxer("x7", "Lightweight", { name: "Bartholomew Featherstonehaugh" }), makeBoxer("x8", "Lightweight", { name: "José Mora" }),
    makeBoxer("x9", "Lightweight", { name: "Marcos Quintero" }), makeBoxer("x10", "Lightweight", { name: "Marcus Quintero" }), makeBoxer("x11", "Lightweight", { name: "Niklas Kessler" }),
    makeBoxer("x12", "Lightweight", { name: "Wyatt G. Stroud" }),
  ];
  feed.people = [...feed.people, { externalId: "T9", name: "Niklas G. Kessler" }, { externalId: "T8", name: "Wyatt Stroud" }, { externalId: "T7", name: "Ignacio Ferrandez" }];
  feed.bouts = []; feed.weighIns = []; feed.scorecards = []; feed.officials = []; feed.corners = []; feed.punches = [];
  feed.stints = [
    ...["T9", "T8", "T7"].map((p, i) => ({ boxerExternalId: ["x11", "x12", "x4"][i], role: "head_trainer" as const, personExternalId: p, start: "2020-01-01", end: null, source: "test" })),
  ];
  const file = path.join(dir, "feed.json");
  fs.writeFileSync(file, JSON.stringify(feed));
  process.env.BOXING_PROVIDER = "file"; process.env.BOXING_FILE = file;
  w = await (await import("../lib/world")).getWorld();
  const { planByRules } = await import("../lib/ask/rules");
  plan = (q, names = NO_NAMES) => planByRules(q, w, names) as never;
});

const one = (q: string, names?: Record<string, string>) => { const c = plan(q, names)[0]; return c ? `${c.tool}:${c.args.name ?? [c.args.a, c.args.b].join("|")}` : "none"; };

test("a fighter named with a letter missing, added, wrong or swapped is found, and the question is read as about him", () => {
  for (const q of ["tell me about Tomás Vilalba", "who is Tomas Villalbaa", "what is Tomás Vilalba's record", "Tomas Villaba stats", "is Tomás Villlba a southpaw", "who is Tmoás Villalba"]) assert.equal(one(q), "fighter:Tomás Villalba", q);
  assert.equal(one("how old is Bartholomew Featherstonehaugh"), "fighter:Bartholomew Featherstonehaugh");
  assert.equal(one("who is Bartholomew Featherstonhaug"), "fighter:Bartholomew Featherstonehaugh", "two slips in a long surname are forgiven");
  assert.equal(one("tell me about jose mroa"), "fighter:José Mora", "accents and capitals do not matter, and a swap is one slip");
});

test("two fighters, one or both with a slip, are a head to head", () => {
  assert.equal(one("Tomás Vilalba vs Rakan Al-Qahtani"), "head_to_head:Tomás Villalba|Rakan Al-Qahtani");
  assert.equal(one("compare Tomás Vilalba and Rakna Al-Qahtani"), "head_to_head:Tomás Villalba|Rakan Al-Qahtani");
  assert.equal(one("who would win between Rakan Al-Qahtani and Tomás Villalba"), "head_to_head:Rakan Al-Qahtani|Tomás Villalba", "the order of the question is the order of the call");
  assert.equal(one("Tomás Villalba vs Rakan Alqahtni"), "head_to_head:Tomás Villalba|Rakan Al-Qahtani", "one exact, one with a slip: the exact one does not hide the other");
});

test("a hyphen can be typed as a space, left out, or have the slip beside it", () => {
  for (const q of ["who is Rakan Al Qahtani", "who is Rakan Alqahtani", "who is Rakan Al-Qahtni", "who is Rakan A-lQahtani", "who is Rakan Alqahtni"]) assert.equal(one(q), "fighter:Rakan Al-Qahtani", q);
  assert.equal(one("who is Yazan Al-Ghamdi"), "none", "a middle initial left out is a different name, and the planner does not guess at it");
});

test("a space typed inside a name is read as one word", () => {
  assert.equal(one("tell me about Tomás Vil lalba"), "fighter:Tomás Villalba");
  assert.equal(one("tell me about Bartholomew Feather stonehaugh"), "fighter:Bartholomew Featherstonehaugh");
});

test("the nearest spelling wins; when two people are equally near neither is named, because the question might be about either", () => {
  assert.equal(one("tell me about Tomás Villaba"), "fighter:Tomás Villalba", "Villalba is one slip away and Villalta two");
  assert.equal(one("tell me about Tomás Villata"), "fighter:Tomás Villalta");
  assert.equal(one("tell me about Marcas Quintero"), "none", "Marcos and Marcus are each one slip away");
  assert.equal(one("tell me about Marcus Quintero"), "fighter:Marcus Quintero", "written in full, it is exact");
  assert.equal(one("Marcos Quintero vs Marcus Quintero"), "head_to_head:Marcos Quintero|Marcus Quintero", "and both written in full are both found");
});

test("three slips are too many, and a word of three letters or fewer must be exact", () => {
  assert.equal(one("tell me about Rkaan Al-Qahtn"), "none");
  assert.equal(one("tell me about Tmoás Villalbaa"), "fighter:Tomás Villalba", "but two are not");
  assert.equal(one("tell me about Tmoás Vilaa"), "none", "three are not");
  assert.equal(one("tell me about Zhang Wie"), "none", "Wei is three letters: one slip in it could be anybody's");
  assert.equal(one("tell me about Zhang Weii"), "none", "nor may a word of three letters be a slip from a name's three-letter word");
  assert.equal(one("tell me about Jos Mora"), "none", "or be a slip from the start of a longer one (Jos is not José)");
  assert.equal(one("tell me about Zhang Wei"), "fighter:Zhang Wei");
  assert.equal(one("tell me about Wei Zhang"), "fighter:Wei Zhang", "and the same two words the other way round are another fighter");
});

test("a fighter's full name or a trainer's full name is never taken for the other by a slip", () => {
  assert.equal(one("Wyatt G. Stroud trainer"), "fighter:Wyatt G. Stroud", "the fighter written in full, beside a trainer a middle initial away");
  assert.equal(one("What difference does Niklas G. Kessler make to a boxer's results?"), "trainers:Niklas G. Kessler", "the trainer written in full, beside a fighter a middle initial away");
  assert.equal(one("how good is Wyatt Stroud as a trainer"), "trainers:Wyatt Stroud");
});

test("a trainer named with a slip is found", () => {
  for (const q of ["how good is Ignacio Ferandez as a trainer", "trainer Ignacio Ferrandes", "what is Ignacio Ferrandz's impact as a coach", "ignacio ferandez"]) assert.equal(one(q), "trainers:Ignacio Ferrandez", q);
});

test("words that are only like names do not name anyone: a first name and an ordinary word, or a name nobody has", () => {
  for (const q of ["tell me about Tomás record", "Rakan fights", "what are the Marcus rankings", "who is Zebulon Quackenbush", "tell me about Ignatius Fothergill", "who is Tomás", "most knockouts", "who has the best record", "Tomás Villalba Rakan"]) {
    const c = plan(q)[0];
    if (q === "Tomás Villalba Rakan") assert.equal(c.tool, "fighter", q); // a name in full, and a stray word after it
    else assert.ok(!c || !["fighter", "head_to_head"].includes(c.tool), `${q} -> ${JSON.stringify(c)}`);
  }
});

test("Arabic names are forgiven too, including with the attached 'and' of a pair", () => {
  assert.equal(one("من هو توماس فيلالبا", AR), "fighter:Tomás Villalba");
  assert.equal(one("من هو توماس فيلاليا", AR), "fighter:Tomás Villalba", "a look-alike letter");
  assert.equal(one("من هو توماس فيلالب", AR), "fighter:Tomás Villalba", "a letter missing");
  assert.equal(one("من هو راكان القحطاني", AR), "fighter:Rakan Al-Qahtani");
  assert.equal(one("قارن بين توماس فيلالب وراكان القحطني", AR), "head_to_head:Tomás Villalba|Rakan Al-Qahtani");
  assert.equal(one("قارن بين توماس فيلالبا وراكان القحطني", AR), "head_to_head:Tomás Villalba|Rakan Al-Qahtani", "the 'and' stuck to the second name");
});

test("asked end to end, a name with a slip gets an answer about that fighter, from the rules, with no key", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const { askData } = await import("../lib/ask");
  const { tEn } = await import("../lib/i18n/t");
  const a = await askData("what is Tomás Vilalba's record", { w, t: tEn, names: NO_NAMES });
  assert.equal(a.understood, true);
  assert.equal(a.planner, "rules");
  assert.ok(a.results[0].lines.join(" ").includes("Tomás Villalba"));
  const h = await askData("Tomás Vilalba vs Rakan Al-Qahtni", { w, t: tEn, names: NO_NAMES });
  assert.equal(h.calls[0].tool, "head_to_head");
  assert.ok(h.results[0].lines.join(" ").includes("Rakan Al-Qahtani"));
});
