import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeBoxer, miniFeed, tempDb } from "./helpers";

/** A hand-built title history that covers every way a belt can change hands, loaded through the JSON file provider. */
const cleanupDb = tempDb("lineage");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ringside-lineage-"));
after(() => { cleanupDb(); fs.rmSync(dir, { recursive: true, force: true }); });

type World = Awaited<ReturnType<typeof import("../lib/world").getWorld>>;
let w: World;
let L: typeof import("../lib/lineage");

let n = 0;
const ev = (date: string) => ({ externalId: `LE${++n}`, name: `Card ${n}`, date, venue: "Arena", city: "Reno", country: "United States" });
const mkBout = (event: string, red: string, blue: string, winner: string | null, method: string | null, title: string | null, org: string | undefined, over: Record<string, unknown> = {}) => ({
  externalId: `${event}-b`, eventExternalId: event, redExternalId: red, blueExternalId: blue, weightClass: "Lightweight", rounds: 12,
  winnerExternalId: winner, method, endRound: method === "UD" || method === "SD" || method === "DRAW" ? 12 : 5, title, titleOrgExternalId: org, position: 1, ...over,
});

before(async () => {
  const feed = miniFeed();
  feed.boxers.push(...["C", "D", "E"].map((id) => makeBoxer(id)), makeBoxer("F", "Lightweight", { sex: "female" }), makeBoxer("G", "Lightweight", { sex: "female" }));
  feed.orgs.push({ externalId: "WBX", name: "World Boxing X", kind: "sanctioning_body" }, { externalId: "IBY", name: "International Boxing Y", kind: "sanctioning_body" });
  const e = (d: string) => { const x = ev(d); feed.events.push(x); return x.externalId; };
  const add = (date: string, red: string, blue: string, winner: string | null, method: string | null, title: string | null, org: string | undefined, over: Record<string, unknown> = {}) =>
    feed.bouts.push(mkBout(e(date), red, blue, winner, method, title, org, over) as never);
  // the World Boxing X world title at lightweight
  add("2020-01-01", "A", "B", "A", "UD", "World Title", "WBX", { titleVacant: true });   // A wins the vacant belt
  add("2020-06-01", "C", "A", "A", "KO", "World Title", "WBX");                           // defence 1
  add("2020-09-01", "A", "D", null, "DRAW", "World Title", "WBX");                        // draw: belt kept
  add("2021-01-01", "B", "A", null, "NC", "World Title", "WBX");                          // no contest: nothing changes
  add("2021-03-01", "D", "A", "D", "SD", "World Title", "WBX");                           // A loses it to D
  add("2021-06-01", "E", "C", "E", "TKO", "World Title", "WBX");                          // neither is champion: belt passes to E
  add("2021-09-01", "A", "B", "A", "UD", "World Title", "WBX", { status: "cancelled", method: null, winnerExternalId: null }); // cancelled: ignored
  add("2022-01-01", "B", "C", "B", "UD", "World Title", "WBX", { titleVacant: true });   // vacant fight while E still holds it: E vacated
  add("2026-12-01", "A", "B", null, null, "World Title", "WBX");                          // upcoming: ignored
  // a different belt lines: interim title, another body, and the women's division
  add("2021-02-01", "A", "B", "B", "UD", "Interim World Title", "WBX");
  add("2021-02-08", "A", "C", "C", "UD", "World Title", "IBY");
  add("2021-04-01", "F", "G", "F", "UD", "World Title", "WBX");
  const file = path.join(dir, "feed.json");
  fs.writeFileSync(file, JSON.stringify(feed));
  process.env.BOXING_PROVIDER = "file"; process.env.BOXING_FILE = file;
  w = await (await import("../lib/world")).getWorld();
  L = await import("../lib/lineage");
});

const belt = (slug: string) => L.belts(w).find((b) => b.slug === slug)!;
const ext = (id: number) => (w.byId.get(id)!.name.replace("Fighter ", ""));

test("one belt per body, title name, division and sex", () => {
  const slugs = L.belts(w).map((b) => b.slug).sort();
  assert.deepEqual(slugs, ["international-boxing-y-world-title-lightweight", "world-boxing-x-interim-world-title-lightweight", "world-boxing-x-world-title-lightweight", "world-boxing-x-world-title-lightweight-women"]);
  assert.equal(L.beltBySlug(w, "world-boxing-x-world-title-lightweight")!.sex, "male");
  assert.equal(L.beltBySlug(w, "world-boxing-x-world-title-lightweight-women")!.sex, "female");
  assert.equal(L.beltBySlug(w, "nope"), undefined);
});

