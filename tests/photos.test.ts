import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { tempDb } from "./helpers";
import { cleanPhoto } from "../lib/photos/rules";

const cleanup = tempDb("photos");
const accFile = path.join(os.tmpdir(), `ringside-test-photos-accounts-${process.pid}.db`);
process.env.ACCOUNTS_DB_PATH = accFile;
const wipe = () => { for (const e of ["", "-wal", "-shm"]) fs.rmSync(accFile + e, { force: true }); };
wipe();
after(async () => { (await import("../lib/accounts/store")).closeAccountsDb(); wipe(); cleanup(); });

const good = { slug: "some-fighter", imageUrl: "https://press.example.org/img/fighter.jpg?w=800", licence: "By permission", credit: "A. Photographer / Example Promotions", sourceUrl: "https://press.example.org/press-kit", evidence: "Email from the press office, 2026-10-12, agreeing to use on Ringside" };

test("a picture is accepted only with its right to be shown: an https picture address, a licence, a credit, a source, and for a permission the evidence of it", () => {
  const ok = cleanPhoto(good); assert.ok(ok.ok);
  if (ok.ok) assert.deepEqual([ok.photo.slug, ok.photo.licence, ok.photo.licenceUrl, ok.photo.imageUrl], ["some-fighter", "By permission", null, "https://press.example.org/img/fighter.jpg?w=800"]);
  const cc = cleanPhoto({ ...good, licence: "CC BY-SA", evidence: "", imageUrl: "https://upload.example.org/a.png" }); assert.ok(cc.ok); if (cc.ok) assert.match(cc.photo.licenceUrl!, /creativecommons\.org\/licenses\/by-sa/);
  const err = (over: Record<string, unknown>) => { const r = cleanPhoto({ ...good, ...over }); return r.ok ? "ok" : r.error; };
  assert.equal(err({ slug: "../x" }), "bad_slug"); assert.equal(err({ slug: "" }), "bad_slug"); assert.equal(err({ slug: "Has Space" }), "bad_slug");
  for (const bad of ["http://press.example.org/a.jpg", "javascript:alert(1)", "https://u:p@press.example.org/a.jpg", "https://press.example.org:8443/a.jpg", "https://press.example.org/a.gif", "https://press.example.org/a.jpg.exe", "https://localhost/a.jpg", "", "not a url"]) assert.equal(err({ imageUrl: bad }), "bad_image", bad);
  assert.equal(err({ licence: "All rights reserved" }), "bad_licence"); assert.equal(err({ licence: "" }), "bad_licence");
  assert.equal(err({ credit: "  " }), "no_credit"); assert.equal(err({ credit: "ab" }), "no_credit");
  assert.equal(err({ sourceUrl: "ftp://x.example/a" }), "bad_source");
  assert.equal(err({ evidence: "" }), "no_evidence"); assert.equal(err({ evidence: "yes" }), "no_evidence", "a permission needs something to point to");
  assert.equal(err({ licence: "CC0", evidence: "" }), "ok", "a free licence needs no evidence of permission");
  const messy = cleanPhoto({ ...good, credit: "  Name‮  with\nbreaks  " }); assert.ok(messy.ok); if (messy.ok) assert.equal(messy.photo.credit, "Name with breaks");
});

let editor: import("../lib/accounts/users").User, plain: import("../lib/accounts/users").User;
before(async () => {
  const users = await import("../lib/accounts/users"), store = await import("../lib/accounts/store"), acc = store.accountsDb();
  const a = await users.createUser("ph_editor", "a-long-passphrase-for-tests-1", acc), b = await users.createUser("ph_plain", "a-long-passphrase-for-tests-1", acc);
  if ("error" in a || "error" in b) throw new Error("setup");
  users.setRole("ph_editor", "editor", acc); editor = { ...a.user, role: "editor" }; plain = b.user;
});

const mainDb = () => { const d = new DatabaseSync(":memory:"); d.exec("CREATE TABLE boxers (id INTEGER PRIMARY KEY, slug TEXT UNIQUE, photo_url TEXT, photo_credit TEXT)"); return d; };

test("only an editor records or removes a picture; recording again replaces; every change is logged", async () => {
  const S = await import("../lib/photos/store");
  assert.deepEqual(S.savePhoto(plain, good), { ok: false, error: "forbidden" }); assert.deepEqual(S.removePhoto(plain, 1), { ok: false, error: "forbidden" });
  assert.deepEqual(S.savePhoto(editor, { ...good, licence: "nope" }), { ok: false, error: "bad_licence" });
  const a = S.savePhoto(editor, good); assert.ok(a.ok);
  const b = S.savePhoto(editor, { ...good, credit: "B. Other / Example" }); assert.ok(b.ok);
  assert.equal(S.listPhotos().length, 1, "one picture per fighter"); assert.equal(S.listPhotos()[0].credit, "B. Other / Example");
  if (b.ok) { const r = S.removePhoto(editor, b.image.id); assert.deepEqual(r, { ok: true, slug: "some-fighter" }); }
  assert.deepEqual(S.removePhoto(editor, 99999), { ok: false, error: "not_found" }); assert.equal(S.listPhotos().length, 0);
  const acc = (await import("../lib/accounts/store")).accountsDb();
  assert.ok((acc.prepare("SELECT COUNT(*) c FROM audit WHERE action IN ('photo_save','photo_remove')").get() as { c: number }).c >= 3);
});

