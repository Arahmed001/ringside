import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tempDb } from "./helpers";
import { parsePost, EMBED_HOSTS, PROVIDERS } from "../lib/social/post";

const cleanup = tempDb("social");
const accFile = path.join(os.tmpdir(), `ringside-test-social-accounts-${process.pid}.db`);
process.env.ACCOUNTS_DB_PATH = accFile;
const wipe = () => { for (const e of ["", "-wal", "-shm"]) fs.rmSync(accFile + e, { force: true }); };
wipe();
after(async () => { (await import("../lib/accounts/store")).closeAccountsDb(); wipe(); cleanup(); });

test("a link becomes a provider, an id and an embed address built from checked parts; anything else is refused", () => {
  const ok: [string, string, string, string][] = [
    ["https://www.youtube.com/watch?v=OZWT2969oBU&t=3s", "youtube", "OZWT2969oBU", "https://www.youtube-nocookie.com/embed/OZWT2969oBU?autoplay=1&rel=0"],
    ["https://youtu.be/OZWT2969oBU?si=abc", "youtube", "OZWT2969oBU", "https://www.youtube-nocookie.com/embed/OZWT2969oBU?autoplay=1&rel=0"],
    ["https://m.youtube.com/shorts/OZWT2969oBU", "youtube", "OZWT2969oBU", "https://www.youtube-nocookie.com/embed/OZWT2969oBU?autoplay=1&rel=0"],
    ["https://twitter.com/DAZNBoxing/status/1234567890123456789?s=20", "x", "1234567890123456789", "https://platform.twitter.com/embed/Tweet.html?id=1234567890123456789&dnt=true&theme=dark"],
    ["https://x.com/user_1/status/20", "x", "20", "https://platform.twitter.com/embed/Tweet.html?id=20&dnt=true&theme=dark"],
    ["https://old.reddit.com/r/Boxing/comments/1abcdef/usyk_vs_fury_thread/?utm=x", "reddit", "1abcdef", "https://embed.reddit.com/r/Boxing/comments/1abcdef/usyk_vs_fury_thread/?embed=true&theme=dark"],
    ["https://www.instagram.com/p/CwM1XyJvXkz/?igsh=1", "instagram", "CwM1XyJvXkz", "https://www.instagram.com/p/CwM1XyJvXkz/embed/"],
    ["https://www.instagram.com/dazn/reel/Cabc_1234-x/", "instagram", "Cabc_1234-x", "https://www.instagram.com/reel/Cabc_1234-x/embed/"],
    ["https://www.facebook.com/Facebook/posts/10153231379946729", "facebook", "10153231379946729", "https://www.facebook.com/plugins/post.php?href=https%3A%2F%2Fwww.facebook.com%2FFacebook%2Fposts%2F10153231379946729&show_text=true&width=500"],
    ["https://www.facebook.com/watch/?v=123456789012", "facebook", "123456789012", "https://www.facebook.com/plugins/video.php?href=https%3A%2F%2Fwww.facebook.com%2Fwatch%2F%3Fv%3D123456789012&show_text=true&width=500"],
  ];
  for (const [url, provider, id, embed] of ok) { const p = parsePost(url); assert.ok(p, url); assert.deepEqual([p.provider, p.id, p.embed], [provider, id, embed], url); }
  assert.equal(parsePost("https://x.com/DAZNBoxing/status/1234")!.account, "DAZNBoxing"); assert.equal(parsePost("https://www.reddit.com/r/Boxing/comments/1abcdef/")!.account, "r/Boxing");
  for (const bad of [
    "", "not a link", "javascript:alert(1)", "data:text/html,x", "ftp://x.com/a/status/1", "https://evil.example/x.com/a/status/1", "https://x.com.evil.example/a/status/1", "https://user:pw@x.com/a/status/1", "https://x.com:8443/a/status/1",
    "https://x.com/a", "https://x.com/a/status/abc", "https://x.com/a/status/1\"onload=alert(1)", "https://x.com/waytoolonghandle12345/status/1", "https://www.youtube.com/watch?v=short", "https://www.youtube.com/@channel", "https://www.youtube.com/watch?v=OZWT2969oBU\"x",
    "https://www.reddit.com/r/Boxing/", "https://www.reddit.com/user/someone/comments/1abcdef/x/", "https://www.reddit.com/r/Boxing/comments/!!!/x/", "https://www.instagram.com/dazn/", "https://www.instagram.com/p/ab/", "https://www.instagram.com/explore/tags/boxing/",
    "https://www.facebook.com/dazn", "https://www.facebook.com/dazn/photos/123456789", "https://www.facebook.com/permalink.php?story_fbid=abc%22&id=1",
  ]) assert.equal(parsePost(bad), null, bad);
  for (const p of PROVIDERS) assert.ok(EMBED_HOSTS[p], p);
  for (const [url] of ok) assert.ok(Object.values(EMBED_HOSTS).includes(new URL(parsePost(url)!.embed).hostname), "every embed is on a host the policy allows: " + url);
});

