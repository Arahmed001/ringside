import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeBoxer, miniFeed, tempDb } from "./helpers";
import { makeT, tEn, type Dict } from "../lib/i18n/t";

/**
 * A hand-built league where every fight is between two debutants (both rated 1500 going in), so each fight's score can be
 * worked out by hand from the formulas in lib/fight-score.ts and checked against the code.
 */
const cleanupDb = tempDb("awards");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ringside-awards-"));
after(() => { cleanupDb(); fs.rmSync(dir, { recursive: true, force: true }); });

type World = Awaited<ReturnType<typeof import("../lib/world").getWorld>>;
let w: World;
let S: typeof import("../lib/fight-score");
let R: typeof import("../lib/records");
const AR = JSON.parse(fs.readFileSync(path.join(process.cwd(), "i18n", "ar.json"), "utf8")) as Dict;

const ids: Record<string, number> = {}; // fight label -> bout id
let n = 0;

before(async () => {
  const feed = miniFeed();
  feed.bouts = []; feed.events = []; feed.boxers = []; feed.scorecards = []; feed.officials = []; feed.weighIns = []; feed.corners = []; feed.punches = []; feed.stints = [];
  const people = feed.people;
  type Fight = { label: string; date: string; rounds?: number; winner?: "red" | "blue" | null; method: string; endRound?: number; kd?: [number, number]; title?: string; vacant?: boolean; cards?: [number, number][]; punches?: [number, number]; sex?: "male" | "female"; division?: string; time?: string };
  const fights: Fight[] = [
    { label: "wide", date: "2023-02-01", method: "UD", cards: [[120, 108], [120, 108], [120, 108]] },
    { label: "split", date: "2023-03-01", method: "SD", winner: "red", cards: [[115, 113], [113, 115], [114, 114]], kd: [2, 2], title: "World Title", vacant: true, punches: [150, 150] },
    { label: "late", date: "2023-04-01", method: "KO", endRound: 12, kd: [1, 0], winner: "blue", time: "1:00" },
    { label: "early", date: "2023-05-01", method: "KO", endRound: 1, winner: "red", time: "0:20" },
    { label: "short", date: "2023-06-01", rounds: 4, method: "UD", cards: [[40, 36], [40, 36], [40, 36]] },
    { label: "dq", date: "2023-07-01", method: "DQ", endRound: 5, winner: "red" },
    { label: "nc", date: "2023-08-01", method: "NC", winner: null, endRound: 3 },
    { label: "draw", date: "2023-09-01", method: "DRAW", winner: null, cards: [[114, 114], [113, 113], [115, 115]] },
    { label: "women", date: "2024-01-01", method: "KO", endRound: 11, winner: "red", sex: "female", division: "Flyweight", time: "0:45" },
    { label: "later", date: "2024-02-01", method: "UD", cards: [[117, 111], [116, 112], [117, 111]] },
  ];
  let k = 0;
  for (const f of fights) {
    const a = `P${++k}`, b = `P${++k}`;
    for (const id of [a, b]) feed.boxers.push(makeBoxer(id, f.division ?? "Lightweight", { sex: f.sex ?? "male" }));
    const ev = `EV${++n}`;
    feed.events.push({ externalId: ev, name: `Card ${n}`, date: f.date, venue: "Arena", city: "Reno", country: "United States" });
    const win = f.winner === undefined ? "red" : f.winner;
    feed.bouts.push({
      externalId: `${ev}-b`, eventExternalId: ev, redExternalId: a, blueExternalId: b, weightClass: f.division ?? "Lightweight", rounds: f.rounds ?? 12,
      winnerExternalId: win === "red" ? a : win === "blue" ? b : null, method: f.method as never, endRound: f.endRound ?? (f.cards ? (f.rounds ?? 12) : null), title: f.title ?? null,
      titleVacant: f.vacant, position: 1, kdRed: f.kd?.[0] ?? 0, kdBlue: f.kd?.[1] ?? 0, roundTime: f.time,
    } as never);
    f.cards?.forEach(([r, u], i) => feed.scorecards.push({ boutExternalId: `${ev}-b`, judgeExternalId: people[i].externalId, seat: i + 1, red: r, blue: u }));
    if (f.cards) feed.officials.push(...f.cards.map((_, i) => ({ boutExternalId: `${ev}-b`, role: "judge" as const, personExternalId: people[i].externalId, seat: i + 1 })));
    if (f.punches) feed.punches.push(...[a, b].map((x, i) => ({ boutExternalId: `${ev}-b`, boxerExternalId: x, round: 0, thrown: f.punches![i] * 3, landed: f.punches![i], powerThrown: 1, powerLanded: 1 })));
  }
  const file = path.join(dir, "feed.json");
  fs.writeFileSync(file, JSON.stringify(feed));
  process.env.BOXING_PROVIDER = "file"; process.env.BOXING_FILE = file;
  w = await (await import("../lib/world")).getWorld();
  S = await import("../lib/fight-score");
  R = await import("../lib/records");
  for (const b of w.bouts) { const i = Number(b.eventName.replace("Card ", "")) - 1; ids[fights[i].label] = b.id; }
});

