import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tempDb } from "./helpers";
import { makeT, tEn } from "../lib/i18n/t";

/**
 * A question about one fighter asks for one fact ("how tall is X", "who trains X", "when does X fight next"), and the answer is that fact: it used to be the same
 * one-line profile for every one of them, and "what is X's knockout rate" was answered with the knockout-rate list for everybody. Where the data does not give
 * the fact the answer says so, and never fills it in.
 */
const cleanup = tempDb("ask-facts");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ringside-af-"));
after(() => { cleanup(); fs.rmSync(dir, { recursive: true, force: true }); });

type World = Awaited<ReturnType<typeof import("../lib/world").getWorld>>;
type Boxer = World["boxers"][number];
let w: World;
let ask: typeof import("../lib/ask").askData;
let T: typeof import("../lib/ask/tools");
const AR = JSON.parse(fs.readFileSync(path.join(process.cwd(), "i18n", "ar.json"), "utf8"));

before(async () => {
  w = await (await import("../lib/world")).getWorld();
  ask = (await import("../lib/ask")).askData;
  T = await import("../lib/ask/tools");
});

const answer = async (q: string, locale: "en" | "ar" = "en", table: Record<string, string> = {}) => ask(q, { w, t: locale === "en" ? tEn : makeT("ar", AR), names: table });
const asked = async (q: string) => { const a = await answer(q); return { a, call: a.calls[0], text: a.answer }; };

/** a fighter who has what a fact needs, found in the demo league */
const pick = (test: (b: Boxer) => boolean) => [...w.boxers].sort((x, y) => y.bouts - x.bouts || x.id - y.id).find(test)!;
const headTrainer = (b: Boxer) => (w.stintsByBoxer.get(b.id) ?? []).some((s) => s.role === "head_trainer" && s.end === null && s.personId);
const gym = (b: Boxer) => (w.stintsByBoxer.get(b.id) ?? []).some((s) => s.role === "gym" && s.end === null && s.orgId);
const upcoming = (b: Boxer) => (w.boutsByBoxer.get(b.id) ?? []).some((x) => x.upcoming && x.status !== "cancelled");
// the names must be unique in the league (a fighter also named like a trainer is another test's)
const unique = (b: Boxer) => w.boxers.filter((x) => x.name === b.name).length === 1 && ![...w.people.values()].some((p) => p.name === b.name);

