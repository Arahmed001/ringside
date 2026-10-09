import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { tempDb } from "./helpers";
import { cleanUpload, MAX_PHOTO_BYTES } from "../lib/photos/upload";
import { OWN_IMAGE, cleanPhoto } from "../lib/photos/rules";

const cleanup = tempDb("photo-sub");
const accFile = path.join(os.tmpdir(), `ringside-test-photosub-accounts-${process.pid}.db`);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ringside-photosub-"));
process.env.ACCOUNTS_DB_PATH = accFile;
const wipe = () => { for (const e of ["", "-wal", "-shm"]) fs.rmSync(accFile + e, { force: true }); fs.rmSync(dir, { recursive: true, force: true }); };
wipe(); fs.mkdirSync(dir, { recursive: true });
after(async () => { (await import("../lib/accounts/store")).closeAccountsDb(); wipe(); cleanup(); });

const seg = (marker: number, body: Buffer) => { const h = Buffer.alloc(4); h[0] = 0xff; h[1] = marker; h.writeUInt16BE(body.length + 2, 2); return Buffer.concat([h, body]); };
/** A JPEG skeleton (not decodable, but with the real structure): SOI, JFIF, an EXIF segment carrying a place, a comment, the frame header with its size, a scan, EOI. */
function jpeg(w = 400, h = 500, seed = 1) {
  const sof = Buffer.alloc(15); sof[0] = 8; sof.writeUInt16BE(h, 1); sof.writeUInt16BE(w, 3); sof[5] = 3;
  return Buffer.concat([Buffer.from([0xff, 0xd8]), seg(0xe0, Buffer.from("JFIF\0\x01\x01\0\0\x01\0\x01\0\0")), seg(0xe1, Buffer.from("Exif\0\0GPS-LATITUDE-24.7136N")), seg(0xfe, Buffer.from("made on a phone")), seg(0xc0, sof), seg(0xda, Buffer.from([1, 1, 0, 0, 63, 0])), Buffer.from([seed, 2, 3, 4, 5, 0xff, 0xd9])]);
}
const chunk = (type: string, body: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(body.length); return Buffer.concat([l, Buffer.from(type, "latin1"), body, Buffer.alloc(4)]); };
function png(w = 400, h = 500) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("tEXt", Buffer.from("Location\0Riyadh")), chunk("eXIf", Buffer.from("GPS")), chunk("IDAT", Buffer.from([1, 2, 3])), chunk("IEND", Buffer.alloc(0))]);
}

test("a picture is accepted only as a real JPEG or PNG of a sensible size, judged by its bytes; the kept copy has no location or text data", () => {
  const j = cleanUpload(jpeg()); assert.ok(j.ok);
  if (j.ok) { assert.deepEqual([j.photo.ext, j.photo.width, j.photo.height], ["jpg", 400, 500]); const s = j.photo.bytes.toString("latin1"); assert.ok(!s.includes("GPS-LATITUDE") && !s.includes("made on a phone"), "EXIF and comments dropped"); assert.ok(s.includes("JFIF")); assert.equal(j.photo.bytes.at(-1), 0xd9); }
  const p = cleanUpload(png()); assert.ok(p.ok);
  if (p.ok) { assert.equal(p.photo.ext, "png"); const s = p.photo.bytes.toString("latin1"); assert.ok(!s.includes("Riyadh") && !s.includes("eXIf")); assert.ok(s.includes("IDAT") && s.includes("IEND")); }
  const e = (b: Uint8Array) => { const r = cleanUpload(b); return r.ok ? "ok" : r.error; };
  assert.equal(e(Buffer.alloc(0)), "empty");
  assert.equal(e(Buffer.from("<svg onload=alert(1)></svg>")), "not_image"); assert.equal(e(Buffer.from("GIF89a....")), "not_image"); assert.equal(e(Buffer.from("MZ\x90\0exe")), "not_image");
  assert.equal(e(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(30)])), "broken_image");
  assert.equal(e(jpeg(100, 100)), "too_small"); assert.equal(e(jpeg(400, 299)), "too_small"); assert.equal(e(jpeg(9000, 500)), "too_big_pixels"); assert.equal(e(png(200, 600)), "too_small");
  assert.equal(e(Buffer.concat([jpeg(), Buffer.alloc(MAX_PHOTO_BYTES)])), "too_large");
  assert.equal(e(png().subarray(0, 40)), "broken_image", "a cut-off PNG");
});

