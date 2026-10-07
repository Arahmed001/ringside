import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { tempDb } from "./helpers";
import { AUTO_HIDE_REPORTS, WITHDRAWN_KEEP_MS } from "../lib/forum/rules";

/**
 * The three forum policy defaults the owner approved (PLAN 229, docs/forum-security-review.md items A, D and E): a harder-to-abuse automatic hide with an appeal for the
 * author; the same text from different accounts refused; and withdrawing a hidden post no longer wipes what the editors wanted to read. Each test fails on the code as it was.
 */
const cleanup = tempDb("forumpolicy");
const accFile = path.join(os.tmpdir(), `ringside-test-forumpolicy-accounts-${process.pid}.db`);
process.env.ACCOUNTS_DB_PATH = accFile;
const wipe = () => { for (const e of ["", "-wal", "-shm"]) fs.rmSync(accFile + e, { force: true }); };
wipe();
after(async () => { (await import("../lib/accounts/store")).closeAccountsDb(); wipe(); cleanup(); });

const MIN = 60_000, DAY = 24 * 60 * MIN, T0 = Date.UTC(2026, 9, 6, 12, 0, 0);
const lett = (i: number) => [...Math.floor(i).toString(26)].map((ch) => String.fromCharCode(97 + parseInt(ch, 26))).join("");

async function setup() {
  const { getDb } = await import("../lib/db");
  const users = await import("../lib/accounts/users");
  const store = await import("../lib/accounts/store");
  const F = await import("../lib/forum/posts");
  const { limits } = await import("../lib/accounts/guard");
  const main: DatabaseSync = await getDb(), acc = store.accountsDb();
  const mk = async (name: string, role: "user" | "editor" | "admin" = "user", ageMin = 3 * 24 * 60) => {
    const r = await users.createUser(name, "a-long-passphrase-for-tests-1", acc);
    if ("error" in r) throw new Error(r.error);
    if (role !== "user") users.setRole(name, role, acc);
    acc.prepare("UPDATE users SET created_at = ? WHERE id = ?").run(new Date(T0 - ageMin * MIN).toISOString(), r.user.id);
    return { ...r.user, role, createdAt: new Date(T0 - ageMin * MIN).toISOString() };
  };
  const slug = (main.prepare("SELECT slug FROM boxers ORDER BY id LIMIT 1").get() as { slug: string }).slug;
  return { main, acc, F, users, limits, mk, slug, store };
}
type Ctx = Awaited<ReturnType<typeof setup>>;
type U = Awaited<ReturnType<Ctx["mk"]>>;
let c: Ctx, alice: U, bob: U, eddie: U, n = 0;
beforeEach(async () => {
  c ??= await setup();
  for (const l of ["forumPost", "forumPostIp", "forumThread", "forumReport", "forumEdit", "forumAppeal"] as const) c.limits()[l].reset();
  c.acc.exec("DELETE FROM forum_reports; DELETE FROM forum_posts; DELETE FROM forum_threads; DELETE FROM audit;");
  if (!alice) { alice = await c.mk("alice_pol"); bob = await c.mk("bob_pol"); eddie = await c.mk("eddie_pol", "editor"); }
  delete process.env.FORUM_AUTO_HIDE_REPORTS;
  n++;
});
const write = (user: U, text: string, at = T0, ip = `10.9.0.${user.id % 250}`) => {
  const r = c.F.addPost(user, { kind: "boxer", subject: c.slug }, text, ip, c.main, c.acc, at);
  if (!r.ok) throw new Error(`could not write: ${r.error}`);
  return r;
};
/** A reporter whose report counts: ten days old, with three posts of its own standing. */
async function established(name: string, ageDays = 10, posts = 3) {
  const u = await c.mk(name, "user", ageDays * 24 * 60), at = new Date(T0).toISOString();
  const th = (c.acc.prepare("INSERT INTO forum_threads (kind, title, user_id, created_at, last_post_at) VALUES ('general', 'Elders', ?, ?, ?) RETURNING id").get(u.id, at, at) as { id: number }).id;
  for (let k = 0; k < posts; k++) c.acc.prepare("INSERT INTO forum_posts (thread_id, user_id, body, created_at) VALUES (?,?,?,?)").run(th, u.id, `Standing post ${k} by ${u.username}`, at);
  return u;
}
const statusOf = (id: number) => (c.acc.prepare("SELECT status FROM forum_posts WHERE id = ?").get(id) as { status: string }).status;
const actions = () => (c.acc.prepare("SELECT action FROM audit ORDER BY id").all() as { action: string }[]).map((r) => r.action);
/** Reports a post with `count` established reporters, each from its own address, and says whether the last one hid it. */
let seq = 0;
async function pile(postId: number, count: number, tag = "r") {
  let hidden = false;
  for (let i = 0; i < count; i++) {
    seq++;
    const r = c.F.reportPost(await established(`${tag}${lett(i)}_${n}`), postId, "abuse", "", c.acc, T0, `198.${51 + (seq >> 8)}.${seq % 250}.9`);
    assert.ok(r.ok); hidden = r.hidden;
  }
  return hidden;
}