let editor: import("../lib/accounts/users").User, plain: import("../lib/accounts/users").User;
before(async () => {
  const users = await import("../lib/accounts/users"), store = await import("../lib/accounts/store"), acc = store.accountsDb();
  const a = await users.createUser("soc_editor", "a-long-passphrase-for-tests-1", acc), b = await users.createUser("soc_plain", "a-long-passphrase-for-tests-1", acc);
  if ("error" in a || "error" in b) throw new Error("setup");
  users.setRole("soc_editor", "editor", acc); editor = { ...a.user, role: "editor" }; plain = b.user;
});

test("only an editor adds or removes a post; the subject is checked; a post is added once per place; a place holds six; the embed address is rebuilt on every read", async () => {
  const S = await import("../lib/social/store");
  const link = "https://x.com/DAZNBoxing/status/1234567890";
  assert.deepEqual(S.addPost(plain, { link, subjectKind: "general" }), { ok: false, error: "forbidden" });
  assert.deepEqual(S.removePost(plain, 1), { ok: false, error: "forbidden" });
  assert.deepEqual(S.addPost(editor, { link: "https://evil.example/x", subjectKind: "general" }), { ok: false, error: "bad_link" });
  assert.deepEqual(S.addPost(editor, { link, subjectKind: "nowhere" }), { ok: false, error: "bad_subject" });
  assert.deepEqual(S.addPost(editor, { link, subjectKind: "boxer", subjectExt: "../etc/passwd" }), { ok: false, error: "bad_subject" });
  assert.deepEqual(S.addPost(editor, { link, subjectKind: "event", subjectExt: "12ab" }), { ok: false, error: "bad_subject" });
  const a = S.addPost(editor, { link, subjectKind: "boxer", subjectExt: "some-fighter", note: "  A‮ note\n with   spaces  " });
  assert.ok(a.ok); if (!a.ok) return;
  assert.equal(a.post.account, "DAZNBoxing", "the account is read from the link when not given"); assert.equal(a.post.note, "A note with spaces", "controls and direction overrides removed, spaces collapsed");
  assert.deepEqual(S.addPost(editor, { link, subjectKind: "boxer", subjectExt: "some-fighter" }), { ok: false, error: "duplicate" });
  assert.ok(S.addPost(editor, { link, subjectKind: "event", subjectExt: "7" }).ok, "the same post may show in another place");
  assert.deepEqual(S.postsFor("boxer", "some-fighter").map((p) => p.embed), ["https://platform.twitter.com/embed/Tweet.html?id=1234567890&dnt=true&theme=dark"]);
  assert.deepEqual(S.postsFor("boxer", "someone-else"), [], "nothing for a fighter with none");
  for (let i = 0; i < 5; i++) assert.ok(S.addPost(editor, { link: `https://x.com/a/status/${100 + i}`, subjectKind: "general" }).ok);
  assert.ok(S.addPost(editor, { link: "https://x.com/a/status/105", subjectKind: "general" }).ok);
  assert.deepEqual(S.addPost(editor, { link: "https://x.com/a/status/106", subjectKind: "general" }), { ok: false, error: "too_many" });
  assert.deepEqual(S.removePost(editor, 99999), { ok: false, error: "not_found" });
  assert.deepEqual(S.removePost(editor, a.post.id), { ok: true }); assert.deepEqual(S.postsFor("boxer", "some-fighter"), []);
  const acc = (await import("../lib/accounts/store")).accountsDb();
  assert.ok((acc.prepare("SELECT COUNT(*) c FROM audit WHERE action IN ('social_add','social_remove')").get() as { c: number }).c >= 3, "each change is in the log");
  acc.prepare("UPDATE social_posts SET url = 'https://evil.example/x' WHERE subject_kind = 'general'").run();
  assert.deepEqual(S.postsFor("general", null), [], "a stored link that no longer parses shows nothing, whatever is in the table");
});