test("recorded pictures may point at the site's own files, in exactly one shape", () => {
  const base = { slug: "x-y", licence: "By permission", credit: "Own Photographer", evidence: "Sent in through the site by someone" };
  const ok = cleanPhoto({ ...base, imageUrl: "/api/photo-file/0123456789abcdef0123456789abcdef.jpg", sourceUrl: "/boxers/x-y" }); assert.ok(ok.ok);
  for (const bad of ["/api/photo-file/../../etc/passwd", "/api/photo-file/ABC.jpg", "/api/photo-file/0123456789abcdef0123456789abcdef.svg", "//evil.example/a.jpg", "/other/0123456789abcdef0123456789abcdef.jpg"]) assert.equal(cleanPhoto({ ...base, imageUrl: bad, sourceUrl: "/boxers/x-y" }).ok, false, bad);
  assert.equal(cleanPhoto({ ...base, imageUrl: "/api/photo-file/0123456789abcdef0123456789abcdef.png", sourceUrl: "/admin" }).ok, false);
  assert.ok(OWN_IMAGE.test("/api/photo-file/0123456789abcdef0123456789abcdef.png"));
});

type U = import("../lib/accounts/users").User;
let sender: U, other: U, editor: U, admin: U;
before(async () => {
  const users = await import("../lib/accounts/users"), acc = (await import("../lib/accounts/store")).accountsDb();
  const mk = async (n: string) => { const r = await users.createUser(n, "a-long-passphrase-for-tests-1", acc); if ("error" in r) throw new Error("setup " + n); return r.user; };
  sender = await mk("sub_sender"); other = await mk("sub_other"); const e = await mk("sub_editor"); const a = await mk("sub_admin");
  users.setRole("sub_editor", "editor", acc); users.setRole("sub_admin", "admin", acc);
  editor = { ...e, role: "editor" }; admin = { ...a, role: "admin" };
});
const mainDb = () => { const d = new DatabaseSync(":memory:"); d.exec("CREATE TABLE boxers (id INTEGER PRIMARY KEY, slug TEXT UNIQUE, external_id TEXT, photo_url TEXT, photo_credit TEXT)"); d.prepare("INSERT INTO boxers (slug, external_id) VALUES ('ali-x','e1'),('feed-guy','e2')").run(); d.prepare("UPDATE boxers SET photo_url='https://feed.example/p.jpg' WHERE slug='feed-guy'").run(); return d; };
const send = (u: U, m: DatabaseSync, over: Record<string, unknown> = {}, file: Uint8Array = jpeg(400, 500, Math.floor(Math.random() * 200))) =>
  import("../lib/photos/submissions").then((S) => S.submitPhoto(u, { slug: "ali-x", file, relation: "self", credit: "Ali X / own photo", confirm: true, ...over }, m, undefined, dir));

test("sending a picture: the sender must confirm the right, name a credit and a real fighter; the stored copy is clean; limits apply; nothing is shown yet", async () => {
  const m = mainDb(), S = await import("../lib/photos/submissions");
  const err = async (over: Record<string, unknown>, file?: Uint8Array) => { const r = await send(other, m, over, file); return r.ok ? "ok" : r.error; };
  assert.equal(await err({ confirm: false }), "no_confirm"); assert.equal(await err({ confirm: undefined }), "no_confirm");
  assert.equal(await err({ credit: "x" }), "no_credit"); assert.equal(await err({ relation: "boss" }), "bad_relation"); assert.equal(await err({ slug: "nobody" }), "boxer_unknown"); assert.equal(await err({ slug: "../x" }), "boxer_unknown");
  assert.equal(await err({}, Buffer.from("not a picture")), "not_image");
  const first = jpeg(400, 500, 77), r = await send(sender, m, {}, first); assert.ok(r.ok);
  const kept = fs.readdirSync(dir); assert.equal(kept.length, 1); assert.match(kept[0], /^[a-f0-9]{32}\.jpg$/);
  assert.ok(!fs.readFileSync(path.join(dir, kept[0])).toString("latin1").includes("GPS-LATITUDE"));
  const again = await send(sender, m, {}, first); assert.deepEqual(again, { ok: false, error: "duplicate" });
  assert.equal(m.prepare("SELECT photo_url FROM boxers WHERE slug='ali-x'").get()!.photo_url, null, "nothing is shown before an editor approves");
  assert.equal(S.mySubmissions(sender, m).length, 1); assert.equal(S.mySubmissions(other, m).length, 0);
  assert.ok((await send(sender, m)).ok); assert.ok((await send(sender, m)).ok);
  assert.deepEqual(await send(sender, m), { ok: false, error: "too_many_yours" });
});

