import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeBoxer, miniFeed, tempDb } from "./helpers";

/** "Since you last looked": a league built by hand, with today pinned to 2026-10-03 (see tests/helpers.ts). */
const cleanup = tempDb("watch-digest", "2026-10-03");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ringside-wd-"));
after(() => { cleanup(); fs.rmSync(dir, { recursive: true, force: true }); });
type World = Awaited<ReturnType<typeof import("../lib/world").getWorld>>;
let w: World;
let digest: typeof import("../lib/watch-digest").watchDigest;
let GET: (q: string) => Promise<{ status: number; json: Record<string, unknown> }>;

before(async () => {
  const feed = miniFeed();
  const names = ["Alma Ruiz", "Bea Cole", "Cyrus Dean", "Dov Eden", "Eli Fox", "Fay Gil", "Gus Hay", "Hana Ito", "Ivo Jan", "Jo Kay", "Kit Lee"];
  feed.boxers = names.map((n, i) => makeBoxer(`B${i}`, "Lightweight", { name: n }));
  const ev = (id: string, date: string) => ({ externalId: id, name: `Night ${id}`, date, venue: "Arena", city: "Las Vegas", country: "United States" });
  const bout = (id: string, e: string, red: string, blue: string, extra = {}) => ({ externalId: id, eventExternalId: e, redExternalId: red, blueExternalId: blue, weightClass: "Lightweight", rounds: 12, winnerExternalId: null, method: null, endRound: null, title: null, position: 0, ...extra });
  // Alma (B0) fights seven times in 2026, ending with a loss; Dov (B3) and Eli (B4) fight once each, long ago
  const dates = ["2026-01-10", "2026-02-10", "2026-03-10", "2026-04-10", "2026-05-10", "2026-06-10", "2026-09-20"];
  feed.events = [...dates.map((d, i) => ev(`E${i}`, d)), ev("OLD", "2025-01-10"), ev("NEXT", "2026-10-10"), ev("FAR", "2026-12-01"), ev("CXL", "2026-10-05")];
  feed.bouts = [
    ...dates.map((_, i) => bout(`A${i}`, `E${i}`, "B0", `B${i + 4}`, i === 6 ? { winnerExternalId: `B${i + 4}`, method: "KO", endRound: 3 } : { winnerExternalId: "B0", method: "UD", endRound: 12 })),
    bout("OLDB", "OLD", "B3", "B4", { winnerExternalId: "B3", method: "UD", endRound: 12 }),
    bout("NEXTB", "NEXT", "B0", "B1", {}), bout("FARB", "FAR", "B1", "B2", {}), bout("CXLB", "CXL", "B3", "B2", { status: "cancelled" }),
  ] as never;
  feed.weighIns = []; feed.scorecards = []; feed.officials = []; feed.corners = []; feed.punches = [];
  const file = path.join(dir, "feed.json");
  fs.writeFileSync(file, JSON.stringify(feed));
  process.env.BOXING_PROVIDER = "file"; process.env.BOXING_FILE = file;
  w = await (await import("../lib/world")).getWorld();
  digest = (await import("../lib/watch-digest")).watchDigest;
  const route = await import("../app/api/watch/digest/route");
  GET = async (q) => { const r = await route.GET(new Request(`http://localhost/api/watch/digest${q}`)); return { status: r.status, json: (await r.json()) as Record<string, unknown> }; };
});

const slug = (n: string) => n.toLowerCase().replace(/ /g, "-");

test("results after the day last seen, the latest five with the rest counted, each with how the rating moved", () => {
  const d = digest(w, [slug("Alma Ruiz")], "2026-01-10");
  const a = d.items[0];
  assert.equal(a.name, "Alma Ruiz"); assert.equal(d.today, "2026-10-03"); assert.equal(d.since, "2026-01-10");
  assert.equal(a.results.length, 5, "five shown"); assert.equal(a.moreResults, 1, "and the sixth counted: six fights are after January 10 (the day itself was seen)");
  assert.deepEqual(a.results.map((r) => r.date), ["2026-03-10", "2026-04-10", "2026-05-10", "2026-06-10", "2026-09-20"], "the five latest, oldest first");
  const last = a.results.at(-1)!;
  assert.equal(last.result, "L"); assert.match(last.how, /KO/); assert.equal(last.opponent, "Kit Lee");
  const hist = w.history.get(w.bySlug.get(slug("Alma Ruiz"))!.id)!;
  for (const r of a.results) { const i = hist.findIndex((h) => h.boutId === r.boutId); assert.equal(r.ratingDelta, Math.round(hist[i].rating) - Math.round(hist[i - 1].rating), `rating delta on ${r.date}`); }
  assert.ok(last.ratingDelta! < 0, "a loss lowers the rating");
});

test("the day itself is already seen, a later day shows only what is newer, and a day with nothing newer shows no results", () => {
  assert.deepEqual(digest(w, [slug("Alma Ruiz")], "2026-09-20").items[0].results, [], "the fight on the day last seen is not new");
  const sep = digest(w, [slug("Alma Ruiz")], "2026-09-19").items[0];
  assert.deepEqual(sep.results.map((r) => r.date), ["2026-09-20"]); assert.equal(sep.moreResults, 0);
  assert.equal(digest(w, [slug("Alma Ruiz")], "2026-09-30").items[0].results.length, 0);
});