// ---- A: automatic hide, and the author's appeal --------------------------------------------------------------------------------------------------------------------

test("A: the threshold is higher (six, a setting), and the old four established reporters no longer hide a post", async () => {
  assert.equal(AUTO_HIDE_REPORTS, 6);
  const p = write(alice, `A post some people will dislike, number ${lett(n)}.`);
  assert.equal(await pile(p.id, 5), false, "five established people do not hide it");
  assert.equal(statusOf(p.id), "visible");
  assert.equal(await pile(p.id, 1, "last"), true, "the sixth does");
  assert.equal(statusOf(p.id), "hidden");
  // the setting
  process.env.FORUM_AUTO_HIDE_REPORTS = "3";
  const q = write(bob, `Another post with a lower threshold ${lett(n)}.`);
  assert.equal(await pile(q.id, 2, "s"), false); assert.equal(await pile(q.id, 1, "t"), true, "FORUM_AUTO_HIDE_REPORTS=3");
  process.env.FORUM_AUTO_HIDE_REPORTS = "1"; // below the floor of two: ignored
  const z = write(alice, `A post that one report must not hide ${lett(n)}.`);
  assert.equal(await pile(z.id, 1, "u"), false, "a setting below two is ignored, so one report never hides a post");
  process.env.FORUM_AUTO_HIDE_REPORTS = "banana";
  const y = write(bob, `A post when the setting is nonsense ${lett(n)}.`);
  assert.equal(await pile(y.id, 5, "v"), false, "nonsense falls back to the default");
});

test("A: a reporter counts only with real history: a week old, a few posts standing, not disabled; each person once; all reports are kept", async () => {
  const p = write(alice, `A post for the reporter checks ${lett(n)}.`);
  const un = [await established(`young_${n}`, 3), await established(`quiet_${n}`, 10, 2), await established(`gone_${n}`, 10, 3)];
  c.acc.prepare("UPDATE forum_posts SET status = 'hidden' WHERE user_id = ?").run(un[2].id); // their posts were hidden: not standing
  const th1 = (c.acc.prepare("SELECT thread_id t FROM forum_posts WHERE user_id = ?").get(un[1].id) as { t: number }).t;
  for (let i = 0; i < 3; i++) c.acc.prepare("INSERT INTO forum_posts (thread_id, user_id, body, created_at, status) VALUES (?, ?, 'x', ?, 'deleted')").run(th1, un[1].id, new Date(T0).toISOString()); // withdrawn posts do not count either
  const dis = await established(`dis_${n}`); c.users.setDisabled(dis.username, true, c.acc);
  for (const u of [...un, dis]) assert.ok(c.F.reportPost(u, p.id, "abuse", "", c.acc, T0).ok);
  assert.equal(c.F.countedReporters(c.acc, p.id, T0), 0, "none of them counts");
  assert.equal((c.F.reportQueue(eddie, c.acc) as { items: { reports: number }[] }).items[0].reports, 4, "but an editor sees every report");
  assert.equal(await pile(p.id, 5), false); assert.equal(c.F.countedReporters(c.acc, p.id, T0), 5);
  assert.equal(c.F.reportPost(bob, p.id, "spam", "", c.acc, T0).ok, true); // bob is three days old: kept, not counted
  assert.equal(c.F.countedReporters(c.acc, p.id, T0), 5);
  assert.deepEqual(c.F.reportPost(un[0], p.id, "spam", "", c.acc, T0), { ok: false, error: "already_reported" }, "one report per person, so one count per person");
});