test("an editor approves or refuses; approval records it by permission and puts it on the page; a feed photo is not replaced; you cannot approve your own; a stranger cannot", async () => {
  const m = mainDb(), S = await import("../lib/photos/submissions"), L = await import("../lib/photos/store");
  const acc = (await import("../lib/accounts/store")).accountsDb();
  acc.exec("DELETE FROM photo_submissions; DELETE FROM licensed_images;");
  const a = await send(sender, m, {}, jpeg(450, 560, 11)), b = await send(sender, m, { slug: "feed-guy" }, jpeg(450, 560, 12)), c = await send(sender, m, {}, jpeg(450, 560, 13));
  assert.ok(a.ok && b.ok && c.ok); if (!a.ok || !b.ok || !c.ok) return;
  assert.deepEqual(S.reviewSubmission(other, a.id, "approve", "", m, undefined, dir), { ok: false, error: "forbidden" });
  assert.deepEqual(S.reviewSubmission(editor, a.id, "maybe", "", m, undefined, dir), { ok: false, error: "bad_action" });
  assert.deepEqual(S.reviewSubmission(editor, 9999, "approve", "", m, undefined, dir), { ok: false, error: "not_found" });
  const ok = S.reviewSubmission(editor, a.id, "approve", "", m, undefined, dir); assert.deepEqual(ok, { ok: true, status: "approved", applied: true, kept: false });
  const row = m.prepare("SELECT photo_url u, photo_credit c FROM boxers WHERE slug='ali-x'").get() as { u: string; c: string };
  assert.match(row.u, /^\/api\/photo-file\/[a-f0-9]{32}\.jpg$/); assert.match(JSON.parse(row.c).text, /Ali X \/ own photo, By permission/);
  assert.equal(L.listPhotos()[0].licence, "By permission"); assert.match(L.listPhotos()[0].evidence!, /signed-in account/); assert.ok(!L.listPhotos()[0].evidence!.includes("sub_sender"), "the evidence does not name the sender");
  assert.deepEqual(S.reviewSubmission(editor, a.id, "approve", "", m, undefined, dir), { ok: false, error: "not_pending" });
  assert.deepEqual(S.reviewSubmission(editor, b.id, "approve", "", m, undefined, dir), { ok: true, status: "approved", applied: false, kept: true });
  assert.equal(m.prepare("SELECT photo_url FROM boxers WHERE slug='feed-guy'").get()!.photo_url, "https://feed.example/p.jpg");
  const name = (acc.prepare("SELECT file_name n FROM photo_submissions WHERE id = ?").get(c.id) as { n: string }).n;
  assert.ok(fs.existsSync(path.join(dir, name)));
  assert.deepEqual(S.reviewSubmission(editor, c.id, "reject", "not the fighter", m, undefined, dir), { ok: true, status: "rejected", applied: false, kept: false });
  assert.ok(!fs.existsSync(path.join(dir, name)), "a refused picture's file is deleted");
  // an editor's own picture needs someone else; an admin may decide on their own
  const mine = await send(editor, m, {}, jpeg(450, 560, 21)), mineAdmin = await send(admin, m, {}, jpeg(450, 560, 22)); assert.ok(mine.ok && mineAdmin.ok); if (!mine.ok || !mineAdmin.ok) return;
  assert.deepEqual(S.reviewSubmission(editor, mine.id, "approve", "", m, undefined, dir), { ok: false, error: "own_submission" });
  assert.equal(S.reviewSubmission(admin, mine.id, "reject", "", m, undefined, dir).ok, true);
  assert.equal(S.reviewSubmission(admin, mineAdmin.id, "reject", "", m, undefined, dir).ok, true);
});

