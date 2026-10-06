import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tempDb } from "./helpers";

/** The forum's web endpoints (round 125): who may call what, the answers, that nothing a visitor writes is open to search engines, and that a cross-site form can do nothing. */
const cleanup = tempDb("forumapi");
const accFile = path.join(os.tmpdir(), `ringside-test-forumapi-accounts-${process.pid}.db`);
process.env.ACCOUNTS_DB_PATH = accFile;
const wipe = () => { for (const e of ["", "-wal", "-shm"]) fs.rmSync(accFile + e, { force: true }); };
wipe();
after(async () => { (await import("../lib/accounts/store")).closeAccountsDb(); wipe(); cleanup(); });

const ORIGIN = "http://localhost:3000";
let slug = "", cookieUser = "", cookieEditor = "";
before(async () => {
  const { getDb } = await import("../lib/db"), users = await import("../lib/accounts/users"), store = await import("../lib/accounts/store");
  const main = await getDb(), acc = store.accountsDb();
  slug = (main.prepare("SELECT slug FROM boxers ORDER BY id LIMIT 1").get() as { slug: string }).slug;
  const mk = async (name: string, role: "user" | "editor") => {
    const r = await users.createUser(name, "a-long-passphrase-for-tests-1", acc); if ("error" in r) throw new Error(r.error);
    if (role === "editor") users.setRole(name, "editor", acc);
    acc.prepare("UPDATE users SET created_at = ? WHERE id = ?").run(new Date(Date.now() - 3 * 86400_000).toISOString(), r.user.id);
    return `rs_session=${encodeURIComponent(users.createSession(r.user.id, acc).token)}`;
  };
  cookieUser = await mk("api_user", "user"); cookieEditor = await mk("api_editor", "editor");
});

const req = (url: string, init: { method?: string; cookie?: string; body?: unknown; origin?: string | null } = {}) => new Request(`${ORIGIN}${url}`, {
  method: init.method ?? "GET",
  headers: { ...(init.cookie ? { cookie: init.cookie } : {}), ...(init.body !== undefined ? { "content-type": "application/json" } : {}), ...(init.origin === null ? {} : { origin: init.origin ?? ORIGIN }), host: "localhost:3000", "x-forwarded-for": `203.0.113.${Math.floor(Math.random() * 200)}` },
  ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
});
const ctx = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });
const read = async (r: Response) => ({ status: r.status, noindex: r.headers.get("x-robots-tag"), body: await r.json() as Record<string, unknown> });

test("reading is public and answers 'no thread yet' without making one; every answer says noindex (round 125)", async () => {
  const { GET } = await import("../app/api/forum/thread/route");
  const empty = await read(await GET(req(`/api/forum/thread?kind=boxer&subject=${slug}`)));
  assert.equal(empty.status, 200); assert.equal(empty.body.thread, null); assert.equal(empty.body.signedIn, false); assert.match(empty.noindex ?? "", /noindex/);
  assert.equal((await read(await GET(req("/api/forum/thread?id=99999")))).status, 404);
  assert.equal((await read(await GET(req("/api/forum/thread?kind=nonsense&subject=x")))).body.thread, null);
  const { GET: list } = await import("../app/api/forum/threads/route");
  const l = await read(await list(req("/api/forum/threads"))); assert.equal(l.status, 200); assert.match(l.noindex ?? "", /nofollow/);
});

