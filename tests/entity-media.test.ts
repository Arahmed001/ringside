import test, { after, afterEach, before } from "node:test";
import assert from "node:assert/strict";
import { tempDb } from "./helpers";
import type { DatabaseSync } from "node:sqlite";

process.env.WIKIMEDIA_CONTACT = "tests@invalid.example"; // identifies the bot; no real request is ever made (fetch is mocked)
process.env.WIKIMEDIA_GAP_MS = "0";
process.env.RINGSIDE_NO_SEED = "1";
const cleanup = tempDb("entity-media");
after(cleanup);

/**
 * Pictures of organisations, belts and venues. The fixtures are what Wikidata and Commons really answered on 2026-10-03: the four sanctioning bodies each
 * have a belt photo under CC BY-SA; the promotions (Top Rank, Golden Boy, MVP, Zuffa) have no logo at all, and "Top Rank" alone is also a record label.
 */
let E: typeof import("../lib/media/entities");
let W: typeof import("../lib/media/wikimedia");
let db: DatabaseSync;
before(async () => { E = await import("../lib/media/entities"); W = await import("../lib/media/wikimedia"); db = await (await import("../lib/db")).getDb(); });

interface Ent { id: string; label: string; aliases?: string[]; description?: string; sport?: string; logo?: string; image?: string }
let ENTS: Ent[] = [];
let FILES: Record<string, Record<string, unknown>> = {};
let calls = { search: 0, commons: 0 };
const realFetch = globalThis.fetch;
const claim = (v: unknown) => ({ rank: "normal", mainsnak: { datavalue: { value: v } } });
globalThis.fetch = (async (url: string) => {
  const u = new URL(url), q = u.searchParams, action = q.get("action");
  const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200 });
  if (u.hostname === "www.wikidata.org" && action === "wbsearchentities") {
    calls.search++;
    const s = q.get("search")!.toLowerCase();
    return json({ search: ENTS.filter((e) => [e.label, ...(e.aliases ?? [])].some((n) => n.toLowerCase().includes(s.split(" ")[0]))).map((e) => ({ id: e.id })) });
  }
  if (u.hostname === "www.wikidata.org" && action === "wbgetentities") {
    const want = q.get("ids")!.split("|");
    return json({ entities: Object.fromEntries(ENTS.filter((e) => want.includes(e.id)).map((e) => [e.id, {
      id: e.id, labels: { en: { value: e.label } }, aliases: { en: (e.aliases ?? []).map((value) => ({ value })) }, descriptions: { en: { value: e.description ?? "" } },
      claims: { ...(e.sport ? { P641: [claim({ id: e.sport })] } : {}), ...(e.logo ? { P154: [claim(e.logo)] } : {}), ...(e.image ? { P18: [claim(e.image)] } : {}) },
    }])) });
  }
  if (u.hostname === "commons.wikimedia.org") {
    calls.commons++;
    const f = FILES[q.get("titles")!.replace("File:", "")];
    return json({ query: { pages: [f ? { imageinfo: [f] } : { missing: true }] } });
  }
  return new Response("{}", { status: 404 });
}) as typeof fetch;
afterEach(() => { ENTS = []; FILES = {}; calls = { search: 0, commons: 0 }; db.exec("DELETE FROM entity_media; DELETE FROM orgs; DELETE FROM venues;"); });
test.after(() => { globalThis.fetch = realFetch; });

const file = (license: string, extra: Record<string, unknown> = {}, meta: Record<string, unknown> = {}) => ({
  url: "https://upload/x.jpg", thumburl: "https://upload/thumb.jpg", width: 842, mime: "image/jpeg", descriptionurl: "https://commons/File:x",
  extmetadata: { LicenseShortName: { value: license }, Artist: { value: '<a href="//x">Johnny <b>Najjar</b></a>' }, LicenseUrl: { value: "https://cc" }, ...meta }, ...extra,
});
const BELTS: Ent[] = [
  { id: "Q725676", label: "World Boxing Association", image: "WBA CHAMPIONSHIP BELT.jpg" },
  { id: "Q724450", label: "World Boxing Council", image: "WBC I OMB 2014-01-17 17-19.jpg" },
  { id: "Q742944", label: "International Boxing Federation", image: "IBFworldbelt.jpg" },
  { id: "Q830940", label: "World Boxing Organization", image: "WBOBelt.jpg" },
];
const BELT_FILES = { "WBA CHAMPIONSHIP BELT.jpg": file("CC BY-SA 3.0"), "WBC I OMB 2014-01-17 17-19.jpg": file("CC BY-SA 3.0"), "IBFworldbelt.jpg": file("CC BY-SA 3.0"), "WBOBelt.jpg": file("CC BY-SA 2.0") };