test("a lineage follows the fights: vacant win, defence, draw, no-contest, loss, a belt passing, a vacated belt", () => {
  const b = belt("world-boxing-x-world-title-lightweight");
  assert.deepEqual(b.reigns.map((r) => [ext(r.boxerId), r.how, r.start, r.end, r.endedBy]), [
    ["A", "vacant", "2020-01-01", "2021-03-01", "lost"],
    ["D", "won", "2021-03-01", "2021-06-01", "passed"],
    ["E", "inherited", "2021-06-01", "2022-01-01", "vacated"],
    ["B", "vacant", "2022-01-01", null, null],
  ]);
  const a = b.reigns[0];
  assert.equal(a.defenses.length, 1); assert.equal(ext(a.defenses[0].opponentId), "C"); assert.equal(a.defenses[0].method, "KO");
  assert.equal(a.draws, 1, "a draw keeps the belt and is counted");
  assert.equal(ext(a.opponentId!), "B");
  assert.equal(b.reigns[1].opponentId, w.byId.get(b.reigns[0].boxerId)!.id, "D beat the champion");
  assert.equal(b.reigns[2].opponentId, null, "E inherited it: no title fight against the holder");
  assert.equal(a.days, 425);
  assert.equal(b.titleFights, 6, "the NC, the cancelled bout and the upcoming bout are not title fights on the record");
  assert.equal(b.current?.boxerId, b.reigns[3].boxerId);
  assert.equal(b.firstDate, "2020-01-01"); assert.equal(b.lastDate, "2022-01-01");
});

test("interim, other-body and women's belts keep their own champions", () => {
  assert.deepEqual(belt("world-boxing-x-interim-world-title-lightweight").reigns.map((r) => [ext(r.boxerId), r.how]), [["B", "first"]], "no vacant flag: first champion on record");
  assert.deepEqual(belt("international-boxing-y-world-title-lightweight").reigns.map((r) => ext(r.boxerId)), ["C"]);
  assert.deepEqual(belt("world-boxing-x-world-title-lightweight-women").reigns.map((r) => ext(r.boxerId)), ["F"]);
});

test("a belt whose holder has gone quiet is marked dormant, not silently vacant", () => {
  const live = belt("world-boxing-x-world-title-lightweight");
  assert.equal(live.stale, true, "last title fight in 2022, today is 2026-10-03");
  assert.ok(L.belts(w).every((b) => b.stale), "every belt in this fixture is old");
});

test("reignsOf, beltsHeld and stats", () => {
  const b = w.boxers.find((x) => x.name === "Fighter A")!;
  assert.equal(L.reignsOf(w, b.id).length, 1);
  assert.deepEqual(L.beltsHeld(w, b.id), [], "A lost it");
  const c = w.boxers.find((x) => x.name === "Fighter B")!;
  assert.equal(L.beltsHeld(w, c.id).length, 2, "B holds the X world title and the X interim title");
  const s = L.beltStats(w, belt("world-boxing-x-world-title-lightweight"));
  assert.equal(s.champions, 4); assert.equal(s.totalDefenses, 1); assert.equal(ext(s.longest!.boxerId), "B", "B has held it since 2022"); assert.equal(ext(s.mostDefenses!.boxerId), "A"); assert.equal(s.mostReigns, null);
  const rs = belt("world-boxing-x-world-title-lightweight").reigns;
  for (let i = 0; i < rs.length - 1; i++) assert.equal(rs[i].end, rs[i + 1].start, "a lineage has no gaps: each reign ends on the day the next begins");
});

test("the demo league's belts are fought over like belts: title fights involve the champion", async () => {
  const { demoProvider } = await import("../lib/providers/demo");
  const p = demoProvider(new Date("2026-10-03"));
  const [boxers, events, bouts] = await Promise.all([p.fetchBoxers(), p.fetchEvents(), p.fetchBouts()]);
  const date = new Map(events.map((x) => [x.externalId, x.date]));
  const titled = bouts.filter((x) => x.title && x.method && x.status !== "cancelled" && x.method !== "NC");
  assert.ok(titled.length > 300, `${titled.length} title fights`);
  const sex = new Map(boxers.map((x) => [x.externalId, x.sex ?? "male"]));
  // every belt's champion at each moment is the winner of its last decisive title fight, and a title bout always involves the champion unless the belt is vacant
  const champ = new Map<string, string>();
  let bad = 0;
  for (const x of [...titled].sort((a, b) => date.get(a.eventExternalId)!.localeCompare(date.get(b.eventExternalId)!) || a.position - b.position)) {
    const key = `${x.titleOrgExternalId}|${x.title}|${x.weightClass}|${sex.get(x.redExternalId)}`;
    const c = champ.get(key);
    if (c && !x.titleVacant && x.redExternalId !== c && x.blueExternalId !== c && date.get(x.eventExternalId)! > "2000-01-01") bad++;
    if (x.winnerExternalId) champ.set(key, x.winnerExternalId);
  }
  assert.ok(bad <= titled.length * 0.06, `${bad} of ${titled.length} demo title fights do not involve the champion (only dormant-belt successions allowed)`);
});