const score = (label: string) => S.scoreFight(w, w.boutById.get(ids[label])!);

test("only fights of six rounds or more with a real result are scored", () => {
  for (const l of ["short", "dq", "nc"]) assert.equal(score(l), null, l);
  for (const l of ["wide", "split", "late", "early", "draw"]) assert.ok(score(l), l);
});

test("a fight's score is the weighted sum of its parts, worked out by hand", () => {
  // two debutants: pre-fight 50/50 at 1500, so matchup = 0.5 * 1 + 0.5 * 0. A 120-108 sweep has no finish value and no action data.
  const wide = score("wide")!;
  assert.deepEqual(wide.parts, { knockdowns: 0, finish: 0, action: null, matchup: 0.5, upset: 0, stakes: 0, comeback: 0 });
  assert.equal(wide.score, Math.round((100 * (0.16 * 0.5)) / 0.8)); // 0.80 of the weight was available, so the rest is scaled up: 10
  assert.equal(wide.score, 10);
  assert.ok(Math.abs(wide.coverage - 0.8) < 1e-9);
});

test("knockdowns on both sides, a split decision, a vacant world title and heavy action make the top fight", () => {
  const split = score("split")!;
  assert.equal(split.parts.knockdowns, 1); // 4 knockdowns, both fighters down: 0.7 + 0.3
  assert.equal(split.parts.finish, 0.85); // the judges disagree, so at least 0.85
  assert.equal(split.parts.stakes, 1); // 0.6 + 0.25 (world) + 0.15 (vacant)
  assert.ok(split.parts.action !== null);
  assert.equal(split.coverage, 1);
  const ranked = S.fightsOfYear(w, 2023).map((s) => s.bout.id);
  assert.equal(ranked[0], ids.split);
  assert.equal(ranked.at(-1), ids.wide);
  assert.deepEqual(ranked.filter((id) => [ids.short, ids.dq, ids.nc].includes(id)), []);
});

test("a late stoppage is worth more than an early one, a draw is the closest finish, a comeback is a part of its own", () => {
  assert.ok(score("late")!.parts.finish! > score("early")!.parts.finish!);
  assert.equal(score("early")!.parts.finish, 0.25);
  assert.equal(score("late")!.parts.finish, 1);
  assert.equal(score("draw")!.parts.finish, 1);
  // blue won after being knocked down? kd is [red, blue] = [1, 0]: red was down and red lost, so no comeback
  assert.equal(score("late")!.parts.comeback, 0);
  assert.equal(score("late")!.facts.kdAgainstWinner, 0);
});

test("the reasons name what helped and leave out what did not", () => {
  const texts = S.fightReasons(w, score("split")!, tEn, 10).map((r) => r.text);
  assert.ok(texts.some((x) => /Both fighters went down: 4 knockdowns in all/.test(x)));
  assert.ok(texts.some((x) => /split decision.*115–113, 113–115, 114–114/.test(x)));
  assert.ok(texts.some((x) => /vacant title/.test(x)));
  const wide = S.fightReasons(w, score("wide")!, tEn, 10).map((r) => r.text);
  assert.ok(!wide.some((x) => /knockdown|split|title/i.test(x)), wide.join("|")); // a one-sided decision is not praised for drama
});