test("who may see a stored file: anyone when it is on a fighter's page; only the sender and editors while it waits; a bad name never", async () => {
  const m = mainDb(), S = await import("../lib/photos/submissions");
  const acc = (await import("../lib/accounts/store")).accountsDb();
  acc.exec("DELETE FROM photo_submissions; DELETE FROM licensed_images;");
  const a = await send(sender, m, {}, jpeg(450, 560, 31)), b = await send(sender, m, {}, jpeg(450, 560, 32)); assert.ok(a.ok && b.ok); if (!a.ok || !b.ok) return;
  const nm = (id: number) => (acc.prepare("SELECT file_name n FROM photo_submissions WHERE id = ?").get(id) as { n: string }).n;
  assert.equal(S.canServe(nm(a.id), null), false); assert.equal(S.canServe(nm(a.id), other), false);
  assert.equal(S.canServe(nm(a.id), sender), true); assert.equal(S.canServe(nm(a.id), editor), true);
  assert.ok(S.reviewSubmission(editor, a.id, "approve", "", m, undefined, dir).ok);
  assert.equal(S.canServe(nm(a.id), null), true, "on the page: public");
  assert.equal(S.canServe(nm(b.id), null), false);
  for (const bad of ["../accounts.db", "..%2Faccounts.db", "abc.jpg", nm(a.id) + "/..", "0123456789abcdef0123456789abcdef.svg", ""]) assert.equal(S.canServe(bad, editor), false, bad);
  assert.equal(S.withdrawSubmission(other, b.id, undefined, dir), false); assert.equal(S.withdrawSubmission(sender, b.id, undefined, dir), true);
  assert.ok(!fs.existsSync(path.join(dir, nm(b.id))), "a withdrawn picture's file is deleted");
});

test("deleting an account withdraws its waiting pictures and removes their files; an approved picture stays; nothing names the person", async () => {
  const m = mainDb(), S = await import("../lib/photos/submissions"), users = await import("../lib/accounts/users");
  const acc = (await import("../lib/accounts/store")).accountsDb();
  acc.exec("DELETE FROM photo_submissions; DELETE FROM licensed_images;");
  const made = await users.createUser("sub_leaver", "a-long-passphrase-for-tests-1", acc); assert.ok("user" in made); if (!("user" in made)) return;
  const u = made.user;
  const pd = S.photoDir(), mine = (note: string, seed: number) => S.submitPhoto(u, { slug: "ali-x", file: jpeg(450, 560, seed), relation: "self", credit: "Leaver / own photo", note, confirm: true }, m, acc, pd);
  const keep = mine("I am Leaver, call me", 41), wait = mine("", 42); assert.ok(keep.ok && wait.ok); if (!keep.ok || !wait.ok) return;
  const nm = (id: number) => (acc.prepare("SELECT file_name n FROM photo_submissions WHERE id = ?").get(id) as { n: string }).n;
  assert.ok(S.reviewSubmission(editor, keep.id, "approve", "", m, acc, pd).ok);
  assert.equal(await users.deleteUser(u.id, "a-long-passphrase-for-tests-1", acc), true);
  assert.ok(fs.existsSync(path.join(pd, nm(keep.id))), "the approved picture's file stays");
  assert.ok(!fs.existsSync(path.join(pd, nm(wait.id))), "the waiting picture's file is gone");
  const rows = acc.prepare("SELECT user_id, status, note FROM photo_submissions ORDER BY id").all() as { user_id: number | null; status: string; note: string | null }[];
  assert.deepEqual(rows.map((r) => [r.user_id, r.status, r.note]), [[null, "approved", null], [null, "withdrawn", null]]);
  for (const id of [keep.id]) fs.rmSync(path.join(pd, nm(id)), { force: true });
  assert.ok(!JSON.stringify(acc.prepare("SELECT * FROM audit").all()).includes("sub_leaver"), "the name is gone from the activity log");
});