test("A: reporters from one network area count as one person, and reporters in the author's own area count as none", async () => {
  const p = write(alice, `A post six sign-ups from one place dislike ${lett(n)}.`, T0, "203.0.113.50");
  let hidden = false;
  for (let i = 0; i < 6; i++) hidden = (c.F.reportPost(await established(`same_${lett(i)}_${n}`), p.id, "abuse", "", c.acc, T0, `192.0.2.${10 + i}`) as { hidden: boolean }).hidden; // one /24
  assert.equal(hidden, false, "six accounts behind one /24 are one person"); assert.equal(c.F.countedReporters(c.acc, p.id, T0), 1);
  for (let i = 0; i < 4; i++) hidden = (c.F.reportPost(await established(`v6_${lett(i)}_${n}`), p.id, "abuse", "", c.acc, T0, `2001:db8:${i}::${i + 1}`) as { hidden: boolean }).hidden; // four /64s
  assert.equal(hidden, false, "one /24 and four /64s are five people"); assert.equal(c.F.countedReporters(c.acc, p.id, T0), 5);
  assert.equal((c.F.reportPost(await established(`v6_last_${n}`), p.id, "abuse", "", c.acc, T0, "2001:db8:99::1") as { hidden: boolean }).hidden, true, "a fifth area makes six");
  const q = write(bob, `A post whose author has friends nearby ${lett(n)}.`, T0, "198.18.7.7");
  let h2 = false;
  for (let i = 0; i < 6; i++) h2 = (c.F.reportPost(await established(`mate_${lett(i)}_${n}`), q.id, "abuse", "", c.acc, T0, `198.18.7.${20 + i}`) as { hidden: boolean }).hidden;
  assert.equal(h2, false, "the author's own network area is not another person's opinion"); assert.equal(c.F.countedReporters(c.acc, q.id, T0), 0);
  assert.equal(c.F.addressArea("::ffff:192.0.2.77"), c.F.addressArea("192.0.2.1"), "an IPv4 address in IPv6 dress is the same area");
  assert.equal(c.F.addressArea("anon"), null); assert.equal(c.F.addressArea(undefined), null); assert.equal(c.F.addressArea("2001:db8::1"), c.F.addressArea("2001:0db8:0:0:ffff::9"));
});

test("A: the author of an automatically hidden post can ask for a review once; it reaches the editors marked as an appeal; the author is told, never who reported", async () => {
  const p = write(alice, `A post that was hidden by reports ${lett(n)}.`);
  assert.equal(await pile(p.id, 6, "ap"), true);
  const view = (u: U | null) => c.F.listPosts(p.threadId, u, 0, c.acc).posts[0];
  assert.equal(view(alice).appeal, "available", "the author is told they can ask for a review"); assert.equal(view(alice).body, null, "and still sees no words from the public view");
  assert.equal(view(bob).appeal, undefined); assert.equal(view(null).appeal, undefined); assert.equal(view(eddie).appeal, undefined, "only the author is told");
  assert.deepEqual(c.F.appealPost(bob, p.id, c.acc, T0 + MIN), { ok: false, error: "not_found" }, "only the author");
  assert.deepEqual(c.F.appealPost(alice, 99999, c.acc, T0), { ok: false, error: "not_found" });
  assert.deepEqual(c.F.appealPost(alice, p.id, c.acc, T0 + MIN), { ok: true });
  assert.deepEqual(c.F.appealPost(alice, p.id, c.acc, T0 + 2 * MIN), { ok: false, error: "already_appealed" }, "one per post");
  assert.equal(view(alice).appeal, "open");
  const q = c.F.reportQueue(eddie, c.acc) as { items: { postId: number; appeal: boolean; body: string; reports: number }[] };
  assert.equal(q.items[0].postId, p.id); assert.equal(q.items[0].appeal, true, "marked as an appeal"); assert.equal(q.items[0].body, `A post that was hidden by reports ${lett(n)}.`);
  const everything = JSON.stringify([view(alice), c.acc.prepare("SELECT hidden_reason, appeal_at FROM forum_posts WHERE id = ?").get(p.id)]);
  assert.ok(!/ap[a-z]+_\d/.test(everything) && !/abuse/.test(everything), "nothing the author can see names or describes a reporter");
  assert.deepEqual(actions().filter((a) => a.startsWith("forum_appeal") || a === "forum_auto_hide"), ["forum_auto_hide", "forum_appeal"], "logged");
  // an editor restores it
  assert.deepEqual(c.F.moderatePost(bob, p.id, "restore", "", c.acc), { ok: false, error: "forbidden" });
  assert.deepEqual(c.F.moderatePost(eddie, p.id, "restore", "Fine.", c.acc, T0 + 3 * MIN), { ok: true });
  assert.equal(statusOf(p.id), "visible");
  assert.equal((c.acc.prepare("SELECT appeal_result r FROM forum_posts WHERE id = ?").get(p.id) as { r: string }).r, "restored");
  assert.ok(actions().includes("forum_appeal_restore")); assert.equal((c.F.reportQueue(eddie, c.acc) as { items: unknown[] }).items.length, 0, "the queue is empty again");
  assert.equal(view(alice).appeal, undefined, "a visible post carries no appeal state");
});

