import test, { after } from "node:test";
import assert from "node:assert/strict";
import { tempDb } from "./helpers";
import { makeWorld, mockVendor } from "../lib/vendor-mock";
import { boxingDataApiProvider, mapRanking, rankingBody, type ApiRanking, type Notes } from "../lib/providers/boxing-data-api";

process.env.RINGSIDE_NO_SEED = "1";
process.env.BOXING_API_STORAGE_CONFIRMED = "1";
const cleanup = tempDb("official-rankings");
after(cleanup);

/**
 * The sanctioning bodies' official lists (docs: GET /v2/rankings/, one page per division, four bodies a page). Shown beside our own Elo ranking, so the mapping must
 * keep exactly what the supplier said (a body, a division, a place) and nothing it did not, and a plan without them must not break a load.
 */
const notes = () => ({ rankingsSkipped: 0 }) as unknown as Notes;
const page = (o: Partial<ApiRanking> = {}): ApiRanking => ({
  organization: { name: "World Boxing Council", slug: "wbc" }, division: { name: "Heavyweight" }, gender: "male", updated_at: "2026-06-10T00:00:00.000000",
  champions: [{ fighter_id: "c1", fighter_name: "Champ One", title_type: "full", is_vacant: false }],
  rankings: [{ rank: 2, fighter_id: "b", fighter_name: "Two", is_vacant: false }, { rank: 1, fighter_id: "a", fighter_name: "One", is_vacant: false }], ...o,
});

test("the body is read from the name or the slug, and only the four are accepted", () => {
  assert.equal(rankingBody({ name: "International Boxing Federation", slug: "ibf" }), "IBF");
  assert.equal(rankingBody({ name: "World Boxing Association" }), "WBA");
  assert.equal(rankingBody({ slug: "wbc" }), "WBC");
  assert.equal(rankingBody({ name: "World Boxing Organization (WBO)", slug: "world-boxing-organization" }), "WBO");
  assert.equal(rankingBody({ name: "The Ring Magazine", slug: "the-ring-magazine" }), null, "a list from anyone else is not shown as an official one");
  assert.equal(rankingBody(null), null);
});

test("a page becomes one list: champions apart, contenders in rank order, the supplier's own date", () => {
  const n = notes();
  const m = mapRanking(page(), n)!;
  assert.equal(m.body, "WBC"); assert.equal(m.division, "Heavyweight"); assert.equal(m.sex, "male"); assert.equal(m.updatedAt, "2026-06-10T00:00:00.000000");
  assert.deepEqual(m.champions, [{ boxerExternalId: "bda-f-c1", name: "Champ One", titleType: "full", vacant: false }]);
  assert.deepEqual(m.contenders.map((c) => [c.rank, c.name]), [[1, "One"], [2, "Two"]], "ranked, whatever order they arrived in");
  assert.equal(n.rankingsSkipped, 0);
});

test("what cannot be stated is left out or marked vacant, never invented", () => {
  const n = notes();
  assert.equal(mapRanking(page({ organization: { name: "The Ring Magazine" } }), n), null);
  assert.equal(mapRanking(page({ division: { name: "Catchweight" } }), n), null, "a division we do not know");
  assert.equal(mapRanking(page({ gender: "female" }), n), null, "no women's lists are claimed");
  assert.equal(n.rankingsSkipped, 3);
  const m = mapRanking(page({
    champions: [{ fighter_id: null, fighter_name: null, title_type: "interim", is_vacant: true }, { fighter_id: "c2", fighter_name: "Odd", title_type: "super", is_vacant: false }],
    rankings: [{ rank: 1, fighter_id: "a", fighter_name: "One" }, { rank: 0, fighter_id: "z", fighter_name: "Zero" }, { rank: 1.5, fighter_id: "y", fighter_name: "Half" }, { rank: 2, fighter_id: "a", fighter_name: "One again" }, { rank: 3, fighter_id: null, fighter_name: null, is_vacant: true }],
  }), notes())!;
  assert.deepEqual(m.champions[0], { boxerExternalId: null, name: null, titleType: "interim", vacant: true }, "a vacant belt");
  assert.equal(m.champions[1].titleType, null, "a belt type we do not know is not guessed");
  assert.deepEqual(m.contenders.map((c) => c.rank), [1, 3], "a place that is not a whole positive number is dropped, and a fighter listed twice keeps the better place");
  assert.equal(m.contenders[1].vacant, true);
});

const league = makeWorld({ fighters: 60, fights: 220, upcoming: 3, seed: 11 });
const providerOf = (v: ReturnType<typeof mockVendor>) => boxingDataApiProvider({ key: "k".repeat(40), purpose: "evaluation", fetchImpl: v.fetchImpl, scheduleDays: 0, maxRequests: 1e6, retries: 0, gapMs: 0, log: () => {}, sleep: async () => {} });

