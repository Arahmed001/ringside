import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tempDb } from "./helpers";
import { makeT, tEn } from "../lib/i18n/t";

/** Six more facts about one fighter (round 61): when he turned pro, his nickname, his style, his promoter, his streaks and his decisions. */
const cleanup = tempDb("ask-facts-more");
after(cleanup);
type World = Awaited<ReturnType<typeof import("../lib/world").getWorld>>;
type Boxer = World["boxers"][number];
let w: World;
let ask: typeof import("../lib/ask").askData;
const AR = JSON.parse(fs.readFileSync(path.join(process.cwd(), "i18n", "ar.json"), "utf8"));
before(async () => { w = await (await import("../lib/world")).getWorld(); ask = (await import("../lib/ask")).askData; });
const answer = (q: string, ar = false) => ask(q, { w, t: ar ? makeT("ar", AR) : tEn, names: {} });
const pick = (f: (b: Boxer) => boolean) => [...w.boxers].sort((x, y) => y.bouts - x.bouts || x.id - y.id).find((b) => f(b) && w.boxers.filter((x) => x.name === b.name).length === 1 && ![...w.people.values()].some((p) => p.name === b.name))!;
const fights = (b: Boxer) => (w.boutsByBoxer.get(b.id) ?? []).filter((x) => !x.upcoming && x.method && x.method !== "NC");

test("the year he turned pro, his nickname and his style are those facts", async () => {
  const b = pick((x) => x.turnedPro !== null && !!x.nickname);
  const d = await answer(`when did ${b.name} turn pro`);
  assert.deepEqual(d.calls[0], { tool: "fighter", args: { name: b.name, about: "debut" } });
  assert.match(d.answer, new RegExp(String(b.turnedPro)));
  const n = await answer(`what is ${b.name}'s nickname`);
  assert.equal(n.calls[0].args.about, "nickname");
  assert.ok(n.answer.includes(b.nickname!), n.answer);
  const s = await answer(`what is ${b.name}'s style`);
  assert.equal(s.calls[0].args.about, "style");
  assert.match(s.answer, /style is (Knockout Artist|Volume Boxer|Technician|Iron-Chin Brawler|Counter-Puncher|Journeyman|Prospect)/);
  const none = pick((x) => !x.nickname);
  assert.match((await answer(`what is ${none.name}'s nickname`)).answer, /no nickname on record/, "no nickname is said, not made up");
});

test("his streak is the current run and the longest winning run, from his own fights", async () => {
  const b = pick((x) => x.streak.type === "W" && x.streak.count >= 3);
  let longest = 0, run = 0;
  for (const x of fights(b)) { run = x.winnerId === b.id ? run + 1 : 0; longest = Math.max(longest, run); }
  const a = await answer(`what is ${b.name}'s longest win streak`);
  assert.deepEqual(a.calls[0], { tool: "fighter", args: { name: b.name, about: "streak" } }, "not the list of the longest streaks for everybody");
  assert.ok(a.answer.includes(`streak of ${b.streak.count}`) && a.answer.includes(`run: ${longest}`), a.answer);
  assert.equal((await answer("who has the longest win streak")).calls[0].tool, "record_list", "and with no name it is still the list");
  const l = pick((x) => x.streak.type === "L" && x.streak.count >= 2);
  assert.match((await answer(`is ${l.name} on a streak`)).answer, /losing streak/);
});

test("his decisions are his, and his promoter is the one of his current stint", async () => {
  const b = pick((x) => fights(x).some((f) => ["UD", "MD", "SD", "TD"].includes(f.method!)));
  const dec = fights(b).filter((f) => ["UD", "MD", "SD", "TD"].includes(f.method!) && f.winnerId !== null);
  const a = await answer(`how many decisions has ${b.name} won`);
  assert.equal(a.calls[0].args.about, "decisions", "not every fight in the data that went to the scorecards");
  assert.ok(a.answer.includes(`${dec.filter((f) => f.winnerId === b.id).length} wins and ${dec.filter((f) => f.winnerId !== b.id).length} losses by decision`), a.answer);
  const p = pick((x) => (w.stintsByBoxer.get(x.id) ?? []).some((s) => s.role === "promoter" && s.end === null && s.orgId));
  const org = w.orgs.get((w.stintsByBoxer.get(p.id) ?? []).find((s) => s.role === "promoter" && s.end === null && s.orgId)!.orgId!)!;
  assert.ok((await answer(`who is ${p.name}'s promoter`)).answer.includes(org.name));
});

test("each of them is answered in Arabic, and the stance sentence is no longer 'a Orthodox'", async () => {
  const b = pick((x) => x.turnedPro !== null && x.streak.count >= 1);
  for (const f of ["when did {n} turn pro", "what is {n}'s style", "what is {n}'s longest win streak", "how many decisions has {n} won"]) {
    const a = await answer(f.replace("{n}", b.name), true);
    assert.ok(/[؀-ۿ]/.test(a.answer) && !/\bthe\b|\bwins and\b/.test(a.answer), a.answer);
  }
  const st = await answer(`is ${pick((x) => !!x.stance).name} a southpaw`);
  assert.doesNotMatch(st.answer, /\ba (Orthodox|Orthodoxe)\b|\ba Orthodox/);
});

test("the other ways of asking, and a fighter whose last fight was a draw", async () => {
  const b = pick((x) => x.turnedPro !== null && !!x.nickname && x.streak.type === "W");
  for (const [q, fact] of [[`when did ${b.name} debut`, "debut"], [`what is ${b.name} called`, "nickname"], [`is ${b.name} on a roll`, "streak"]] as const) assert.equal((await answer(q)).calls[0]?.args.about, fact, q);
  const d = pick((x) => x.streak.type === "D");
  assert.match((await answer(`is ${d.name} on a streak`)).answer, /not on a streak/, "a draw is no winning or losing streak");
});
