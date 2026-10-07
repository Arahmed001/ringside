import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { tempDb } from "./helpers";
import { checkText, cleanText } from "../lib/forum/rules";

/** The forum's security and abuse review (docs/forum-security-review.md): each test holds one fix and fails on the code as it was. */
const cleanup = tempDb("forumsec");
const accFile = path.join(os.tmpdir(), `ringside-test-forumsec-accounts-${process.pid}.db`);
process.env.ACCOUNTS_DB_PATH = accFile;
const wipe = () => { for (const e of ["", "-wal", "-shm"]) fs.rmSync(accFile + e, { force: true }); };
wipe();
after(async () => { (await import("../lib/accounts/store")).closeAccountsDb(); wipe(); cleanup(); });

const MIN = 60_000, T0 = Date.UTC(2026, 9, 6, 12, 0, 0);
async function setup() {
  const { getDb } = await import("../lib/db");
  const users = await import("../lib/accounts/users");
  const store = await import("../lib/accounts/store");
  const F = await import("../lib/forum/posts");
  const { limits } = await import("../lib/accounts/guard");
  const main: DatabaseSync = await getDb(), acc = store.accountsDb();
  const mk = async (name: string, role: "user" | "editor" | "admin", ageMin = 3 * 24 * 60) => {
    const r = await users.createUser(name, "a-long-passphrase-for-tests-1", acc);
    if ("error" in r) throw new Error(r.error);
    if (role !== "user") users.setRole(name, role, acc);
    acc.prepare("UPDATE users SET created_at = ? WHERE id = ?").run(new Date(T0 - ageMin * MIN).toISOString(), r.user.id);
    return { ...r.user, role, createdAt: new Date(T0 - ageMin * MIN).toISOString() };
  };
  const slug = (main.prepare("SELECT slug FROM boxers ORDER BY id LIMIT 1").get() as { slug: string }).slug;
  return { main, acc, F, users, limits, mk, slug };
}
type Ctx = Awaited<ReturnType<typeof setup>>;
let c: Ctx, alice: Awaited<ReturnType<Ctx["mk"]>>, eddie: typeof alice, n = 0;
beforeEach(async () => {
  c ??= await setup();
  for (const l of ["forumPost", "forumPostIp", "forumThread", "forumReport", "forumEdit"] as const) c.limits()[l].reset();
  c.acc.exec("DELETE FROM forum_reports; DELETE FROM forum_posts; DELETE FROM forum_threads; DELETE FROM audit;");
  if (!alice) { alice = await c.mk("alice_sec", "user"); eddie = await c.mk("eddie_sec", "editor"); }
  n++;
});
const write = (user: typeof alice, text: string) => c.F.addPost(user, { kind: "boxer", subject: c.slug }, text, `10.1.0.${user.id}`, c.main, c.acc, T0) as { ok: true; id: number; threadId: number };

test("invisible tricks: isolates, the Arabic letter mark, soft hyphens, variation selectors, tag characters and fillers are removed; a post of only fillers is empty", () => {
  assert.equal(cleanText("a⁦b⁧c⁨d⁩e"), "abcde", "bidi isolates");
  assert.equal(cleanText("a؜b­c͏d️e\u{e0041}f g"), "abcdefg");
  assert.equal(checkText("ㅤㅤㅤ⠀⠀ ᅟ").problem, "empty", "fillers that look like blanks");
  assert.equal(checkText("نزالٌ رائعٌ، ضَرْبَةٌ").problem, null, "Arabic with its vowel marks is still ordinary text");
});

test("a smear of combining marks is cut to three, so one letter cannot take the whole line", () => {
  const smear = "e" + "́̂̃̄̅̆̇̈".repeat(50);
  assert.equal([...cleanText(smear)].length, 4);
  assert.equal(cleanText("هَٰذَا"), "هَٰذَا", "three marks or fewer are untouched");
});

test("digits of any script and full-width or ideographic forms cannot carry a phone number or a link past the checks", () => {
  assert.equal(checkText("اتصل بي على ٠٥٥٥١٢٣٤٥٦٧").problem, "has_number", "Arabic-Indic digits");
  assert.equal(checkText("call １２３４５６７８９０ now").problem, "has_number", "full-width digits");
  assert.equal(checkText("see ｗｗｗ．ｓｐａｍ．ｃｏｍ today").problem, "has_link", "full-width link");
  assert.equal(checkText("bet at casino。com today").problem, "has_link", "ideographic full stop");
  assert.equal(checkText("ｈｔｔｐｓ：／／ｘ").problem, "has_link");
  assert.equal(checkText("He won round ٣ and the date was 1998-07-04.").problem, null, "ordinary numbers and dates still pass");
});

test("a report's note and an editor's reason are cut to their limits, not stored at whatever length the request had", async () => {
  const p = write(alice, `A post to report ${n}, with a few words.`);
  const bob = await c.mk(`bob_sec_${n}`, "user");
  assert.ok(c.F.reportPost(bob, p.id, "spam", "x".repeat(10_000), c.acc, T0).ok);
  assert.equal((c.acc.prepare("SELECT note FROM forum_reports").get() as { note: string }).note.length, 300);
  assert.ok(c.F.moderatePost(eddie, p.id, "hide", "y".repeat(10_000), c.acc, T0).ok);
  assert.equal((c.acc.prepare("SELECT hidden_reason r FROM forum_posts").get() as { r: string }).r.length, 200);
  assert.ok(((c.acc.prepare("SELECT detail FROM audit WHERE action = 'forum_hide'").get() as { detail: string }).detail).length <= 200, "and so is the activity log");
});