test("A: an editor can confirm the hide and the author is told; editor-hidden, visible and withdrawn posts have no appeal; appeals are limited per day", async () => {
  const p = write(alice, `A post whose hide an editor confirms ${lett(n)}.`);
  assert.deepEqual(c.F.appealPost(alice, p.id, c.acc, T0), { ok: false, error: "not_appealable" }, "a visible post has nothing to appeal");
  assert.equal(await pile(p.id, 6, "cf"), true);
  assert.deepEqual(c.F.moderatePost(eddie, write(bob, `A visible post to confirm ${lett(n)}.`).id, "confirm", "", c.acc), { ok: false, error: "forbidden" }, "only a hidden post can be confirmed");
  assert.ok(c.F.appealPost(alice, p.id, c.acc, T0 + MIN).ok);
  assert.deepEqual(c.F.moderatePost(eddie, p.id, "confirm", "Spam indeed.", c.acc, T0 + 2 * MIN), { ok: true });
  assert.equal(statusOf(p.id), "hidden");
  assert.equal(c.F.listPosts(p.threadId, alice, 0, c.acc).posts[0].appeal, "decided");
  assert.ok(actions().includes("forum_appeal_confirm"));
  assert.deepEqual((c.acc.prepare("SELECT status FROM forum_reports WHERE post_id = ?").all(p.id) as { status: string }[]).map((r) => r.status), Array(6).fill("upheld"));
  assert.deepEqual(c.F.appealPost(alice, p.id, c.acc, T0 + 3 * MIN), { ok: false, error: "already_appealed" }, "and it cannot be asked again");
  // hidden by an editor: not an automatic hide, so no appeal
  const e = write(alice, `An editor hid this one by hand ${lett(n)}.`);
  c.F.moderatePost(eddie, e.id, "hide", "Off topic.", c.acc, T0);
  assert.deepEqual(c.F.appealPost(alice, e.id, c.acc, T0), { ok: false, error: "not_appealable" });
  assert.equal(c.F.listPosts(e.threadId, alice, 0, c.acc).posts.find((x) => x.id === e.id)!.appeal, undefined);
  // the daily limit: five appeals, the sixth waits (and costs nothing until it is otherwise acceptable)
  const ids: number[] = [];
  for (let i = 0; i < 6; i++) { const w = write(bob, `Hidden post number ${lett(i + 30)} of a busy day.`, T0 + i * MIN); c.acc.prepare("UPDATE forum_posts SET status = 'hidden', hidden_reason = 'auto: 6 reports' WHERE id = ?").run(w.id); ids.push(w.id); }
  for (let i = 0; i < 5; i++) assert.ok(c.F.appealPost(bob, ids[i], c.acc, T0).ok, `appeal ${i}`);
  assert.deepEqual(c.F.appealPost(bob, ids[5], c.acc, T0), { ok: false, error: "rate_limited" });
  assert.deepEqual(c.F.appealPost(bob, ids[0], c.acc, T0), { ok: false, error: "already_appealed" }, "a refusal spends nothing");
  // a disabled account cannot appeal
  const d = await c.mk(`dis2_${n}`); const dw = write(d, `Post by someone later disabled ${lett(n)}.`);
  c.acc.prepare("UPDATE forum_posts SET status = 'hidden', hidden_reason = 'auto: 6 reports' WHERE id = ?").run(dw.id); c.users.setDisabled(d.username, true, c.acc);
  assert.deepEqual(c.F.appealPost(d, dw.id, c.acc, T0), { ok: false, error: "forbidden" });
});