test("writing: signed in only, from this site only, the right status for each refusal, and the answer carries the ids", async () => {
  const { POST } = await import("../app/api/forum/post/route"), { GET } = await import("../app/api/forum/thread/route");
  const body = { kind: "boxer", subject: slug, body: "A first post from the API test." };
  assert.equal((await read(await POST(req("/api/forum/post", { method: "POST", body })))).status, 401, "signed out");
  const cross = await read(await POST(req("/api/forum/post", { method: "POST", cookie: cookieUser, body, origin: "https://evil.example" }))); assert.equal(cross.status, 403, "a cross-site form changes nothing");
  assert.equal((await read(await POST(req("/api/forum/post", { method: "POST", cookie: cookieUser, body: { ...body, body: "see http://spam.example" } })))).body.error, "has_link");
  assert.equal((await read(await POST(req("/api/forum/post", { method: "POST", cookie: cookieUser, body: { kind: "boxer", subject: "nobody-here", body: "A post for nobody at all." } })))).status, 404);
  assert.equal((await read(await POST(req("/api/forum/post", { method: "POST", cookie: cookieUser, body: { kind: "other", body: "A post of no kind at all." } })))).status, 404);
  const ok = await read(await POST(req("/api/forum/post", { method: "POST", cookie: cookieUser, body })));
  assert.equal(ok.status, 201); assert.match(ok.noindex ?? "", /noindex/); assert.equal(typeof ok.body.id, "number"); assert.equal(typeof ok.body.threadId, "number");
  assert.equal((await read(await POST(req("/api/forum/post", { method: "POST", cookie: cookieUser, body })))).status, 409, "the same words again");
  const t = await read(await GET(req(`/api/forum/thread?kind=boxer&subject=${slug}`, { cookie: cookieUser })));
  const posts = t.body.posts as { author: string; body: string; mine: boolean }[];
  assert.deepEqual(posts.map((p) => [p.author, p.body, p.mine]), [["api_user", "A first post from the API test.", true]]); assert.equal(t.body.signedIn, true); assert.equal(t.body.role, "user");
  const { POST: bad } = await import("../app/api/forum/post/route");
  const garbage = new Request(`${ORIGIN}/api/forum/post`, { method: "POST", headers: { origin: ORIGIN, host: "localhost:3000", cookie: cookieUser }, body: "{not json" });
  assert.equal((await bad(garbage)).status, 400);
});

test("threads, own posts, reports and moderation over the wire: who may do what", async () => {
  const { POST: start } = await import("../app/api/forum/threads/route"), { PATCH, DELETE } = await import("../app/api/forum/posts/[id]/route");
  const { POST: report } = await import("../app/api/forum/posts/[id]/report/route"), { POST: moderate } = await import("../app/api/forum/posts/[id]/moderate/route");
  const { POST: thread } = await import("../app/api/forum/threads/[id]/moderate/route"), { GET: queue } = await import("../app/api/forum/reports/route"), { POST: reply } = await import("../app/api/forum/post/route");
  const made = await read(await start(req("/api/forum/threads", { method: "POST", cookie: cookieUser, body: { title: "Who is next at heavyweight?", body: "Opening the question for everyone." } })));
  assert.equal(made.status, 201); const tid = made.body.threadId as number, pid = made.body.postId as number;
  assert.equal((await read(await start(req("/api/forum/threads", { method: "POST", body: { title: "Signed out title", body: "Signed out body here." } })))).status, 401);
  assert.equal((await read(await start(req("/api/forum/threads", { method: "POST", cookie: cookieUser, body: { title: "x", body: "A body long enough." } })))).body.error, "title_invalid");
  assert.equal((await read(await PATCH(req(`/api/forum/posts/${pid}`, { method: "PATCH", cookie: cookieUser, body: { body: "Opening the question for all of you." } }), ctx(pid)))).status, 200);
  assert.equal((await read(await PATCH(req(`/api/forum/posts/${pid}`, { method: "PATCH", cookie: cookieEditor, body: { body: "An editor does not edit your words." } }), ctx(pid)))).status, 403, "even an editor edits no one's words");
  const r2 = await read(await reply(req("/api/forum/post", { method: "POST", cookie: cookieEditor, body: { threadId: tid, body: "A reply from the editor account." } }))); assert.equal(r2.status, 201);
  assert.equal((await read(await report(req(`/api/forum/posts/${pid}/report`, { method: "POST", cookie: cookieUser, body: { reason: "spam" } }), ctx(pid)))).body.error, "own_post");
  assert.equal((await read(await report(req(`/api/forum/posts/${pid}/report`, { method: "POST", body: { reason: "spam" } }), ctx(pid)))).status, 401);
  assert.equal((await read(await report(req(`/api/forum/posts/${pid}/report`, { method: "POST", cookie: cookieEditor, body: { reason: "spam" } }), ctx(pid)))).status, 201);
  assert.equal((await read(await queue(req("/api/forum/reports", { cookie: cookieUser })))).status, 403, "the queue is for editors");
  assert.equal((await read(await queue(req("/api/forum/reports")))).status, 401);
  const q = await read(await queue(req("/api/forum/reports", { cookie: cookieEditor }))); assert.equal(q.status, 200); assert.equal((q.body.items as { postId: number }[])[0].postId, pid);
  assert.equal((await read(await moderate(req(`/api/forum/posts/${pid}/moderate`, { method: "POST", cookie: cookieUser, body: { action: "hide" } }), ctx(pid)))).status, 403);
  assert.equal((await read(await moderate(req(`/api/forum/posts/${pid}/moderate`, { method: "POST", cookie: cookieEditor, body: { action: "delete" } }), ctx(pid)))).status, 400, "only hide and restore");
  assert.equal((await read(await moderate(req(`/api/forum/posts/${pid}/moderate`, { method: "POST", cookie: cookieEditor, body: { action: "hide", reason: "off topic" } }), ctx(pid)))).status, 200);
  assert.equal((await read(await thread(req(`/api/forum/threads/${tid}/moderate`, { method: "POST", cookie: cookieUser, body: { action: "lock" } }), ctx(tid)))).status, 403);
  assert.equal((await read(await thread(req(`/api/forum/threads/${tid}/moderate`, { method: "POST", cookie: cookieEditor, body: { action: "lock" } }), ctx(tid)))).status, 200);
  assert.equal((await read(await reply(req("/api/forum/post", { method: "POST", cookie: cookieUser, body: { threadId: tid, body: "Posting into a locked thread now." } })))).status, 409);
  assert.equal((await read(await DELETE(req(`/api/forum/posts/${pid}`, { method: "DELETE", cookie: cookieUser }), ctx(pid)))).status, 200, "an author may always withdraw their own words, hidden or not");
  assert.equal((await read(await DELETE(req(`/api/forum/posts/${pid}`, { method: "DELETE", cookie: cookieEditor }), ctx(pid)))).status, 404);
});