test("the adapter reads all 17 pages: 68 lists for 17 requests, and says nothing was approximated", async () => {
  const v = mockVendor(league);
  const p = providerOf(v);
  const lists = await p.fetchOfficialRankings!();
  assert.equal(lists.length, 68);
  assert.equal(v.stats.byPath["/v2/rankings/"], 17);
  assert.equal(new Set(lists.map((l) => l.body)).size, 4);
  assert.equal(new Set(lists.map((l) => l.division)).size, 17);
  assert.equal(p.notes().rankingsSkipped, 0);
  assert.equal(p.notes().rankingsUnavailable, 0);
});

test("a plan without rankings has none, and the load goes on; any other failure is still a failure", async () => {
  const refused = providerOf(mockVendor(league, { rankings: "refused" }));
  assert.deepEqual(await refused.fetchOfficialRankings!(), []);
  assert.equal(refused.notes().rankingsUnavailable, 1);
  const broken = boxingDataApiProvider({ key: "k".repeat(40), purpose: "evaluation", fetchImpl: async () => new Response("boom", { status: 500 }), scheduleDays: 0, maxRequests: 1e6, retries: 0, gapMs: 0, log: () => {}, sleep: async () => {} });
  await assert.rejects(() => broken.fetchOfficialRankings!(), /500|boom|Boxing Data API/);
});

test("end to end: the lists are stored, linked to the fighters we hold, kept by name when we do not, and a later load replaces them whole", async () => {
  const { getDb } = await import("../lib/db");
  const { ingest } = await import("../lib/ingest");
  const db = await getDb();
  await ingest(db, providerOf(mockVendor(league)), { strict: false });
  const rows = db.prepare("SELECT * FROM official_rankings").all() as { body: string; division: string; kind: string; rank: number | null; boxer_id: number | null; name: string | null; vacant: number; title_type: string | null }[];
  assert.ok(rows.length > 68, "champions and contenders of every list");
  assert.equal(rows.filter((r) => r.kind === "champion").length, 68, "one belt a list");
  assert.ok(rows.filter((r) => r.kind === "champion" && r.boxer_id !== null).length > 0, "champions we hold are linked");
  const unlisted = rows.filter((r) => r.name?.startsWith("Unlisted Fighter"));
  assert.equal(unlisted.length, 68, "a fighter nobody here holds is kept by name");
  assert.ok(unlisted.every((r) => r.boxer_id === null));
  assert.ok(rows.some((r) => r.vacant === 1 && r.name === null && r.boxer_id === null), "a vacant place has neither a name nor a fighter");
  assert.ok(rows.filter((r) => r.boxer_id !== null).every((r) => db.prepare("SELECT 1 FROM boxers WHERE id = ?").get(r.boxer_id)), "every link is to a fighter that exists");
  const before = rows.length;
  // a provider with no rankings (a plan without them) leaves the stored lists alone
  await ingest(db, providerOf(mockVendor(league, { rankings: "refused" })), { strict: false });
  assert.equal((db.prepare("SELECT COUNT(*) n FROM official_rankings").get() as { n: number }).n, before, "nothing wiped");
  // a new snapshot replaces the old one whole, it does not pile up
  await ingest(db, providerOf(mockVendor(league)), { strict: false });
  assert.equal((db.prepare("SELECT COUNT(*) n FROM official_rankings").get() as { n: number }).n, before, "replaced, not doubled");
});

test("asked twice in one run (the check, then the load) the lists cost 17 requests once, not twice", async () => {
  const v = mockVendor(league);
  const p = providerOf(v);
  const a = await p.fetchOfficialRankings!(), b = await p.fetchOfficialRankings!();
  assert.equal(a, b);
  assert.equal(v.stats.byPath["/v2/rankings/"], 17);
});

test("a feed file carries the lists too (that is how the smoke run's partial league gets them)", async () => {
  const fs = await import("node:fs"), os = await import("node:os"), path = await import("node:path");
  const { fileProvider } = await import("../lib/providers/file");
  const { loadFeed } = await import("../lib/feed");
  const lists = await providerOf(mockVendor(league)).fetchOfficialRankings!();
  const file = path.join(os.tmpdir(), `ringside-rankings-feed-${process.pid}.json`);
  fs.writeFileSync(file, JSON.stringify({ officialRankings: lists }));
  try { assert.equal((await loadFeed(fileProvider(file))).officialRankings.length, 68); } finally { fs.rmSync(file, { force: true }); }
  fs.writeFileSync(file, JSON.stringify({}));
  try { assert.deepEqual((await loadFeed(fileProvider(file))).officialRankings, [], "a file without them has none"); } finally { fs.rmSync(file, { force: true }); }
});
