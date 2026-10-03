import test, { afterEach, before } from "node:test";
import assert from "node:assert/strict";

process.env.WIKIMEDIA_CONTACT = "tests@invalid.example"; // identifies the bot; no real request is ever made (fetch is mocked)
process.env.WIKIMEDIA_GAP_MS = "0";
let wm: typeof import("../lib/media/wikimedia");
before(async () => { wm = await import("../lib/media/wikimedia"); });

interface Ent { id: string; boxer?: boolean; born?: number; image?: string }
let ENTS: Ent[] = [];
let FILES: Record<string, Record<string, unknown>> = {};
const realFetch = globalThis.fetch;
const claim = (v: unknown) => ({ rank: "normal", mainsnak: { datavalue: { value: v } } });
globalThis.fetch = (async (url: string) => {
  const u = new URL(url), q = u.searchParams, action = q.get("action");
  const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200 });
  if (u.hostname === "www.wikidata.org" && action === "wbsearchentities") return json({ search: ENTS.map((e) => ({ id: e.id })) });
  if (u.hostname === "www.wikidata.org" && action === "wbgetentities") {
    const ids = q.get("ids")!.split("|");
    return json({ entities: Object.fromEntries(ENTS.filter((e) => ids.includes(e.id)).map((e) => [e.id, { id: e.id, claims: {
      P106: [claim({ id: e.boxer === false ? "Q33999" : "Q11338576" })],
      ...(e.born ? { P569: [claim({ time: `+${e.born}-05-04T00:00:00Z` })] } : {}),
      ...(e.image ? { P18: [claim(e.image)] } : {}),
    } }])) });
  }
  if (u.hostname === "commons.wikimedia.org") {
    const f = FILES[q.get("titles")!.replace("File:", "")];
    return json({ query: { pages: [f ? { imageinfo: [f] } : { missing: true }] } });
  }
  return new Response("{}", { status: 404 });
}) as typeof fetch;
afterEach(() => { ENTS = []; FILES = {}; });
test.after(() => { globalThis.fetch = realFetch; });

const img = (license: string, extra: Record<string, unknown> = {}) => ({
  url: "https://upload/x.jpg", thumburl: "https://upload/thumb.jpg", width: 800, mime: "image/jpeg", descriptionurl: "https://commons/File:x",
  extmetadata: { LicenseShortName: { value: license }, Artist: { value: '<a href="//x">Jane <b>Photographer</b></a>' }, LicenseUrl: { value: "https://cc" }, ...extra },
});
const S = { name: "Some Boxer", birthYear: 1990 };
const setup = (ents: Ent[], files: typeof FILES) => { ENTS = ents; FILES = files; };

test("accepts a verified boxer with a freely licensed photo, and credits the author", async () => {
  setup([{ id: "Q1", born: 1990, image: "A.jpg" }], { "A.jpg": img("CC BY-SA 4.0") });
  const r = await wm.findHeadshot(S);
  assert.equal(r.status, "matched");
  if (r.status === "matched") { assert.equal(r.match.credit, "Jane Photographer, CC BY-SA 4.0"); assert.match(r.match.thumbUrl, /thumb/); }
});

test("public domain and CC0 are accepted", async () => {
  for (const lic of ["Public domain", "CC0 1.0"]) {
    setup([{ id: "Q1", born: 1990, image: "A.jpg" }], { "A.jpg": img(lic) });
    assert.equal((await wm.findHeadshot(S)).status, "matched", lic);
  }
});

test("identity must be verified: birth year, occupation, uniqueness", async () => {
  const reason = async (ents: Ent[], files: typeof FILES) => { setup(ents, files); const r = await wm.findHeadshot(S); assert.equal(r.status, "no_match"); return r.status === "no_match" ? r.reason : ""; };
  assert.match(await reason([{ id: "Q1", born: 1985, image: "A.jpg" }], { "A.jpg": img("CC BY 4.0") }), /birth year/);
  assert.match(await reason([{ id: "Q2", boxer: false, born: 1990, image: "A.jpg" }], { "A.jpg": img("CC BY 4.0") }), /no boxer/);
  assert.match(await reason([{ id: "Q1", image: "A.jpg" }], { "A.jpg": img("CC BY 4.0") }), /birth year/, "no birth date on Wikidata: cannot verify");
  assert.match(await reason([{ id: "Q1", born: 1990, image: "A.jpg" }, { id: "Q3", born: 1990, image: "B.jpg" }], { "A.jpg": img("CC BY 4.0"), "B.jpg": img("CC BY 4.0") }), /ambiguous/);
  assert.match(await reason([], {}), /no Wikidata/);
});

test("picks the right boxer among namesakes", async () => {
  setup([{ id: "Q1", born: 1971, image: "A.jpg" }, { id: "Q3", born: 1990, image: "B.jpg" }], { "A.jpg": img("CC BY 4.0"), "B.jpg": img("CC0 1.0") });
  const r = await wm.findHeadshot(S);
  assert.ok(r.status === "matched" && r.match.fileTitle === "B.jpg");
});

test("unusable images are rejected with a reason", async () => {
  const reject = async (file: Record<string, unknown>, want: RegExp) => {
    setup([{ id: "Q1", born: 1990, image: "A.jpg" }], { "A.jpg": file });
    const r = await wm.findHeadshot(S);
    assert.ok(r.status === "no_match" && want.test(r.reason), r.status === "no_match" ? r.reason : "matched");
  };
  await reject(img("CC BY-NC 4.0"), /licence/);
  await reject(img("CC BY-ND 2.0"), /licence/);
  await reject(img("CC BY 4.0", { NonFree: { value: "true" } }), /non-free/);
  await reject({ ...img("CC BY 4.0"), width: 120 }, /small/);
  await reject({ ...img("CC0"), mime: "image/svg+xml" }, /unsupported/);
  await reject(img(""), /licence/);
  setup([{ id: "Q1", born: 1990 }], {});
  const none = await wm.findHeadshot(S);
  assert.ok(none.status === "no_match" && /no image/.test(none.reason));
});

test("licence rule table", () => {
  const ok = ["CC BY-SA 4.0", "CC BY 2.0", "CC BY-SA 3.0 DE", "CC0", "CC0 1.0", "Public domain", "PD-USGov", "cc-by-sa-4.0"];
  const no = ["CC BY-NC 4.0", "CC BY-NC-SA 3.0", "CC BY-ND 2.0", "Fair use", "GFDL", "Attribution", "", "All rights reserved", "CC BY-SA 4.0 (non-commercial)"];
  for (const l of ok) assert.ok(wm.licenceAccepted(l), `should accept ${l}`);
  for (const l of no) assert.ok(!wm.licenceAccepted(l), `should reject "${l}"`);
});

test("a fighter already linked to Wikidata skips the search", async () => {
  setup([{ id: "Q7", born: 1990, image: "A.jpg" }], { "A.jpg": img("CC BY 4.0") });
  const r = await wm.headshotByEntity("Q7");
  assert.equal(r.status, "matched");
  assert.equal((await wm.headshotByEntity("Q404")).status, "no_match");
});

test("refuses to run without a contact address", async () => {
  const saved = process.env.WIKIMEDIA_CONTACT;
  delete process.env.WIKIMEDIA_CONTACT;
  await assert.rejects(wm.findHeadshot(S), /WIKIMEDIA_CONTACT/);
  process.env.WIKIMEDIA_CONTACT = saved;
});