test("the web endpoints: sign-in and same-origin required, size and type refused, an approved picture is served to everyone and a waiting one only to its sender and editors", async () => {
  const users = await import("../lib/accounts/users"), acc = (await import("../lib/accounts/store")).accountsDb(), { getDb } = await import("../lib/db"), S = await import("../lib/photos/submissions");
  acc.exec("DELETE FROM photo_submissions; DELETE FROM licensed_images;");
  const cookie = (name: string) => `rs_session=${encodeURIComponent(users.createSession((acc.prepare("SELECT id FROM users WHERE username = ?").get(name) as { id: number }).id, acc).token)}`;
  const snd = cookie("sub_sender"), oth = cookie("sub_other"), ed = cookie("sub_editor"), ORIGIN = "http://localhost:3000";
  const main = await getDb(), slug = (main.prepare("SELECT slug FROM boxers WHERE photo_url IS NULL ORDER BY id LIMIT 1").get() as { slug: string }).slug;
  main.prepare("UPDATE boxers SET photo_url = NULL, photo_credit = NULL WHERE slug = ?").run(slug);
  const form = (bytes: Uint8Array, over: Record<string, string> = {}) => { const f = new FormData(); f.set("slug", slug); f.set("relation", "team"); f.set("credit", "Team Photographer"); f.set("confirm", "true"); for (const [k, v] of Object.entries(over)) f.set(k, v); f.set("file", new File([new Uint8Array(bytes)], "me.jpg", { type: "image/jpeg" })); return f; };
  const post = (f: FormData, o: { cookie?: string; origin?: string } = {}) => import("../app/api/photos/submit/route").then(async (R) => {
    const raw = new Request(`${ORIGIN}/api/photos/submit`, { method: "POST", body: f }), buf = new Uint8Array(await raw.arrayBuffer());
    return R.POST(new Request(`${ORIGIN}/api/photos/submit`, { method: "POST", body: buf, headers: { "content-type": raw.headers.get("content-type")!, "content-length": String(buf.length), host: "localhost:3000", origin: o.origin ?? ORIGIN, ...(o.cookie ? { cookie: o.cookie } : {}) } }));
  });
  const get = (name: string, c?: string) => import("../app/api/photo-file/[name]/route").then((R) => R.GET(new Request(`${ORIGIN}/api/photo-file/${name}`, { headers: c ? { cookie: c } : {} }), { params: Promise.resolve({ name }) }));
  assert.equal((await post(form(jpeg(500, 600, 51)))).status, 401);
  assert.equal((await post(form(jpeg(500, 600, 51)), { cookie: snd, origin: "https://evil.example" })).status, 403, "a form on another site does nothing");
  assert.equal((await post(form(Buffer.from("<html>")), { cookie: snd })).status, 400);
  assert.equal((await post(form(Buffer.alloc(MAX_PHOTO_BYTES + 100000)), { cookie: snd })).status, 413);
  assert.equal((await post(form(jpeg(500, 600, 52), { confirm: "" }), { cookie: snd })).status, 400);
  const ok = await post(form(jpeg(500, 600, 53)), { cookie: snd }); assert.equal(ok.status, 201); assert.match(String(ok.headers.get("x-robots-tag")), /noindex/);
  const id = ((await ok.json()) as { id: number }).id, name = (acc.prepare("SELECT file_name n FROM photo_submissions WHERE id = ?").get(id) as { n: string }).n;
  assert.equal((await get(name)).status, 404); assert.equal((await get(name, oth)).status, 404); assert.equal((await get(name, snd)).status, 200); assert.equal((await get(name, ed)).status, 200);
  const waiting = await get(name, snd); assert.equal(waiting.headers.get("x-content-type-options"), "nosniff"); assert.match(String(waiting.headers.get("cache-control")), /private/);
  const { POST: REVIEW } = await import("../app/api/photos/submissions/[id]/route");
  const decide = (c: string, action: string) => REVIEW(new Request(`${ORIGIN}/api/photos/submissions/${id}`, { method: "POST", body: JSON.stringify({ action }), headers: { "content-type": "application/json", cookie: c, origin: ORIGIN, host: "localhost:3000" } }), { params: Promise.resolve({ id: String(id) }) });
  assert.equal((await decide(oth, "approve")).status, 403);
  const approved = await decide(ed, "approve"); assert.equal(approved.status, 200); assert.equal(((await approved.json()) as { applied: boolean }).applied, true);
  assert.equal((main.prepare("SELECT photo_url u FROM boxers WHERE slug = ?").get(slug) as { u: string }).u, `/api/photo-file/${name}`);
  const pub = await get(name); assert.equal(pub.status, 200); assert.equal(pub.headers.get("content-type"), "image/jpeg"); assert.match(String(pub.headers.get("cache-control")), /public/);
  assert.equal((await get("..%2F..%2Fetc%2Fpasswd", ed)).status, 404);
  fs.rmSync(path.join(S.photoDir(), name), { force: true });
});