test("a belt photo is taken for each of the four bodies, with the author and licence on the credit", async () => {
  ENTS = BELTS; FILES = BELT_FILES;
  const r = await E.beltByBody("WBA");
  assert.equal(r.status, "matched");
  if (r.status === "matched") { assert.equal(r.match.credit, "Johnny Najjar, CC BY-SA 3.0"); assert.equal(r.match.wikidataId, "Q725676"); assert.match(r.match.thumbUrl, /thumb/); }
  assert.equal((await E.beltByBody("WBO")).status, "matched");
});

test("a belt is refused when the item is no longer labelled as the body (merged, renamed, vandalised), when the licence is not free, and for any other code", async () => {
  ENTS = [{ ...BELTS[0], label: "Some Other Thing" }]; FILES = BELT_FILES;
  assert.deepEqual(await E.beltByBody("WBA"), { status: "no_match", reason: "the Wikidata item is no longer labelled as this body" });
  ENTS = BELTS; FILES = { ...BELT_FILES, "WBA CHAMPIONSHIP BELT.jpg": file("CC BY-NC 3.0") };
  const nc = await E.beltByBody("WBA");
  assert.ok(nc.status === "no_match" && /licence not accepted: CC BY-NC 3.0/.test(nc.reason));
  FILES = { ...BELT_FILES, "WBA CHAMPIONSHIP BELT.jpg": file("CC BY-SA 3.0", {}, { NonFree: { value: "true" } }) };
  assert.ok((await E.beltByBody("WBA")).status === "no_match", "marked non-free on Commons");
  assert.deepEqual(await E.beltByBody("EBU"), { status: "no_match", reason: "not one of the four bodies" });
});

test("an organisation is linked only when its name is exact, it is about boxing, and it is the only one: a record label with the same name is not Top Rank", async () => {
  ENTS = [{ id: "Q2146373", label: "Top Rank", description: "British record label; imprint of Rank Records Ltd." }];
  assert.deepEqual(await E.findOrgQid("Top Rank"), { status: "no_match", reason: "the items with this name are not about boxing" });
  ENTS = [...ENTS, { id: "Q7824594", label: "Top Rank", description: "American boxing promotional company" }];
  assert.deepEqual(await E.findOrgQid("Top Rank"), { status: "linked", qid: "Q7824594" }, "the boxing one of the two");
  ENTS = [{ id: "Q1", label: "Golden Boy Promotions", aliases: ["GBP"], sport: "Q32112" }];
  assert.deepEqual(await E.findOrgQid("golden boy  promotions"), { status: "linked", qid: "Q1" }, "case and spacing do not matter; the sport property is enough");
  assert.deepEqual(await E.findOrgQid("GBP"), { status: "linked", qid: "Q1" }, "an alias is a name");
  ENTS = [{ id: "Q1", label: "Matchroom Boxing Ltd", description: "boxing promoter" }];
  assert.equal((await E.findOrgQid("Matchroom Boxing")).status, "no_match", "a near miss is not a match");
  ENTS = [{ id: "Q1", label: "Zuffa Boxing", description: "boxing promotion" }, { id: "Q2", label: "Zuffa Boxing", description: "American boxing promotional company" }];
  const two = await E.findOrgQid("Zuffa Boxing");
  assert.ok(two.status === "no_match" && /ambiguous/.test(two.reason));
  ENTS = [];
  assert.deepEqual(await E.findOrgQid("Nobody Promotions"), { status: "no_match", reason: "no Wikidata item with that name" });
});