test("what is not offered: no forum page can be indexed by accident and the API source says so for every route", () => {
  const dir = path.resolve(__dirname, "../app/api/forum");
  const files: string[] = [];
  const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) if (e.isDirectory()) walk(path.join(d, e.name)); else files.push(path.join(d, e.name)); };
  walk(dir);
  assert.ok(files.length >= 8, `routes found: ${files.length}`);
  for (const f of files) { const s = fs.readFileSync(f, "utf8"); assert.ok(/forumFail|forumJson/.test(s) && !/return json\(|return fail\(/.test(s), `${path.relative(dir, f)} answers only through the noindex helpers`); }
  assert.match(fs.readFileSync(path.resolve(__dirname, "../lib/forum/http.ts"), "utf8"), /"x-robots-tag": "noindex, nofollow"/);
});

test("the editors' endpoints: the queue and the newest posts carry where each post belongs, for editors only (round 127)", async () => {
  const { GET: recent } = await import("../app/api/forum/recent/route"), { GET: queue } = await import("../app/api/forum/reports/route");
  assert.equal((await read(await recent(req("/api/forum/recent")))).status, 401); assert.equal((await read(await recent(req("/api/forum/recent", { cookie: cookieUser })))).status, 403);
  const r = await read(await recent(req("/api/forum/recent", { cookie: cookieEditor }))); assert.equal(r.status, 200); assert.match(r.noindex ?? "", /noindex/);
  const posts = r.body.posts as { where: { path: string; label: string }; body: string }[];
  assert.ok(posts.length >= 1 && posts.every((p) => typeof p.where.path === "string" && p.where.path.startsWith("/")), "every post says where it is");
  assert.ok(Array.isArray(r.body.hiddenThreads));
  const q = await read(await queue(req("/api/forum/reports", { cookie: cookieEditor }))); assert.ok((q.body.items as { where: unknown }[]).every((i) => !!i.where));
});