test("A: the appeal over the wire: signed in and from this site only, the author only, and every answer says noindex", async () => {
  const mkCookie = (u: U) => `rs_session=${encodeURIComponent(c.users.createSession(u.id, c.acc).token)}`;
  const { POST } = await import("../app/api/forum/posts/[id]/appeal/route");
  const { GET } = await import("../app/api/forum/thread/route");
  const p = write(alice, `A post to appeal over the wire ${lett(n)}.`);
  c.acc.prepare("UPDATE forum_posts SET status = 'hidden', hidden_reason = 'auto: 6 reports' WHERE id = ?").run(p.id);
  const call = (cookie: string | null, origin: string | null = "http://localhost:3000") => POST(new Request(`http://localhost:3000/api/forum/posts/${p.id}/appeal`, { method: "POST", headers: { ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}), "content-type": "application/json", host: "localhost:3000" }, body: "{}" }), { params: Promise.resolve({ id: String(p.id) }) });
  assert.equal((await call(null)).status, 401);
  assert.equal((await call(mkCookie(alice), "https://evil.example")).status, 403, "a cross-site form changes nothing");
  assert.equal((await call(mkCookie(bob))).status, 404);
  const ok = await call(mkCookie(alice)); assert.equal(ok.status, 201); assert.match(ok.headers.get("x-robots-tag") ?? "", /noindex/);
  assert.equal((await call(mkCookie(alice))).status, 409);
  const mine = await (await GET(new Request(`http://localhost:3000/api/forum/thread?id=${p.threadId}`, { headers: { cookie: mkCookie(alice) } }))).json() as { posts: { appeal?: string; body: string | null }[] };
  assert.equal(mine.posts[0].appeal, "open"); assert.equal(mine.posts[0].body, null);
  const pub = JSON.stringify(await (await GET(new Request(`http://localhost:3000/api/forum/thread?id=${p.threadId}`))).json());
  assert.ok(!/appeal/.test(pub), "a visitor is told nothing about appeals");
});

// ---- D: the same text from different accounts ----------------------------------------------------------------------------------------------------------------------

test("D: the same text from a different account within a day is refused (case, spacing, digits and punctuation do not matter), costs no allowance and is logged once", async () => {
  const ad = "Visit my amazing offer today and win big every single week";
  assert.ok(write(alice, ad).ok);
  for (const [i, copy] of [ad.toUpperCase(), `  ${ad.replace(/ /g, "   ")}!!! `, ad.replace("week", "week 77"), `${ad} 2026`, "Visit, my AMAZING offer: today and win big... every single week"].entries()) {
    const spent = c.limits().forumPost.left(`u${bob.id}`), spentIp = c.limits().forumPostIp.left("10.9.9.9");
    assert.deepEqual(c.F.addPost(bob, { kind: "boxer", subject: c.slug }, copy, "10.9.9.9", c.main, c.acc, T0 + (i + 1) * MIN), { ok: false, error: "copied" }, `variant ${i}`);
    assert.equal(c.limits().forumPost.left(`u${bob.id}`), spent, "no per-person allowance spent"); assert.equal(c.limits().forumPostIp.left("10.9.9.9"), spentIp, "no per-address allowance spent");
  }
  assert.equal((c.acc.prepare("SELECT COUNT(*) c FROM forum_posts").get() as { c: number }).c, 1, "nothing stored for a refused post");
  assert.equal(actions().filter((a) => a === "forum_copy_refused").length, 1, "logged once however many tries");
  const log = c.acc.prepare("SELECT actor, detail FROM audit WHERE action = 'forum_copy_refused'").get() as { actor: string; detail: string };
  assert.equal(log.actor, "bob_pol"); assert.ok(!log.detail.toLowerCase().includes("amazing"), "the words are not in the log");
  // the third account, a thread on the general board, and an edit into a copy are refused too
  assert.deepEqual(c.F.addPost(eddie, { kind: "boxer", subject: c.slug }, ad, "10.9.9.10", c.main, c.acc, T0 + 9 * MIN), { ok: false, error: "copied" });
  assert.deepEqual(c.F.startThread(bob, "Totally different title", ad, "10.9.9.9", c.acc, T0 + 10 * MIN), { ok: false, error: "copied" });
  assert.equal((c.acc.prepare("SELECT COUNT(*) c FROM forum_threads WHERE kind = 'general'").get() as { c: number }).c, 0, "no thread left behind");
  const short = write(bob, "Short for now, edited later.", T0 + 11 * MIN);
  assert.deepEqual(c.F.editPost(bob, short.id, ad, c.acc, T0 + 12 * MIN), { ok: false, error: "copied" }, "a short post cannot be edited into a pasted wave");
  assert.equal((c.acc.prepare("SELECT body FROM forum_posts WHERE id = ?").get(short.id) as { body: string }).body, "Short for now, edited later.");
  // the same person repeating themselves is still the old refusal
  assert.deepEqual(c.F.addPost(alice, { kind: "boxer", subject: c.slug }, ad, "10.9.9.11", c.main, c.acc, T0 + 13 * MIN), { ok: false, error: "duplicate" });
});