test("the web endpoints: editors only, same-origin only, answers are not for search engines", async () => {
  const users = await import("../lib/accounts/users"), acc = (await import("../lib/accounts/store")).accountsDb();
  const cookie = (id: number) => `rs_session=${encodeURIComponent(users.createSession(id, acc).token)}`;
  const rows = acc.prepare("SELECT id, username FROM users").all() as { id: number; username: string }[];
  const ed = cookie(rows.find((r) => r.username === "soc_editor")!.id), pl = cookie(rows.find((r) => r.username === "soc_plain")!.id);
  const ORIGIN = "http://localhost:3000";
  const req = (url: string, init: { method?: string; cookie?: string; body?: unknown; origin?: string | null } = {}) => new Request(`${ORIGIN}${url}`, { method: init.method ?? "GET", headers: { ...(init.cookie ? { cookie: init.cookie } : {}), ...(init.body !== undefined ? { "content-type": "application/json" } : {}), ...(init.origin === null ? {} : { origin: init.origin ?? ORIGIN }), host: "localhost:3000" }, ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}) });
  const { GET, POST } = await import("../app/api/social/route"), { POST: REMOVE } = await import("../app/api/social/[id]/remove/route");
  const out = async (r: Response) => ({ status: r.status, robots: r.headers.get("x-robots-tag"), body: await r.json() as Record<string, unknown> });
  assert.equal((await out(await GET(req("/api/social")))).status, 401); assert.equal((await out(await GET(req("/api/social", { cookie: pl })))).status, 403);
  const add = { link: "https://www.instagram.com/p/CwM1XyJvXkz/", subjectKind: "event", subjectExt: "9" };
  assert.equal((await out(await POST(req("/api/social", { method: "POST", body: add })))).status, 401, "not signed in");
  assert.equal((await out(await POST(req("/api/social", { method: "POST", cookie: pl, body: add })))).status, 403, "not an editor");
  assert.equal((await out(await POST(req("/api/social", { method: "POST", cookie: ed, body: add, origin: "https://evil.example" })))).status, 403, "a form on another site does nothing");
  const done = await out(await POST(req("/api/social", { method: "POST", cookie: ed, body: add })));
  assert.equal(done.status, 200); assert.match(String(done.robots), /noindex/); assert.equal((done.body.post as { provider: string }).provider, "instagram");
  assert.equal((await out(await POST(req("/api/social", { method: "POST", cookie: ed, body: add })))).status, 409, "the same post twice in a place");
  const bad = await out(await POST(req("/api/social", { method: "POST", cookie: ed, body: { link: "javascript:alert(1)", subjectKind: "general" } })));
  assert.deepEqual([bad.status, bad.body.error], [400, "bad_link"]);
  assert.equal((await out(await REMOVE(req("/api/social/1/remove", { method: "POST", cookie: pl, body: {} }), { params: Promise.resolve({ id: "1" }) }))).status, 403);
  const list = await out(await GET(req("/api/social", { cookie: ed }))); assert.equal(list.status, 200); assert.match(String(list.robots), /noindex/);
});