test("applying: a fighter with no photo, or a Commons or earlier recorded one, takes the record; a photo that came with the supplier's feed never does; an unknown fighter is reported; removing clears only a recorded one", async () => {
  const S = await import("../lib/photos/store");
  const m = mainDb(), ins = m.prepare("INSERT INTO boxers (slug, photo_url, photo_credit) VALUES (?,?,?)");
  ins.run("none", null, null); ins.run("commons", "https://upload.wikimedia.org/x.jpg", JSON.stringify({ source: "Wikimedia Commons", text: "x" })); ins.run("feed", "https://feed.example/p.jpg", null); ins.run("feed-credited", "https://feed.example/q.jpg", JSON.stringify({ source: "The supplier", text: "y" }));
  const rec = (slug: string) => S.savePhoto(editor, { ...good, slug }) as { ok: true; image: import("../lib/photos/store").LicensedImage };
  const imgs = ["none", "commons", "feed", "feed-credited", "ghost"].map((s) => rec(s).image);
  const r = S.applyPhotos(imgs, m);
  assert.deepEqual([r.applied, r.kept.sort(), r.unknown], [2, ["feed", "feed-credited"], ["ghost"]]);
  const row = (slug: string) => m.prepare("SELECT photo_url u, photo_credit c FROM boxers WHERE slug = ?").get(slug) as { u: string; c: string | null };
  assert.equal(row("none").u, "https://press.example.org/img/fighter.jpg?w=800"); assert.deepEqual(JSON.parse(row("none").c!), { text: "A. Photographer / Example Promotions, By permission", license: "By permission", licenseUrl: null, pageUrl: "https://press.example.org/press-kit", source: "Recorded by the editors" });
  assert.equal(row("feed").u, "https://feed.example/p.jpg"); assert.equal(row("feed-credited").u, "https://feed.example/q.jpg");
  assert.equal(S.applyPhotos(imgs, m).applied, 2, "applying again is the same, and an earlier recorded picture may be replaced by a newer one");
  assert.equal(S.clearPhoto("none", m), true); assert.equal(row("none").u, null);
  assert.equal(S.clearPhoto("feed", m), false); assert.equal(row("feed").u, "https://feed.example/p.jpg", "a photo that is not a recorded one is not touched");
});

test("the web endpoints: editors only, same-origin only, noindex; a saved picture reaches the fighter at once", async () => {
  const users = await import("../lib/accounts/users"), acc = (await import("../lib/accounts/store")).accountsDb(), { getDb } = await import("../lib/db");
  const cookie = (name: string) => `rs_session=${encodeURIComponent(users.createSession((acc.prepare("SELECT id FROM users WHERE username = ?").get(name) as { id: number }).id, acc).token)}`;
  const ed = cookie("ph_editor"), pl = cookie("ph_plain"), ORIGIN = "http://localhost:3000";
  const req = (url: string, init: { method?: string; cookie?: string; body?: unknown; origin?: string } = {}) => new Request(`${ORIGIN}${url}`, { method: init.method ?? "GET", headers: { ...(init.cookie ? { cookie: init.cookie } : {}), ...(init.body !== undefined ? { "content-type": "application/json" } : {}), origin: init.origin ?? ORIGIN, host: "localhost:3000" }, ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}) });
  const { GET, POST } = await import("../app/api/photos/route"), { POST: REMOVE } = await import("../app/api/photos/[id]/remove/route");
  const out = async (r: Response) => ({ status: r.status, robots: r.headers.get("x-robots-tag"), body: await r.json() as Record<string, unknown> });
  assert.equal((await out(await GET(req("/api/photos")))).status, 401); assert.equal((await out(await GET(req("/api/photos", { cookie: pl })))).status, 403);
  const main = await getDb(), slug = (main.prepare("SELECT slug FROM boxers WHERE photo_url IS NULL ORDER BY id LIMIT 1").get() as { slug: string } | undefined)?.slug ?? (main.prepare("SELECT slug FROM boxers ORDER BY id LIMIT 1").get() as { slug: string }).slug;
  main.prepare("UPDATE boxers SET photo_url = NULL, photo_credit = NULL WHERE slug = ?").run(slug);
  const body = { ...good, slug };
  assert.equal((await out(await POST(req("/api/photos", { method: "POST", body })))).status, 401); assert.equal((await out(await POST(req("/api/photos", { method: "POST", cookie: pl, body })))).status, 403);
  assert.equal((await out(await POST(req("/api/photos", { method: "POST", cookie: ed, body, origin: "https://evil.example" })))).status, 403, "a form on another site does nothing");
  assert.deepEqual([(await out(await POST(req("/api/photos", { method: "POST", cookie: ed, body: { ...body, evidence: "" } })))).body.error], ["no_evidence"]);
  const done = await out(await POST(req("/api/photos", { method: "POST", cookie: ed, body }))); assert.equal(done.status, 200); assert.equal(done.body.applied, 1); assert.match(String(done.robots), /noindex/);
  assert.equal((main.prepare("SELECT photo_url u FROM boxers WHERE slug = ?").get(slug) as { u: string }).u, good.imageUrl);
  const id = (done.body.image as { id: number }).id;
  assert.equal((await out(await REMOVE(req(`/api/photos/${id}/remove`, { method: "POST", cookie: pl, body: {} }), { params: Promise.resolve({ id: String(id) }) }))).status, 403);
  assert.equal((await out(await REMOVE(req(`/api/photos/${id}/remove`, { method: "POST", cookie: ed, body: {} }), { params: Promise.resolve({ id: String(id) }) }))).status, 200);
  assert.equal((main.prepare("SELECT photo_url u FROM boxers WHERE slug = ?").get(slug) as { u: string | null }).u, null, "removing the record takes the picture off the fighter");
});
