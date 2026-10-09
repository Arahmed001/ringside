import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tempDb } from "./helpers";

const cleanup = tempDb("review-summary");
const accFile = path.join(os.tmpdir(), `ringside-test-review-summary-accounts-${process.pid}.db`);
process.env.ACCOUNTS_DB_PATH = accFile;
const wipe = () => { for (const e of ["", "-wal", "-shm"]) fs.rmSync(accFile + e, { force: true }); };
wipe();
after(async () => { (await import("../lib/accounts/store")).closeAccountsDb(); wipe(); cleanup(); });

before(async () => {
  const users = await import("../lib/accounts/users"), store = await import("../lib/accounts/store"), acc = store.accountsDb();
  for (const [n, role] of [["rs_editor", "editor"], ["rs_plain", "user"]] as const) { const r = await users.createUser(n, "a-long-passphrase-for-tests-1", acc); if ("error" in r) throw new Error(r.error); if (role === "editor") users.setRole(n, "editor", acc); }
});

test("the summary counts what waits on each editors' page, and counts nothing it should not (round 139)", async () => {
  const acc = (await import("../lib/accounts/store")).accountsDb(), { reviewSummary } = await import("../lib/review-summary");
  assert.deepEqual(reviewSummary(acc), { teamEdits: 0, reports: 0, forum: 0, updates: 0, posts: 0, pictures: 0 }, "an empty accounts database: all zero");
  const uid = (acc.prepare("SELECT id FROM users LIMIT 1").get() as { id: number }).id;
  acc.prepare("INSERT INTO social_posts (provider, post_id, url, subject_kind, subject_ext, added_by, added_at) VALUES ('x','1','https://x.com/a/status/1','general',NULL,?,?)").run(uid, "2026-10-09T00:00:00Z");
  acc.prepare("INSERT INTO social_posts (provider, post_id, url, subject_kind, subject_ext, added_by, added_at) VALUES ('x','2','https://x.com/a/status/2','general',NULL,?,?)").run(uid, "2026-10-09T00:00:00Z");
  acc.prepare("INSERT INTO licensed_images (boxer_slug, image_url, licence, credit, source_url, added_by, added_at) VALUES ('a','https://e.org/a.jpg','CC0','Someone','https://e.org/',?,?)").run(uid, "2026-10-09T00:00:00Z");
  const s = reviewSummary(acc);
  assert.equal(s.posts, 2); assert.equal(s.pictures, 1); assert.equal(s.updates, 0);
});

test("only an editor may ask for the summary, and the answer is for no search engine", async () => {
  const users = await import("../lib/accounts/users"), acc = (await import("../lib/accounts/store")).accountsDb();
  const cookie = (name: string) => `rs_session=${encodeURIComponent(users.createSession((acc.prepare("SELECT id FROM users WHERE username = ?").get(name) as { id: number }).id, acc).token)}`;
  const { GET } = await import("../app/api/review/summary/route");
  const ask = async (c?: string) => GET(new Request("http://localhost:3000/api/review/summary", { headers: { ...(c ? { cookie: c } : {}), host: "localhost:3000" } }));
  assert.equal((await ask()).status, 401); assert.equal((await ask(cookie("rs_plain"))).status, 403);
  const ok = await ask(cookie("rs_editor")); assert.equal(ok.status, 200); assert.match(String(ok.headers.get("x-robots-tag")), /noindex/);
  assert.deepEqual(Object.keys(await ok.json()).sort(), ["forum", "pictures", "posts", "reports", "teamEdits", "updates"]);
});

test("/review shows the editors' tools only to an editor, and links every editors' page", () => {
  const c = fs.readFileSync("components/EditorTools.tsx", "utf8"), page = fs.readFileSync("app/[locale]/review/page.tsx", "utf8");
  assert.match(c, /me\?\.role === "editor" \|\| me\?\.role === "admin"/); assert.match(c, /if \(!isEditor\) return null/);
  for (const href of ["/review\"", "/review/reports", "/review/forum", "/review/updates", "/review/social", "/review/photos"]) assert.ok(c.includes(`href: "${href.replace(/"$/, "")}"`), href);
  assert.match(page, /<EditorTools \/>/);
});