test("D: very short posts, a different text, a day later, and a withdrawn original are all fine; false positives stay low", async () => {
  assert.ok(write(alice, "Great fight, well done").ok); assert.ok(write(bob, "Great fight, well done", T0 + MIN).ok, "short replies are a conversation");
  assert.ok(write(alice, "Agreed 100 percent").ok); assert.ok(write(bob, "Agreed 100 percent", T0 + MIN).ok);
  const long = "I thought the third round decided the whole fight for him";
  assert.ok(write(alice, long, T0 + 2 * MIN).ok);
  assert.ok(write(bob, "I thought the ninth round decided the whole fight for him", T0 + 3 * MIN).ok, "different words are a different post");
  assert.deepEqual(c.F.addPost(eddie, { kind: "boxer", subject: c.slug }, long, "10.9.9.9", c.main, c.acc, T0 + 4 * MIN), { ok: false, error: "copied" });
  assert.ok(c.F.addPost(eddie, { kind: "boxer", subject: c.slug }, long, "10.9.9.9", c.main, c.acc, T0 + 25 * 60 * MIN).ok, "after a day the window has moved on");
  // a withdrawn original is not a reason to refuse (its words are gone)
  const w = write(alice, "A very particular sentence about the southpaw stance", T0 + 26 * 60 * MIN);
  assert.ok(c.F.deleteOwnPost(alice, w.id, c.acc, T0 + 26 * 60 * MIN).ok);
  assert.ok(c.F.addPost(bob, { kind: "boxer", subject: c.slug }, "A very particular sentence about the southpaw stance", "10.9.9.9", c.main, c.acc, T0 + 27 * 60 * MIN).ok);
});

// ---- E: withdrawing a hidden or reported post ------------------------------------------------------------------------------------------------------------------------

test("E: withdrawing a hidden post keeps its words for editors only, logs the withdrawal, and shows nothing publicly", async () => {
  const words = `Words an editor may still need to read ${lett(n)}.`;
  const p = write(alice, words);
  assert.deepEqual(c.F.moderatePost(eddie, p.id, "hide", "Looks like abuse.", c.acc, T0 + MIN), { ok: true });
  assert.deepEqual(c.F.deleteOwnPost(bob, p.id, c.acc, T0 + 2 * MIN), { ok: false, error: "not_found" });
  assert.deepEqual(c.F.deleteOwnPost(alice, p.id, c.acc, T0 + 2 * MIN), { ok: true });
  const row = c.acc.prepare("SELECT body, fingerprint, status, withdrawn_body w FROM forum_posts WHERE id = ?").get(p.id) as { body: string; fingerprint: string; status: string; w: string };
  assert.deepEqual({ ...row }, { body: "", fingerprint: "", status: "deleted", w: words }, "the public field is wiped; the editors' field holds the words");
  const log = c.acc.prepare("SELECT actor, target, detail FROM audit WHERE action = 'forum_withdraw'").all() as { actor: string; target: string; detail: string }[];
  assert.equal(log.length, 1, "the withdrawal is in the activity log"); assert.equal(log[0].actor, "alice_pol"); assert.equal(log[0].target, `post#${p.id}`); assert.ok(!JSON.stringify(log).includes("Words an editor"), "without the words");
  // who can read it
  for (const viewer of [null, alice, bob, eddie]) assert.ok(!JSON.stringify(c.F.listPosts(p.threadId, viewer, 0, c.acc)).includes("Words an editor"), `no public view (${viewer?.username ?? "visitor"}) carries the words`);
  const recent = c.F.recentForEditors(eddie, c.acc, 50, T0 + 3 * MIN) as { posts: { postId: number; body: string; withdrawn: boolean; status: string }[] };
  const item = recent.posts.find((x) => x.postId === p.id)!;
  assert.equal(item.body, words); assert.equal(item.withdrawn, true); assert.equal(item.status, "deleted");
  assert.deepEqual(c.F.recentForEditors(bob, c.acc), { ok: false, error: "forbidden" }); assert.deepEqual(c.F.reportQueue(bob, c.acc), { ok: false, error: "forbidden" });
  assert.deepEqual(c.F.deleteOwnPost(alice, p.id, c.acc, T0 + 4 * MIN), { ok: true }, "withdrawing twice changes nothing");
  assert.equal((c.acc.prepare("SELECT withdrawn_body w FROM forum_posts WHERE id = ?").get(p.id) as { w: string }).w, words, "and does not wipe what was kept");
  assert.equal(actions().filter((a) => a === "forum_withdraw").length, 1);
});