test("a logo is the item's logo image: SVG is accepted (logos are SVG), a photo field is not used, a trademark note stays on the credit, a non-free file is refused", async () => {
  ENTS = [{ id: "Q9", label: "Some Promotions", logo: "Some_logo.svg", image: "Building.jpg" }];
  FILES = { "Some_logo.svg": file("Public domain", { mime: "image/svg+xml", width: 100, descriptionurl: "https://commons/File:Some_logo.svg" }, { Restrictions: { value: "trademarked" } }), "Building.jpg": file("CC BY 4.0") };
  const r = await E.logoByEntity("Q9");
  assert.ok(r.status === "matched" && r.match.fileTitle === "Some_logo.svg");
  if (r.status === "matched") assert.equal(r.match.credit, "Johnny Najjar, Public domain (trademark of its owner)");
  FILES = { "Some_logo.svg": file("Public domain", { mime: "image/svg+xml" }, { NonFree: { value: "true" } }) };
  assert.ok((await E.logoByEntity("Q9")).status === "no_match");
  ENTS = [{ id: "Q9", label: "Some Promotions", image: "Building.jpg" }]; FILES = { "Building.jpg": file("CC BY 4.0") };
  assert.deepEqual(await E.logoByEntity("Q9"), { status: "no_match", reason: "no logo on Wikidata" }, "the building photo is not the logo");
  // headshots and venue photos are still raster only
  ENTS = [{ id: "Q9", label: "A", image: "x.svg" }]; FILES = { "x.svg": file("CC BY 4.0", { mime: "image/svg+xml" }) };
  assert.ok((await W.headshotByEntity("Q9")).status === "no_match", "a photo that is an SVG is refused");
});

const addOrg = (name: string, kind = "promotion") => Number(db.prepare("INSERT INTO orgs (external_id, slug, name, kind) VALUES (?,?,?,?)").run(`o-${name}`, name.toLowerCase().replace(/\W+/g, "-"), name, kind).lastInsertRowid);
const rows = () => db.prepare("SELECT kind, ref, status, reason FROM entity_media ORDER BY kind, ref").all() as { kind: string; ref: string; status: string; reason: string | null }[];

test("the worker records an answer for every kind: matched belts and venue photos, an organisation linked to Wikidata, and a logo that does not exist as no_match with the reason", async () => {
  ENTS = [...BELTS, { id: "Q7824594", label: "Top Rank", description: "American boxing promotional company" }, { id: "Q55", label: "T-Mobile Arena", image: "T-Mobile.jpg" }, { id: "Q56", label: "Barclays Center", image: "Barclays.jpg" }];
  FILES = { ...BELT_FILES, "T-Mobile.jpg": file("CC BY-SA 4.0"), "Barclays.jpg": file("All rights reserved") };
  const topRank = addOrg("Top Rank");
  db.prepare("INSERT INTO venues (name, city, country, status, wikidata_id) VALUES (?,?,?,?,?)").run("T-Mobile Arena", "Las Vegas", "US", "matched", "Q55");
  db.prepare("INSERT INTO venues (name, city, country, status, wikidata_id) VALUES (?,?,?,?,?)").run("Barclays Center", "New York", "US", "matched", "Q56");
  db.prepare("INSERT INTO venues (name, city, country, status, wikidata_id) VALUES (?,?,?,?,?)").run("Unknown Hall", "Nowhere", "US", "no_match", null);
  const s = await E.resolveEntityMedia(db);
  assert.deepEqual(s, { checked: 7, matched: 5, noMatch: 2, errors: 0 }, "four belts, one organisation, two venues");
  const got = rows();
  assert.deepEqual(got.filter((r) => r.kind === "belt").map((r) => [r.ref, r.status]), [["IBF", "matched"], ["WBA", "matched"], ["WBC", "matched"], ["WBO", "matched"]]);
  assert.deepEqual({ ...got.find((r) => r.kind === "org_logo") }, { kind: "org_logo", ref: String(topRank), status: "no_match", reason: "no logo on Wikidata" });
  assert.equal((db.prepare("SELECT wikidata_id w FROM orgs WHERE id = ?").get(topRank) as { w: string }).w, "Q7824594", "the link is kept, so the next run does not search again");
  assert.deepEqual(got.filter((r) => r.kind === "venue").map((r) => [r.ref, r.status, r.reason]), [["Barclays Center|New York", "no_match", "licence not accepted: All rights reserved"], ["T-Mobile Arena|Las Vegas", "matched", null]]);
  assert.ok(!got.some((r) => r.ref.startsWith("Unknown Hall")), "a venue not matched to Wikidata is not looked up");
});