/** A reporter whose report counts toward the automatic hide: ten days old, with three posts of its own standing (PLAN 229). */
async function established(name: string) {
  const u = await c.mk(name, "user", 10 * 24 * 60), at = new Date(T0).toISOString();
  const th = (c.acc.prepare("INSERT INTO forum_threads (kind, title, user_id, created_at, last_post_at) VALUES ('general', 'Elders', ?, ?, ?) RETURNING id").get(u.id, at, at) as { id: number }).id;
  for (let k = 0; k < 3; k++) c.acc.prepare("INSERT INTO forum_posts (thread_id, user_id, body, created_at) VALUES (?,?,?,?)").run(th, u.id, `Standing post ${k} by ${u.username}`, at);
  return u;
}

test("brand-new accounts cannot hide anyone's post, however many: only established reporters count; the reports are kept for an editor", async () => {
  const p = write(alice, `A post four fresh accounts dislike ${n}.`);
  for (let i = 0; i < 8; i++) { const r = c.F.reportPost(await c.mk(`fresh_${n}_${i}`, "user", 30), p.id, "abuse", "", c.acc, T0); assert.ok(r.ok && !r.hidden, `fresh reporter ${i}`); }
  assert.equal(c.F.listPosts(p.threadId, null, 0, c.acc).posts[0].status, "visible");
  assert.equal((c.F.reportQueue(eddie, c.acc) as { items: { reports: number }[] }).items[0].reports, 8, "an editor still sees all eight");
  const q = write(alice, `A second post, reported by established accounts ${n}.`);
  let last = false;
  for (let i = 0; i < 6; i++) { const r = c.F.reportPost(await established(`aged_${n}_${i}`), q.id, "abuse", "", c.acc, T0); assert.ok(r.ok); last = r.hidden; }
  assert.ok(last, "six established accounts still hide it");
});

test("a thread's title and starter go with its first post: hidden, withdrawn or erased, the title is not shown on the board", async () => {
  const mkThread = (title: string, user = alice) => c.F.startThread(user, title, `The opening words of ${title}.`, `10.2.0.${user.id}`, c.acc, T0) as { ok: true; threadId: number; postId: number };
  const a = mkThread("A thread that will be moderated");
  assert.equal(c.F.listThreads(1, c.acc).threads[0].title, "A thread that will be moderated");
  assert.ok(c.F.moderatePost(eddie, a.postId, "hide", "abuse", c.acc, T0).ok);
  const hidden = c.F.listThreads(1, c.acc).threads[0];
  assert.equal(hidden.title, null); assert.equal(hidden.author, null); assert.equal(c.F.getThread(a.threadId, c.acc)!.title, null);
  assert.ok(c.F.moderatePost(eddie, a.postId, "restore", "", c.acc, T0).ok);
  assert.equal(c.F.getThread(a.threadId, c.acc)!.title, "A thread that will be moderated", "restored with the post");
  assert.ok(c.F.deleteOwnPost(alice, a.postId, c.acc).ok);
  assert.equal(c.F.getThread(a.threadId, c.acc)!.title, null, "withdrawn");
  const leaver = await c.mk(`leaver_${n}`, "user");
  const b = mkThread("Another thread, then the account goes", leaver);
  c.F.eraseForumFor(leaver.id, c.acc);
  assert.equal(c.F.getThread(b.threadId, c.acc)!.title, null, "erased with the account");
});

test("editing is limited like writing: ten edits in ten minutes, and a refused edit costs nothing", () => {
  const p = write(alice, `A post that is edited again and again ${n}.`);
  for (let i = 0; i < 10; i++) assert.ok(c.F.editPost(alice, p.id, `Edit number ${i}, all different words.`, c.acc, T0 + i).ok, `edit ${i}`);
  assert.deepEqual(c.F.editPost(alice, p.id, "One edit too many for ten minutes.", c.acc, T0 + 100), { ok: false, error: "rate_limited" });
  c.limits().forumEdit.reset();
  for (let i = 0; i < 20; i++) assert.equal(c.F.editPost(alice, p.id, "x", c.acc, T0 + i).ok, false);
  assert.equal(c.limits().forumEdit.left(`u${alice.id}`), 10, "refused edits spent nothing");
});

test("the editors' queue does not list a post that has been withdrawn (an empty entry nobody can act on)", async () => {
  const p = write(alice, `A post reported and then withdrawn ${n}.`);
  assert.ok(c.F.reportPost(await c.mk(`rep_${n}`, "user"), p.id, "spam", "", c.acc, T0).ok);
  assert.equal((c.F.reportQueue(eddie, c.acc) as { items: unknown[] }).items.length, 1);
  assert.ok(c.F.deleteOwnPost(alice, p.id, c.acc).ok);
  assert.equal((c.F.reportQueue(eddie, c.acc) as { items: unknown[] }).items.length, 0);
});