test("E: a reported post is kept too; an ordinary withdrawal keeps nothing and logs nothing; the kept words expire", async () => {
  const plain = write(alice, `An ordinary post that is simply withdrawn ${lett(n)}.`);
  assert.ok(c.F.deleteOwnPost(alice, plain.id, c.acc, T0).ok);
  assert.equal((c.acc.prepare("SELECT withdrawn_body w FROM forum_posts WHERE id = ?").get(plain.id) as { w: string | null }).w, null, "nothing retained for a post nobody had complained about");
  assert.ok(!actions().includes("forum_withdraw"));
  const reported = write(alice, `A visible post with a report on it ${lett(n)}.`, T0 + MIN);
  assert.ok(c.F.reportPost(bob, reported.id, "abuse", "", c.acc, T0 + MIN).ok);
  assert.ok(c.F.deleteOwnPost(alice, reported.id, c.acc, T0 + 2 * MIN).ok);
  assert.equal((c.acc.prepare("SELECT withdrawn_body w FROM forum_posts WHERE id = ?").get(reported.id) as { w: string }).w, `A visible post with a report on it ${lett(n)}.`);
  assert.equal(actions().filter((a) => a === "forum_withdraw").length, 1);
  // the time limit
  assert.ok((c.F.recentForEditors(eddie, c.acc, 50, T0 + WITHDRAWN_KEEP_MS - DAY) as { posts: { postId: number }[] }).posts.some((x) => x.postId === reported.id), "still there before the time is up");
  const later = c.F.recentForEditors(eddie, c.acc, 50, T0 + 2 * MIN + WITHDRAWN_KEEP_MS + DAY) as { posts: { postId: number }[] };
  assert.ok(!later.posts.some((x) => x.postId === reported.id), "gone after it");
  assert.equal((c.acc.prepare("SELECT withdrawn_body w FROM forum_posts WHERE id = ?").get(reported.id) as { w: string | null }).w, null);
  assert.equal(WITHDRAWN_KEEP_MS, 90 * DAY);
});

test("E: deleting the account erases the kept words, the thread title and the export does not carry another person's copy; the privacy page says what is kept", async () => {
  const words = `Kept words that deleting the account must erase ${lett(n)}.`;
  const u = await c.mk(`leaving_${n}`);
  const t = c.F.startThread(u, "A title that goes with the account", words, "10.8.0.1", c.acc, T0) as { ok: true; threadId: number; postId: number };
  const other = write(u, `A second post of the same person ${lett(n)}.`, T0 + MIN);
  c.F.moderatePost(eddie, t.postId, "hide", "x", c.acc, T0 + 2 * MIN); c.F.moderatePost(eddie, other.id, "hide", "x", c.acc, T0 + 2 * MIN);
  assert.ok(c.F.deleteOwnPost(u, t.postId, c.acc, T0 + 3 * MIN).ok); assert.ok(c.F.deleteOwnPost(u, other.id, c.acc, T0 + 3 * MIN).ok);
  const { exportFor } = await import("../lib/accounts/export");
  const ex = JSON.stringify(exportFor(u, c.acc)); assert.ok(ex.includes("Kept words"), "the person's own export includes what is kept about them");
  assert.ok(await c.users.deleteUser(u.id, "a-long-passphrase-for-tests-1", c.acc));
  const left = c.acc.prepare("SELECT body, withdrawn_body w, withdrawn_at, wave_fp FROM forum_posts WHERE id IN (?, ?)").all(t.postId, other.id) as { body: string; w: string | null; withdrawn_at: string | null; wave_fp: string }[];
  assert.deepEqual(left.map((r) => ({ ...r })), [{ body: "", w: null, withdrawn_at: null, wave_fp: "" }, { body: "", w: null, withdrawn_at: null, wave_fp: "" }], "nothing of the words is left in any field");
  assert.equal((c.acc.prepare("SELECT title FROM forum_threads WHERE id = ?").get(t.threadId) as { title: string | null }).title, null, "the thread title is wiped with the account");
  assert.ok(!JSON.stringify(c.acc.prepare("SELECT * FROM forum_posts").all()).includes("Kept words"));
  assert.ok(!(c.F.recentForEditors(eddie, c.acc, 50, T0 + 4 * MIN) as { posts: { body: string }[] }).posts.some((x) => x.body.includes("Kept words")));
  // the wording on the privacy page matches what the code does
  const { HELD } = await import("../lib/privacy"), { getTFor } = await import("../lib/i18n/dicts");
  assert.match(HELD.forum_posts.what, new RegExp(`${WITHDRAWN_KEEP_MS / DAY} days`)); assert.match(HELD.forum_posts.what, /kept for the editors/); assert.match(HELD.forum_posts.what, /including any kept for the editors/);
  assert.match(HELD.forum_threads.what, /cleared if you delete your account/);
  const ar = await getTFor("ar");
  for (const t2 of [HELD.forum_posts.what, HELD.forum_threads.what]) assert.match(ar(t2), /[؀-ۿ]/, "and it is translated");
  assert.ok(ar(HELD.forum_threads.what).includes("إذا حذفت حسابك"));
});