test("tiers, ranks and the feature year", () => {
  assert.deepEqual([80, 60, 45, 30, 10].map(S.tier), ["classic", "great", "good", "solid", "routine"]);
  assert.deepEqual(S.fightRank(w, ids.split), { year: 2023, rank: 1, of: S.fightsOfYear(w, 2023).length, score: score("split")!.score });
  assert.equal(S.fightRank(w, ids.dq), null);
  assert.deepEqual(S.fightYears(w), [2024, 2023]);
  assert.equal(S.featuredYear(w), 2024); // 2026 is the current year and has no eligible fights, so the latest year is 2024
  assert.equal(S.fightOfTheYear(w)[1].top.bout.id, ids.split);
  assert.equal(S.bestFightsEver(w, 1)[0].bout.id, S.fightOfTheYear(w).sort((a, b) => b.top.score - a.top.score)[0].top.bout.id);
});

test("records match a plain count of the fights", () => {
  const rows = R.recordList(w, "wins", {}, 100);
  const manual = [...w.boxers].filter((b) => b.wins > 0).sort((a, b) => b.wins - a.wins || a.name.localeCompare(b.name));
  assert.deepEqual(rows.map((r) => r.boxer!.id), manual.map((b) => b.id));
  assert.deepEqual(rows.map((r) => r.rank), rows.map((_, i) => i + 1));
  const kos = R.recordList(w, "kos", {}, 100);
  assert.equal(kos.length, w.boxers.filter((b) => b.kos > 0).length);
  assert.ok(kos.every((r) => r.value === r.boxer!.kos));
  // fastest knockout: round 1 at 0:20 = 20 s, then round 11 at 0:45, then round 12 at 1:00
  const fast = R.recordList(w, "fastest-kos", {}, 10);
  assert.deepEqual(fast.map((r) => r.value), [20, 10 * 180 + 45, 11 * 180 + 60]); // the women's KO is round 11 at 0:45
  assert.equal(fast[0].bout!.id, ids.early);
  assert.equal(R.secondsIn(w.boutById.get(ids.late)!), 11 * 180 + 60);
});

test("sex and division filters, and unrecognised filters mean no filter", () => {
  const women = R.recordList(w, "wins", { sex: "female" }, 100);
  assert.ok(women.length && women.every((r) => r.boxer!.sex === "female"));
  const fly = R.recordList(w, "fights", { division: "Flyweight" }, 100);
  assert.ok(fly.every((r) => r.bout!.weightClass === "Flyweight"));
  assert.deepEqual(R.parseScope({ sex: "robot", division: "nope" }).scope, { sex: undefined, division: undefined });
  assert.deepEqual(R.parseScope({ sex: "female", division: "light-heavyweight" }).scope, { sex: "female", division: "Light Heavyweight" });
  // lists that do not take filters ignore them
  assert.deepEqual(R.recordList(w, "divisions", { sex: "female" }, 5), R.recordList(w, "divisions", {}, 5));
});

test("every list renders in both languages with no English left in Arabic", () => {
  const ar = makeT("ar", AR);
  for (const def of R.LISTS) {
    const rows = R.recordList(w, def.id, {}, 5);
    for (const r of rows) {
      const { value, sub } = R.rowText(def.id, r, ar);
      assert.ok(value.length > 0);
      assert.ok(!/\{[a-z]+\}|undefined|NaN/.test(`${value} ${sub ?? ""}`), `${def.id}: ${value} ${sub}`);
      if (sub) assert.ok(!/[A-Za-z]{4,}/.test(sub.replace(/Elo/g, "")), `${def.id}: English left in "${sub}"`);
    }
    assert.notEqual(ar(def.title), def.title, def.title);
    assert.notEqual(ar(def.blurb), def.blurb, def.id);
  }
  for (const s of S.fightsOfYear(w, 2023)) for (const r of S.fightReasons(w, s, ar, 6)) assert.ok(!/[A-Za-z]{4,}/.test(r.text.replace(/Fighter [A-Z0-9]+|World Title/g, "")), r.text);
});

test("the sitemap lists every list and every year", async () => {
  const { sitemapPaths } = await import("../lib/sitemap");
  const paths = sitemapPaths(w).map((p) => p.path);
  for (const p of ["/all-time", "/fight-of-the-year", "/fight-of-the-year/2023", "/fight-of-the-year/2024", ...R.LISTS.map((l) => `/all-time/${l.id}`)]) assert.ok(paths.includes(p), p);
});