test("each fact asked is the fact answered, with the tool and the fact named in the call", async () => {
  const star = pick((b) => unique(b) && b.heightCm !== null && b.reachCm !== null && b.age !== null && b.stance !== null && b.bouts > 8);
  const trained = pick((b) => unique(b) && headTrainer(b)), gymmed = pick((b) => unique(b) && gym(b)), booked = pick((b) => unique(b) && upcoming(b));
  const trainer = w.people.get((w.stintsByBoxer.get(trained.id) ?? []).find((s) => s.role === "head_trainer" && s.end === null)!.personId!)!;
  const gymName = w.orgs.get((w.stintsByBoxer.get(gymmed.id) ?? []).find((s) => s.role === "gym" && s.end === null)!.orgId!)!.name;
  const next = (w.boutsByBoxer.get(booked.id) ?? []).filter((x) => x.upcoming && x.status !== "cancelled").sort((p, q) => p.date.localeCompare(q.date))[0];
  const lastBout = (w.boutsByBoxer.get(star.id) ?? []).filter((x) => !x.upcoming && x.method).slice(-1)[0];
  const lastOpp = lastBout.redId === star.id ? lastBout.blueName : lastBout.redName;
  const { recordStr } = await import("../lib/world");
  const cases: { qs: string[]; who: Boxer; fact: string; has: string[] }[] = [
    { qs: ["how tall is NAME", "NAME's height", "what is the height of NAME"], who: star, fact: "height", has: [`${star.heightCm} cm tall`] },
    { qs: ["what is NAME's reach", "NAME reach"], who: star, fact: "reach", has: [`reach is ${star.reachCm} cm`] },
    { qs: ["how old is NAME", "what is NAME's age"], who: star, fact: "age", has: [`${star.age} years old`] },
    { qs: ["is NAME a southpaw", "what stance does NAME fight from"], who: star, fact: "stance", has: [`${star.stance} stance`] },
    { qs: ["where is NAME from", "what is NAME's nationality"], who: star, fact: "country", has: ["is from"] },
    { qs: ["what weight class is NAME", "which division does NAME fight at"], who: star, fact: "division", has: ["fights at"] },
    { qs: ["who trains NAME", "who is NAME's trainer"], who: trained, fact: "trainer", has: [`head trainer is ${trainer.name}`] },
    { qs: ["which gym does NAME train at", "where does NAME train"], who: gymmed, fact: "gym", has: [`trains at ${gymName}`] },
    { qs: ["when did NAME last fight", "what was NAME's last fight"], who: star, fact: "last_fight", has: ["last fight was on", lastOpp, lastBout.date.slice(0, 4)] },
    { qs: ["when does NAME fight next", "who is NAME's next opponent", "NAME's next fight"], who: booked, fact: "next_fight", has: ["next fight is against", next.redId === booked.id ? next.blueName : next.redName] },
    { qs: ["what is NAME's record", "how many fights has NAME had"], who: star, fact: "record", has: [`${star.wins + star.losses + star.draws} fights: ${recordStr(star)}`] },
    { qs: ["how many knockouts does NAME have", "what is NAME's knockout rate"], who: star, fact: "knockouts", has: [`${star.kos} knockouts in ${star.wins} wins`] },
    { qs: ["what is NAME's rating", "how is NAME ranked"], who: star, fact: "rating", has: [`rated ${Math.round(star.rating)}`] },
    { qs: ["does NAME hold a belt", "which titles does NAME hold"], who: star, fact: "belts", has: ["current belt", "holds"] },
  ];
  const bad: string[] = [];
  for (const c of cases) for (const q of c.qs) {
    const { call, text } = await asked(q.replace("NAME", c.who.name));
    if (call?.tool !== "fighter" || call.args.about !== c.fact) { bad.push(`"${q}" -> ${call ? call.tool + JSON.stringify(call.args) : "none"}, wanted fighter/${c.fact}`); continue; }
    const missing = c.has.filter((x) => c.fact === "belts" ? false : !text.includes(x));
    if (missing.length) bad.push(`"${q}" -> "${text}" lacks ${missing.join(", ")}`);
    if (c.fact === "belts" && !/holds/.test(text)) bad.push(`"${q}" -> "${text}"`);
    if (/-year-old/.test(text)) bad.push(`"${q}" got the generic profile: "${text}"`);
  }
  assert.deepEqual(bad, []);
});

test("a fighter's knockout rate is his own, not the league's list; a superlative about a fighter is still a list; no fact is the profile", async () => {
  const star = pick((b) => unique(b) && b.bouts > 8);
  const own = await asked(`what is ${star.name}'s knockout rate`);
  assert.equal(own.call.tool, "fighter");
  assert.ok(!/leads with/.test(own.text), own.text);
  const profile = await asked(`tell me about ${star.name}`);
  assert.equal(profile.call.args.about, undefined);
  assert.match(profile.text, /year-old|is a /);
  assert.notEqual((await asked(`who has beaten ${star.name} the most`)).call?.args.about, "record");
  assert.equal((await asked("who has the highest knockout rate")).call.tool, "record_list", "no fighter named: still the list");
  // a superlative beside a fact word is a question about more than one fact of one fighter: it is not read as the fact
  for (const q of [`what is the most knockouts ${star.name} has scored in a fight`, `which titles did ${star.name} hold the longest`, `is ${star.name} the best fighter in the division`]) assert.equal((await asked(q)).call?.args.about, undefined, q);
});

test("the same facts in Arabic, with the fighter's Arabic name", async () => {
  const star = pick((b) => unique(b) && b.heightCm !== null && b.age !== null && b.bouts > 8);
  const table = { [star.name]: "راكان الشمري" };
  const age = await answer("كم عمر راكان الشمري", "ar", table);
  assert.equal(age.calls[0]?.args.about, "age");
  assert.match(age.answer, new RegExp(`^عمر .+ ${star.age} سنة\\.$`), "the sentence is Arabic, with the age in Western digits (the name is shown as the site shows it)");
  const height = await answer("ما طول راكان الشمري", "ar", table);
  assert.match(height.answer, new RegExp(`${star.heightCm} سم`));
});

test("the `about` argument is declared for the model's plan too, and a value that is not a fact is dropped", () => {
  const tool = T.toolByName("fighter")!;
  assert.deepEqual(T.FIGHTER_FACTS.length, 14);
  assert.equal(T.sanitizeArgs(tool, { name: "X", about: "height" }).about, "height");
  assert.equal(T.sanitizeArgs(tool, { name: "X", about: "shoe size" }).about, undefined);
  assert.ok(tool.about.includes("about"));
});