// ---- the migration -------------------------------------------------------------------------------------------------------------------------------------------------

test("the new columns are added to an existing accounts file without losing a row, recent posts are filled in for the copy check, and opening twice changes nothing", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const file = path.join(os.tmpdir(), `ringside-test-forummig-${process.pid}.db`);
  for (const e of ["", "-wal", "-shm"]) fs.rmSync(file + e, { force: true });
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, pw_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', created_at TEXT NOT NULL, last_login TEXT, disabled INTEGER NOT NULL DEFAULT 0, picks_public INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE forum_threads (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, subject_ext TEXT, title TEXT, user_id INTEGER, created_at TEXT NOT NULL, last_post_at TEXT NOT NULL, post_count INTEGER NOT NULL DEFAULT 0, locked INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE forum_posts (id INTEGER PRIMARY KEY, thread_id INTEGER NOT NULL, user_id INTEGER, body TEXT NOT NULL, fingerprint TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, edited_at TEXT, status TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible','hidden','deleted')), hidden_by INTEGER, hidden_at TEXT, hidden_reason TEXT);
    INSERT INTO users (id, username, pw_hash, created_at) VALUES (1, 'old_one', 'x', '2026-01-01T00:00:00Z'), (2, 'old_two', 'x', '2026-01-01T00:00:00Z');
    INSERT INTO forum_threads (id, kind, title, user_id, created_at, last_post_at, post_count) VALUES (1, 'general', 'Old thread', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 3);`);
  const recent = new Date(Date.now() - 60 * MIN).toISOString(), ancient = "2026-01-02T00:00:00Z", words = "An old post that was written within the last hour of this test run";
  old.prepare("INSERT INTO forum_posts (thread_id, user_id, body, fingerprint, created_at, status, hidden_reason) VALUES (1, 1, ?, 'fp1', ?, 'visible', NULL), (1, 1, ?, 'fp2', ?, 'hidden', 'auto: 4 reports'), (1, 2, '', '', ?, 'deleted', NULL)").run(words, recent, "An ancient post that is long enough to be compared", ancient, recent);
  old.close();
  const prev = process.env.ACCOUNTS_DB_PATH;
  c.store.closeAccountsDb(); process.env.ACCOUNTS_DB_PATH = file;
  try {
    const db = c.store.accountsDb();
    const cols = () => (db.prepare("PRAGMA table_info(forum_posts)").all() as { name: string }[]).map((x) => x.name);
    for (const col of ["wave_fp", "withdrawn_body", "withdrawn_at", "appeal_at", "appeal_result"]) assert.ok(cols().includes(col), col);
    const rows = db.prepare("SELECT id, body, fingerprint, status, hidden_reason, wave_fp FROM forum_posts ORDER BY id").all() as Record<string, string>[];
    assert.equal(rows.length, 3, "no row lost"); assert.equal(rows[0].body, words); assert.equal(rows[0].fingerprint, "fp1"); assert.equal(rows[1].hidden_reason, "auto: 4 reports"); assert.equal(rows[1].status, "hidden");
    assert.match(rows[0].wave_fp, /^[0-9a-f]{32}$/, "a post of the last day is filled in at once"); assert.equal(rows[1].wave_fp, "", "an older one is outside the window, so left empty"); assert.equal(rows[2].wave_fp, "");
    const before = JSON.stringify(rows);
    c.store.closeAccountsDb(); const again = c.store.accountsDb();
    assert.equal(JSON.stringify(again.prepare("SELECT id, body, fingerprint, status, hidden_reason, wave_fp FROM forum_posts ORDER BY id").all()), before, "opening again changes nothing");
    const idx = (again.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as { name: string }[]).map((x) => x.name);
    for (const i of ["idx_forum_posts_wave", "idx_forum_posts_appeal", "idx_forum_posts_withdrawn"]) assert.ok(idx.includes(i), i);
    // the copy check works on what was already there
    const me = { id: 2, username: "old_two", role: "user", createdAt: "2026-01-01T00:00:00Z", picksPublic: true } as never;
    assert.deepEqual(c.F.addPost(me, { threadId: 1 }, words, "10.1.1.1", c.main, again, Date.now()), { ok: false, error: "copied" });
    assert.ok(again.prepare("SELECT 1 x FROM audit WHERE action = 'forum_copy_refused'").get());
  } finally {
    c.store.closeAccountsDb(); process.env.ACCOUNTS_DB_PATH = prev; for (const e of ["", "-wal", "-shm"]) fs.rmSync(file + e, { force: true });
    c.store.accountsDb();
  }
});