test("nothing is asked twice: a second run makes no request, and a no_match is looked at again only after 45 days", async () => {
  ENTS = BELTS; FILES = BELT_FILES;
  await E.resolveEntityMedia(db, { kinds: ["belt"] });
  calls = { search: 0, commons: 0 };
  const again = await E.resolveEntityMedia(db, { kinds: ["belt"] });
  assert.deepEqual(again, { checked: 0, matched: 0, noMatch: 0, errors: 0 });
  assert.deepEqual(calls, { search: 0, commons: 0 });
  FILES = { ...BELT_FILES, "WBOBelt.jpg": file("CC BY-NC 2.0") };
  db.prepare("UPDATE entity_media SET status = 'no_match', thumb_url = NULL, checked_at = ? WHERE ref = 'WBO'").run(new Date(Date.now() - 10 * 86400000).toISOString());
  assert.equal((await E.resolveEntityMedia(db, { kinds: ["belt"] })).checked, 0, "10 days: too soon");
  db.prepare("UPDATE entity_media SET checked_at = ? WHERE ref = 'WBO'").run(new Date(Date.now() - 60 * 86400000).toISOString());
  const later = await E.resolveEntityMedia(db, { kinds: ["belt"] });
  assert.deepEqual([later.checked, later.noMatch], [1, 1], "60 days: asked again, and the file is no longer free");
});

test("the limit caps each kind, and a failure on one thing does not stop the others", async () => {
  ENTS = [...BELTS, { id: "Q1", label: "Alpha Boxing", description: "boxing promoter" }];
  FILES = BELT_FILES;
  addOrg("Alpha Boxing"); addOrg("Beta Boxing"); addOrg("Gamma Boxing");
  const s = await E.resolveEntityMedia(db, { limit: 2, kinds: ["belt", "org_logo"] });
  assert.equal(s.checked, 4, "two belts and two organisations");
  assert.equal(rows().filter((r) => r.kind === "org_logo").length, 2);
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string) => (String(url).includes("wbsearchentities") ? new Response("down", { status: 503 }) : real(url))) as typeof fetch;
  try {
    db.exec("DELETE FROM entity_media");
    const s2 = await E.resolveEntityMedia(db, { kinds: ["belt", "org_logo"], limit: 10 });
    assert.equal(s2.matched, 4, "the belts do not need a search and are done");
    assert.ok(s2.errors >= 1, "the organisations failed, and were counted, not hidden");
  } finally { globalThis.fetch = real; }
});

test("the world shows only matched pictures, filed under the right thing, and the privacy list of outside hosts includes where they are served from", async () => {
  ENTS = BELTS; FILES = BELT_FILES;
  const org = addOrg("World Boxing Council", "sanctioning_body");
  db.prepare("INSERT INTO venues (name, city, country, status, wikidata_id, label) VALUES (?,?,?,?,?,?)").run("T-Mobile Arena", "Las Vegas", "US", "matched", "Q55", "T-Mobile Arena");
  await E.resolveEntityMedia(db, { kinds: ["belt"] });
  db.prepare("INSERT INTO entity_media (kind, ref, status, thumb_url, page_url, license, credit, checked_at) VALUES ('venue', 'T-Mobile Arena|Las Vegas', 'matched', 'https://upload.wikimedia.org/t.jpg', 'https://commons/t', 'CC BY 4.0', 'A, CC BY 4.0', ?)").run(new Date().toISOString());
  db.prepare("INSERT INTO entity_media (kind, ref, status, reason, checked_at) VALUES ('org_logo', ?, 'no_match', 'no logo on Wikidata', ?)").run(String(org), new Date().toISOString());
  const { getWorld } = await import("../lib/world");
  const { pictureHosts } = await import("../lib/privacy");
  const w = await getWorld();
  assert.equal(w.beltPicture("wbc")?.credit.text, "Johnny Najjar, CC BY-SA 3.0", "by code, in either case");
  assert.equal(w.beltPicture("EBU"), null);
  assert.equal(w.orgLogo(org), null, "a no_match is not a picture");
  assert.equal(w.venueOf({ venue: "T-Mobile Arena", city: "Las Vegas" })?.picture?.url, "https://upload.wikimedia.org/t.jpg");
  assert.equal(w.venueOf({ venue: "T-Mobile Arena", city: "Las Vegas" })?.picture?.credit.source, "Wikimedia Commons");
  assert.ok(pictureHosts(w).includes("upload.wikimedia.org"), "the browser is told to fetch from Commons, and the privacy page says so");
});

test("bodyCode reads the four bodies by code or full name, and nothing else", async () => {
  const { bodyCode } = await import("../lib/bodies");
  assert.deepEqual(["WBA", "wbc", " World Boxing  Organization ", "International Boxing Federation"].map(bodyCode), ["WBA", "WBC", "WBO", "IBF"]);
  assert.deepEqual(["EBU", "Top Rank", "", null, undefined, "World Boxing"].map(bodyCode), [null, null, null, null, null, null]);
});
