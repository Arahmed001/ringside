import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { tempDb } from "./helpers";
import type { DatabaseSync } from "node:sqlite";

process.env.WIKIMEDIA_CONTACT = "tests@invalid.example";
process.env.WIKIMEDIA_GAP_MS = "0";
const cleanup = tempDb("resolve");
after(cleanup);

const claim = (v: unknown) => ({ rank: "normal", mainsnak: { datavalue: { value: v } } });
let searches = 0;
const realFetch = globalThis.fetch;
// every search yields one candidate; odd ones have no image, even ones do, and all share a birth year we set below
globalThis.fetch = (async (url: string) => {
  const q = new URL(url).searchParams, json = (o: unknown) => new Response(JSON.stringify(o));
  if (q.get("action") === "wbsearchentities") { searches++; return json({ search: [{ id: "Q" + searches }] }); }
  if (q.get("action") === "wbgetentities") {
    const id = q.get("ids")!, n = Number(id.slice(1));
    return json({ entities: { [id]: { id, claims: { P106: [claim({ id: "Q11338576" })], P569: [claim({ time: "+1990-01-01T00:00:00Z" })], ...(n % 2 === 0 ? { P18: [claim(`F${n}.jpg`)] } : {}) } } } });
  }
  const name = q.get("titles")!.replace("File:", "");
  return json({ query: { pages: [{ imageinfo: [{ url: "https://u/x.jpg", thumburl: `https://upload.example/thumb/${name}`, width: 900, mime: "image/jpeg", descriptionurl: `https://commons.example/File:${name}`, extmetadata: { LicenseShortName: { value: "CC BY-SA 4.0" }, Artist: { value: "A. Photographer" }, LicenseUrl: { value: "https://cc" } } }] }] } });
}) as typeof fetch;
after(() => { globalThis.fetch = realFetch; });

let db: DatabaseSync;
let resolve: typeof import("../lib/media/resolve");
let ingest: typeof import("../lib/ingest");
const count = (sql: string) => (db.prepare(sql).get() as { c: number }).c;

before(async () => {
  db = await (await import("../lib/db")).getDb();
  resolve = await import("../lib/media/resolve"); ingest = await import("../lib/ingest");
  db.exec("UPDATE boxers SET birth_year = 1990"); // lets the mocked entities pass the birth-year check
});

test("matches are saved with their credit; misses are recorded and not retried", async () => {
  const s = await resolve.resolveMissingMedia(db, { limit: 6 });
  assert.deepEqual({ ...s }, { checked: 6, matched: 3, noMatch: 3, errors: 0 });
  assert.equal(count("SELECT COUNT(*) c FROM boxers WHERE photo_url IS NOT NULL"), 3);
  const row = db.prepare("SELECT photo_credit FROM boxers WHERE photo_credit IS NOT NULL LIMIT 1").get() as { photo_credit: string };
  const credit = JSON.parse(row.photo_credit);
  assert.equal(credit.text, "A. Photographer, CC BY-SA 4.0"); assert.equal(credit.source, "Wikimedia Commons"); assert.match(credit.pageUrl, /^https:\/\/commons/);
  const again = await resolve.resolveMissingMedia(db, { limit: 6 });
  assert.equal(again.checked, 6, "the next batch, not the same six");
  assert.equal(count("SELECT COUNT(*) c FROM boxer_media"), 12);
});

test("a re-ingest keeps resolved photos", async () => {
  const before = count("SELECT COUNT(*) c FROM boxers WHERE photo_url IS NOT NULL");
  assert.ok(before > 0);
  const { demoProvider } = await import("../lib/providers/demo");
  await ingest.ingest(db, demoProvider(new Date("2026-10-03")));
  assert.equal(count("SELECT COUNT(*) c FROM boxers WHERE photo_url IS NOT NULL"), before);
});

test("the world exposes the credit", async () => {
  const { getWorld } = await import("../lib/world");
  const w = await getWorld();
  const credited = w.boxers.find((b) => b.photoCredit);
  assert.ok(credited && credited.photoCredit!.license === "CC BY-SA 4.0");
});