test("the rating move is from the end of the day last seen to now, and only when it moved", () => {
  const a = digest(w, [slug("Alma Ruiz")], "2026-06-10").items[0];
  const hist = w.history.get(w.bySlug.get(slug("Alma Ruiz"))!.id)!;
  assert.deepEqual(a.rating, { from: Math.round(hist.find((h) => h.date === "2026-06-10")!.rating), to: Math.round(hist.at(-1)!.rating) });
  assert.ok(a.rating!.to < a.rating!.from, "the loss since then");
  assert.equal(digest(w, [slug("Alma Ruiz")], "2026-09-30").items[0].rating, null, "nothing since the 20th: the rating has not moved since the 30th");
  assert.equal(digest(w, [slug("Dov Eden")], "2025-06-01").items.find((i) => i.slug === slug("Dov Eden"))?.rating ?? null, null, "no fight since: the rating did not move");
});

test("the next fight shows when it is within a fortnight, never a far one or a cancelled one", () => {
  const a = digest(w, [slug("Alma Ruiz")], "2026-09-30").items[0];
  assert.deepEqual({ opponent: a.next!.opponent, date: a.next!.date, days: a.next!.days }, { opponent: "Bea Cole", date: "2026-10-10", days: 7 });
  const far = digest(w, [slug("Bea Cole")], "2026-09-30");
  assert.equal(far.items.find((i) => i.slug === slug("Bea Cole"))?.next?.date, "2026-10-10", "Bea's next is the October fight, not December's");
  const cyrus = digest(w, [slug("Cyrus Dean")], "2026-09-30");
  assert.equal(cyrus.items.length, 0, "Cyrus's next fight is in December (and his October one was cancelled): nothing to say yet"); assert.equal(cyrus.watched, 1);
  const dov = digest(w, [slug("Dov Eden")], "2026-09-30");
  assert.equal(dov.items.length, 0, "a cancelled fight is not a next fight, and Dov has nothing else");
  assert.equal(dov.watched, 1);
});

test("who is shown and in what order: fighters with nothing new are left out, unknown names ignored, a long list capped, a result before a fight coming up", () => {
  const d = digest(w, [slug("Dov Eden"), "nobody-here", slug("Bea Cole"), slug("Alma Ruiz"), slug("Alma Ruiz")], "2026-09-19");
  assert.equal(d.watched, 3, "three real fighters, Alma once");
  assert.deepEqual(d.items.map((i) => i.name), ["Alma Ruiz", "Bea Cole"], "Alma has a new result, Bea only a fight coming; Dov has nothing");
  assert.equal(digest(w, Array.from({ length: 300 }, (_, i) => `x-${i}`), "2026-09-19").watched, 0);
  assert.equal(digest(w, [], "2026-09-19").items.length, 0);
});

test("a day in the future shows nothing newer, and a day over a year ago is brought forward to a year", () => {
  const f = digest(w, [slug("Alma Ruiz")], "2030-01-01");
  assert.equal(f.since, "2026-10-03"); assert.equal(f.items[0].results.length, 0);
  const old = digest(w, [slug("Alma Ruiz")], "2000-01-01");
  assert.equal(old.clamped, true); assert.equal(old.since, "2025-10-03"); assert.equal(old.items[0].moreResults, 2, "seven fights since October 2025, five shown");
  assert.equal(digest(w, [slug("Alma Ruiz")], "2026-01-10").clamped, false);
});

test("Arabic: the names and the way each fight ended come in Arabic", async () => {
  const { tFor } = await import("../lib/i18n/dicts");
  const d = digest(w, [slug("Alma Ruiz")], "2026-09-19", tFor("ar"));
  assert.match(d.items[0].results[0].how, /[؀-ۿ]/, "the method is Arabic");
  assert.match(d.items[0].results[0].dateLabel, /[؀-ۿ٠-٩]/, "the date is in the Arabic form");
});

test("the endpoint: a first visit (no day) gets the data's day and nothing else, a day gets the digest, a bad day is a 400, the language is chosen", async () => {
  const first = await GET(`?slugs=${slug("Alma Ruiz")}`);
  assert.equal(first.status, 200); assert.deepEqual({ today: first.json.today, since: first.json.since, items: first.json.items }, { today: "2026-10-03", since: null, items: [] });
  const r = await GET(`?slugs=${slug("Alma Ruiz")},nobody&since=2026-09-19`);
  assert.equal(r.status, 200); assert.equal((r.json.items as unknown[]).length, 1); assert.equal(r.json.watched, 1);
  for (const bad of ["2026-9-19", "yesterday", "2026-02-31", "2026-13-01", ""]) assert.equal((await GET(`?slugs=a&since=${bad}`)).status, 400, bad);
  const ar = await GET(`?slugs=${slug("Alma Ruiz")}&since=2026-09-19&lang=ar`);
  assert.match(((ar.json.items as { results: { how: string }[] }[])[0]).results[0].how, /[؀-ۿ]/);
});
