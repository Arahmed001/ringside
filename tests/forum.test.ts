import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { tempDb } from "./helpers";
import { checkText, cleanText, POST_MAX } from "../lib/forum/rules";
import { fingerprint } from "../lib/forum/posts";

/**
 * The forum's foundations (round 125): what a post may say, who may write and how often, the one thread under each fighter and fight, reporting and hiding, what an
 * author may do to their own words, and what deleting an account does to them. No pages yet; these are the rules the pages will stand on.
 */
const cleanup = tempDb("forum");
const accFile = path.join(os.tmpdir(), `ringside-test-forum-accounts-${process.pid}.db`);
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
  const boutId = String((main.prepare("SELECT id FROM bouts ORDER BY id LIMIT 1").get() as { id: number }).id);
  return { main, acc, F, users, limits, mk, slug, boutId, store };
}
type Ctx = Awaited<ReturnType<typeof setup>>;
let c: Ctx, alice: Awaited<ReturnType<Ctx["mk"]>>, bob: typeof alice, eddie: typeof alice;
let n = 0;
/** An account that can count as a reporter: ten days old, with three posts of its own standing (each post unique in its letters). */
async function established(name: string) {
  const u = await c.mk(name, "user", 10 * 24 * 60);
  const th = (c.acc.prepare("INSERT INTO forum_threads (kind, title, user_id, created_at, last_post_at) VALUES ('general', 'Elders', ?, ?, ?) RETURNING id").get(u.id, new Date(T0).toISOString(), new Date(T0).toISOString()) as { id: number }).id;
  for (let k = 0; k < 3; k++) c.acc.prepare("INSERT INTO forum_posts (thread_id, user_id, body, created_at) VALUES (?,?,?,?)").run(th, u.id, `Standing post ${k} by ${u.username}`, new Date(T0 - (k + 1) * MIN).toISOString());
  return u;
}
beforeEach(async () => {
  c ??= await setup();
  c.limits().forumPost.reset(); c.limits().forumPostIp.reset(); c.limits().forumThread.reset(); c.limits().forumReport.reset();
  c.acc.exec("DELETE FROM forum_reports; DELETE FROM forum_posts; DELETE FROM forum_threads; DELETE FROM audit;");
  if (!alice) { alice = await c.mk("alice_forum", "user"); bob = await c.mk("bob_forum", "user"); eddie = await c.mk("eddie_forum", "editor"); }
  n++;
});
/** A number as letters: the forum treats posts that differ only in digits as one post (PLAN 228), so tests that want different posts vary letters. */
export const lett = (i: number) => [...Math.floor(i).toString(26)].map((ch) => String.fromCharCode(97 + parseInt(ch, 26))).join("");
const say = (user: typeof alice, text = `A fair point from ${lett(user.id)} number ${lett(n)}, and a long enough one.`, at = T0) => c.F.addPost(user, { kind: "boxer", subject: c.slug }, text, `10.0.0.${user.id}`, c.main, c.acc, at);

test("what a post may say: plain text of a sensible length; no links, no long numbers, no runs, no invisible tricks (round 125)", () => {
  assert.equal(checkText("Great fight, the jab won it.").problem, null);
  assert.equal(checkText("").problem, "empty"); assert.equal(checkText("   \n ").problem, "empty"); assert.equal(checkText(undefined).problem, "empty"); assert.equal(checkText(42).problem, "empty");
  assert.equal(checkText("x").problem, "too_short"); assert.equal(checkText("a".repeat(POST_MAX + 1)).problem, "too_long"); assert.equal(checkText("a ".repeat(POST_MAX / 2 + 1)).problem, "too_long");
  assert.equal(checkText("b".repeat(POST_MAX).replace(/(.{40})/g, "$1 ")).problem, "too_long", "counted in characters: spaces included");
  for (const link of ["see https://spam.example/x", "http://a.b", "visit www.foo.bar now", "bet at bestodds.com today", "FREE at Spam.IO", "message t.me/promo", "mailto:a@b.co", "ftp://x"]) assert.equal(checkText(link).problem, "has_link", link);
  for (const ok of ["Ring magazine rated him highly", "He went 12.5 rounds in his dreams", "Round 3, 2.5 seconds left", "a 1-2-3 combo and a 3.0 GPA joke"]) assert.equal(checkText(ok).problem, null, ok);
  assert.equal(checkText("call me on 0555 123 4567").problem, "has_number"); assert.equal(checkText("1234567890").problem, "has_number"); assert.equal(checkText("12345678").problem, null, "eight digits is a date, not a phone number"); assert.equal(checkText("born 1998-07-04 and 12-1-1").problem, null);
  assert.equal(checkText("what!!!!!!!!!!!!!!").problem, "repetitive"); assert.equal(checkText("nooooooooooooooo").problem, "repetitive");
  assert.equal(checkText("نزال رائع، ضربة اليد اليسرى حسمت النزال").problem, null, "Arabic is ordinary text");
  assert.equal(checkText("<script>alert(1)</script> is just words here").problem, null, "HTML is not refused, it is only ever shown as text (React escapes it)");
});

test("the text as stored: invisible characters gone, line endings made one way, tidy blank lines, no padding", () => {
  assert.equal(cleanText("a​b‮c﻿d"), "abcd"); assert.equal(cleanText("one\r\ntwo\rthree"), "one\ntwo\nthree"); assert.equal(cleanText("a\n\n\n\n\nb"), "a\n\nb");
  assert.equal(cleanText("  hello  \n  world  "), "hello\n  world"); assert.equal(cleanText("café"), "café", "composed form");
  assert.equal(cleanText("ok\u0000\u0007x"), "okx"); assert.equal(cleanText(null), "");
  assert.equal(fingerprint("Great FIGHT!!  Great, fight."), fingerprint("great fight great fight"), "a repost with other case, spacing or punctuation is the same text");
  assert.notEqual(fingerprint("one thing"), fingerprint("another thing")); assert.match(fingerprint("any words at all"), /^[0-9a-f]{32}$/, "a hash, not the words");
});

test("writing under a fighter makes the thread on the first post, and a post that is refused leaves nothing behind", async () => {
  assert.equal(c.F.findSubjectThread(c.main, "boxer", c.slug, c.acc), null, "looking creates nothing");
  assert.equal((await say(alice, "http://spam.example")).ok, false);
  assert.equal((c.acc.prepare("SELECT COUNT(*) n FROM forum_threads").get() as { n: number }).n, 0, "no empty thread from a refused post");
  const r = await say(alice); assert.ok(r.ok);
  const t = c.F.findSubjectThread(c.main, "boxer", c.slug, c.acc)!;
  assert.equal(t.postCount, 1); assert.equal(t.kind, "boxer"); assert.equal(t.author, "alice_forum");
  const r2 = await say(bob, "Agreed, and the footwork too."); assert.ok(r2.ok && r2.threadId === t.id, "the same thread for everyone");
  assert.equal(c.F.findSubjectThread(c.main, "boxer", c.slug, c.acc)!.postCount, 2);
  const b = c.F.addPost(alice, { kind: "bout", subject: c.boutId }, "A fight with an ending worth discussing.", "10.0.0.1", c.main, c.acc, T0);
  assert.ok(b.ok); assert.notEqual((b as { threadId: number }).threadId, t.id, "a fight has a thread of its own");
  for (const bad of [{ kind: "boxer" as const, subject: "nobody-by-that-name" }, { kind: "bout" as const, subject: "abc" }, { kind: "bout" as const, subject: "99999999" }, { kind: "boxer" as const, subject: "" }]) assert.deepEqual(c.F.addPost(alice, bad, "A perfectly fine post.", "10.0.0.1", c.main, c.acc, T0), { ok: false, error: "no_such_subject" }, JSON.stringify(bad));
  assert.deepEqual(c.F.addPost(alice, { threadId: 99999 }, "Into a thread that is not there.", "10.0.0.1", c.main, c.acc, T0), { ok: false, error: "not_found" });
});

test("who may write: a new account waits five minutes, a young one has a daily allowance, a disabled one is out; the same words twice in a day are refused", async () => {
  const newbie = await c.mk(`newbie_${n}`, "user", 2);
  assert.deepEqual(await say(newbie), { ok: false, error: "too_new" });
  const young = await c.mk(`young_${n}`, "user", 60);
  for (let i = 0; i < 10; i++) { c.limits().forumPost.reset(); assert.ok((await say(young, `Post number ${i} with its own words in it.`, T0 + i * 1000)).ok, `post ${i}`); }
  c.limits().forumPost.reset(); assert.deepEqual(await say(young, "The eleventh post of a young account.", T0 + 20_000), { ok: false, error: "rate_limited" }, "a young account has ten a day");
  const old = await c.mk(`old_${n}`, "user", 3 * 24 * 60);
  for (let i = 0; i < 10; i++) assert.ok((await say(old, `Old hand post ${i} with different words each time.`, T0 + i * 1000)).ok);
  c.limits().forumPost.reset(); assert.ok((await say(old, "An eleventh post from an established account.", T0 + 30_000)).ok, "an older account has no daily cap");
  assert.ok((await say(alice, "Same words, said once.")).ok);
  assert.deepEqual(await say(alice, "SAME words,   said once!!"), { ok: false, error: "duplicate" });
  assert.ok((await say(bob, "Same words, said once.")).ok, "another person may say the same thing");
  assert.ok((await say(alice, "Same words, said once.", T0 + 25 * 60 * MIN)).ok, "a day later it is allowed again");
  c.users.setDisabled("bob_forum", true, c.acc);
  assert.deepEqual(await say(bob, "Something new from a disabled account."), { ok: false, error: "forbidden" });
  c.users.setDisabled("bob_forum", false, c.acc);
});

test("how often: ten posts in ten minutes per person, thirty per address; a refused post does not use the allowance up", async () => {
  const who = await c.mk(`busy_${n}`, "user", 3 * 24 * 60);
  for (let i = 0; i < 10; i++) assert.ok((await say(who, `A busy person's post ${i}, all different.`)).ok, `${i}`);
  assert.deepEqual(await say(who, "One post too many in ten minutes."), { ok: false, error: "rate_limited" });
  c.limits().forumPost.reset();
  for (let i = 0; i < 20; i++) { assert.equal((await say(who, "x")).ok, false); } // refused as too short: costs nothing
  assert.equal(c.limits().forumPost.left(`u${who.id}`), 10, "refused posts spent no allowance");
  c.limits().forumPost.reset(); c.limits().forumPostIp.reset();
  const ip = "198.51.100.7";
  const a1 = await c.mk(`ip1_${n}`, "user", 3 * 24 * 60), a2 = await c.mk(`ip2_${n}`, "user", 3 * 24 * 60), a3 = await c.mk(`ip3_${n}`, "user", 3 * 24 * 60);
  let ok = 0;
  for (let i = 0; i < 40; i++) { const u = [a1, a2, a3][i % 3]; c.limits().forumPost.reset(); if (c.F.addPost(u, { kind: "boxer", subject: c.slug }, `Shared address post ${lett(i)} and some more words.`, ip, c.main, c.acc, T0).ok) ok++; }
  assert.equal(ok, 30, "thirty from one address however many accounts");
});

test("threads on the general board: a title and a first post, three a day, newest activity first", async () => {
  assert.deepEqual(c.F.startThread(alice, "Hi", "A body that is long enough.", "10.0.0.1", c.acc, T0), { ok: false, error: "title_invalid" });
  assert.deepEqual(c.F.startThread(alice, "A title\nwith a break", "A body that is long enough.", "10.0.0.1", c.acc, T0), { ok: false, error: "title_invalid" });
  assert.deepEqual(c.F.startThread(alice, "See http://x.example", "A body that is long enough.", "10.0.0.1", c.acc, T0), { ok: false, error: "title_invalid" });
  assert.deepEqual(c.F.startThread(alice, "A fine title here", "x", "10.0.0.1", c.acc, T0), { ok: false, error: "too_short" });
  const first = c.F.startThread(alice, "Best heavyweight ever?", "Make your case in a few lines.", "10.0.0.1", c.acc, T0) as { ok: true; threadId: number };
  const second = c.F.startThread(bob, "Most underrated jab", "I say it is the one nobody mentions.", "10.0.0.2", c.acc, T0 + MIN) as { ok: true; threadId: number };
  assert.ok(first.ok && second.ok);
  assert.deepEqual(c.F.listThreads(1, c.acc).threads.map((t) => t.title), ["Most underrated jab", "Best heavyweight ever?"]);
  assert.ok(c.F.addPost(bob, { threadId: first.threadId }, "Answering the first thread now.", "10.0.0.2", c.main, c.acc, T0 + 2 * MIN).ok);
  assert.deepEqual(c.F.listThreads(1, c.acc).threads.map((t) => t.title), ["Best heavyweight ever?", "Most underrated jab"], "a reply brings a thread to the top");
  assert.equal(c.F.listThreads(1, c.acc).threads[0].postCount, 2);
  assert.equal(c.F.listThreads(99, c.acc).page, 1, "a page past the end lands on a real one");
  for (let i = 0; i < 2; i++) assert.ok(c.F.startThread(alice, `Another idea number ${i}`, `Body number ${i} with enough words in it.`, "10.0.0.1", c.acc, T0 + (3 + i) * MIN).ok);
  assert.deepEqual(c.F.startThread(alice, "A fourth thread today", "Body number four with enough words.", "10.0.0.1", c.acc, T0 + 9 * MIN), { ok: false, error: "rate_limited" }, "three threads a day");
});

test("reading: posts in order with a cursor, words and author only where the post is visible, an editor also sees the number of open reports", async () => {
  for (let i = 0; i < 35; i++) { c.limits().forumPost.reset(); const u = i % 2 ? alice : bob; assert.ok(c.F.addPost(u, { kind: "boxer", subject: c.slug }, `Reading test post ${lett(i)}, all different words ${lett(i * 7)}.`, `10.0.1.${i}`, c.main, c.acc, T0 + i * 1000).ok, `post ${i}`); }
  const t = c.F.findSubjectThread(c.main, "boxer", c.slug, c.acc)!;
  const p1 = c.F.listPosts(t.id, null, 0, c.acc); assert.equal(p1.posts.length, 30); assert.equal(p1.more, true);
  const p2 = c.F.listPosts(t.id, null, p1.posts.at(-1)!.id, c.acc); assert.ok(p2.posts.length >= 1 && !p2.more);
  assert.ok(p1.posts.every((p, i, a) => i === 0 || a[i - 1].id < p.id), "oldest first");
  const target = p1.posts[0]; c.F.deleteOwnPost(target.author === "alice_forum" ? alice : bob, target.id, c.acc);
  const after = c.F.listPosts(t.id, null, 0, c.acc).posts[0]; assert.deepEqual({ body: after.body, author: after.author, status: after.status }, { body: null, author: null, status: "deleted" });
  assert.ok(!("reports" in p1.posts[0]), "the public does not see report counts"); assert.ok("reports" in c.F.listPosts(t.id, eddie, 0, c.acc).posts[0], "an editor does");
  assert.ok(c.F.listPosts(t.id, bob, 0, c.acc).posts.some((p) => p.mine) && !c.F.listPosts(t.id, null, 0, c.acc).posts.some((p) => p.mine));
});

test("your own words: editable for fifteen minutes by you alone, withdrawable any time, and withdrawing wipes them", async () => {
  const r = await say(alice, "A first draft of an opinion."); assert.ok(r.ok); const id = (r as { id: number }).id;
  assert.deepEqual(c.F.editPost(bob, id, "Not mine to change.", c.acc, T0 + MIN), { ok: false, error: "forbidden" });
  assert.deepEqual(c.F.editPost(alice, id, "http://spam.example now", c.acc, T0 + MIN), { ok: false, error: "has_link" });
  assert.deepEqual(c.F.editPost(alice, id, "A second draft of an opinion.", c.acc, T0 + 10 * MIN), { ok: true });
  const t = c.F.findSubjectThread(c.main, "boxer", c.slug, c.acc)!;
  const v = c.F.listPosts(t.id, null, 0, c.acc).posts[0]; assert.equal(v.body, "A second draft of an opinion."); assert.ok(v.editedAt);
  assert.deepEqual(c.F.editPost(alice, id, "Too late to change this.", c.acc, T0 + 16 * MIN), { ok: false, error: "edit_window_over" });
  assert.deepEqual(c.F.deleteOwnPost(bob, id, c.acc), { ok: false, error: "not_found" });
  assert.deepEqual(c.F.deleteOwnPost(alice, id, c.acc), { ok: true });
  const row = c.acc.prepare("SELECT body, fingerprint, status FROM forum_posts WHERE id = ?").get(id) as { body: string; fingerprint: string; status: string };
  assert.deepEqual({ ...row }, { body: "", fingerprint: "", status: "deleted" }, "the words are gone from the database, not just hidden");
  assert.deepEqual(c.F.editPost(alice, id, "Back from the dead.", c.acc, T0 + MIN), { ok: false, error: "forbidden" });
  assert.ok((await say(alice, "A second draft of an opinion.", T0 + 20 * MIN)).ok, "a withdrawn post does not count as said, so it can be said again");
});

test("reports: not your own, once each, a reason from the list; enough different, established people hide a post until an editor looks; an editor hides or restores and it is logged", async () => {
  const r = await say(alice, "A post people will not like."); const id = (r as { id: number }).id;
  assert.deepEqual(c.F.reportPost(alice, id, "spam", null, c.acc), { ok: false, error: "own_post" });
  assert.deepEqual(c.F.reportPost(bob, id, "rude", null, c.acc), { ok: false, error: "bad_reason" });
  assert.deepEqual(c.F.reportPost(bob, 999999, "spam", null, c.acc), { ok: false, error: "not_found" });
  assert.deepEqual(c.F.reportPost(bob, id, "abuse", "  insulting  ", c.acc, T0), { ok: true, hidden: false });
  assert.deepEqual(c.F.reportPost(bob, id, "abuse", null, c.acc), { ok: false, error: "already_reported" }, "once per person");
  const reporters: Awaited<ReturnType<typeof c.mk>>[] = [];
  for (let i = 0; i < 6; i++) reporters.push(await established(`rep${lett(i)}_${n}`));
  for (let i = 0; i < 5; i++) assert.deepEqual(c.F.reportPost(reporters[i], id, ["spam", "off_topic", "other"][i % 3], null, c.acc, T0), { ok: true, hidden: false }, `report ${i + 1}: bob's (three days old: kept, not counted) and these five are not yet six established people`);
  assert.deepEqual(c.F.reportPost(reporters[5], id, "other", null, c.acc, T0), { ok: true, hidden: true }, "the sixth different established person hides it");
  const t = c.F.findSubjectThread(c.main, "boxer", c.slug, c.acc)!;
  assert.deepEqual({ ...c.F.listPosts(t.id, null, 0, c.acc).posts[0] }, { id, author: null, body: null, status: "hidden", createdAt: c.F.listPosts(t.id, null, 0, c.acc).posts[0].createdAt, editedAt: null, mine: false }, "a hidden post shows no words and no name");
  assert.ok(c.acc.prepare("SELECT 1 x FROM audit WHERE action = 'forum_auto_hide'").get());
  const q = c.F.reportQueue(eddie, c.acc); assert.ok(q.ok); assert.equal((q as { items: { reports: number }[] }).items[0].reports, 7, "every report is kept, counted or not");
  assert.deepEqual(c.F.reportQueue(bob, c.acc), { ok: false, error: "forbidden" }); assert.deepEqual(c.F.moderatePost(bob, id, "restore", "", c.acc), { ok: false, error: "forbidden" });
  assert.deepEqual(c.F.moderatePost(eddie, id, "restore", "Reads fine to me.", c.acc, T0 + MIN), { ok: true });
  assert.equal(c.F.listPosts(t.id, null, 0, c.acc).posts[0].body, "A post people will not like.");
  assert.deepEqual((c.acc.prepare("SELECT status FROM forum_reports WHERE post_id = ?").all(id) as { status: string }[]).map((x) => x.status), Array(7).fill("dismissed"), "restoring settles the reports as dismissed");
  assert.deepEqual(c.F.moderatePost(eddie, id, "hide", "Targeted insults.", c.acc, T0 + 2 * MIN), { ok: true });
  assert.equal(c.F.listPosts(t.id, null, 0, c.acc).posts[0].status, "hidden");
  const log = c.acc.prepare("SELECT actor, action, target, detail FROM audit WHERE action IN ('forum_hide','forum_restore') ORDER BY id").all();
  assert.deepEqual(log.map((x) => ({ ...x })), [{ actor: "eddie_forum", action: "forum_restore", target: `post#${id}`, detail: "Reads fine to me." }, { actor: "eddie_forum", action: "forum_hide", target: `post#${id}`, detail: "Targeted insults." }]);
  assert.deepEqual(c.F.reportPost(bob, id, "spam", null, c.acc), { ok: false, error: "already_reported" });
});

test("a locked or hidden thread takes no posts; only editors lock and hide", async () => {
  const r = await say(alice, "Opening a thread that will be locked."); const tid = (r as { threadId: number }).threadId;
  assert.deepEqual(c.F.moderateThread(bob, tid, "lock", c.acc), { ok: false, error: "forbidden" });
  assert.deepEqual(c.F.moderateThread(eddie, tid, "lock", c.acc), { ok: true });
  assert.deepEqual(await say(bob, "Trying to post in a locked thread."), { ok: false, error: "locked" });
  assert.ok(c.F.getThread(tid, c.acc)!.locked, "a locked thread can still be read");
  c.F.moderateThread(eddie, tid, "unlock", c.acc); assert.ok((await say(bob, "Posting once it is open again.")).ok);
  c.F.moderateThread(eddie, tid, "hide", c.acc);
  assert.equal(c.F.findSubjectThread(c.main, "boxer", c.slug, c.acc), null, "a hidden thread is not found"); assert.equal(c.F.getThread(tid, c.acc), null);
  assert.deepEqual(await say(bob, "Posting into a hidden thread."), { ok: false, error: "not_found" });
  assert.deepEqual(c.F.moderateThread(eddie, 99999, "lock", c.acc), { ok: false, error: "not_found" });
});

test("deleting an account wipes what the person wrote in the forum, keeps the places, and the export carries it", async () => {
  const who = await c.mk(`leaver_${n}`, "user");
  const r = await say(who, "Words that will leave with the account."); const id = (r as { id: number }).id; const tid = (r as { threadId: number }).threadId;
  assert.ok(c.F.addPost(bob, { threadId: tid }, "A reply that stays.", "10.0.0.2", c.main, c.acc, T0).ok);
  c.F.reportPost(bob, id, "other", "my private note", c.acc, T0);
  const { exportFor } = await import("../lib/accounts/export");
  const mine = exportFor(who, c.acc) as unknown as { forumPosts: { body: string }[]; forumThreads: unknown[] };
  assert.deepEqual(mine.forumPosts.map((p) => p.body), ["Words that will leave with the account."]); assert.equal(mine.forumThreads.length, 1);
  const bobs = exportFor(bob, c.acc) as unknown as { forumReports: { note: string }[] }; assert.equal(bobs.forumReports[0].note, "my private note");
  const ok = await c.users.deleteUser(who.id, "a-long-passphrase-for-tests-1", c.acc); assert.ok(ok);
  const row = c.acc.prepare("SELECT user_id, body, status FROM forum_posts WHERE id = ?").get(id) as { user_id: number | null; body: string; status: string };
  assert.deepEqual({ ...row }, { user_id: null, body: "", status: "deleted" }, "no words, no author");
  assert.equal(c.F.getThread(tid, c.acc)!.author, null, "the thread keeps its place, without the name");
  assert.equal(c.F.listPosts(tid, null, 0, c.acc).posts.length, 2, "the reply that was theirs to answer is still there");
  assert.equal(JSON.stringify(c.acc.prepare("SELECT * FROM forum_reports").all()).includes("my private note"), true, "someone else's report note is untouched");
});

test("what an editor sees (round 127): reported posts most reported first, the newest posts with hidden ones' words, hidden threads, and where each belongs", async () => {
  const r1 = await say(alice, "A post about the fighter that people will report."); const id1 = (r1 as { id: number }).id;
  const g = c.F.startThread(bob, "Heavyweights of the decade", "Who deserves the top spot and why?", "10.0.0.2", c.acc, T0 + MIN) as { ok: true; threadId: number; postId: number };
  const r3 = c.F.addPost(alice, { threadId: g.threadId }, "My choice is the one with the best jab.", "10.0.0.1", c.main, c.acc, T0 + 2 * MIN) as { ok: true; id: number };
  const reporters = [await c.mk(`q1_${n}`, "user"), await c.mk(`q2_${n}`, "user")];
  for (const u of reporters) c.F.reportPost(u, id1, "spam", null, c.acc, T0);
  c.F.reportPost(reporters[0], r3.id, "off_topic", null, c.acc, T0);
  assert.deepEqual(c.F.reportQueue(bob, c.acc), { ok: false, error: "forbidden" }); assert.deepEqual(c.F.recentForEditors(bob, c.acc), { ok: false, error: "forbidden" });
  const q = c.F.reportQueue(eddie, c.acc); assert.ok(q.ok);
  const items = (q as { items: { postId: number; reports: number; reasons: string[]; kind: "boxer" | "bout" | "general"; subject: string | null; threadTitle: string | null }[] }).items;
  assert.deepEqual(items.map((i) => [i.postId, i.reports]), [[id1, 2], [r3.id, 1]], "most reported first");
  assert.deepEqual(items[0].reasons, ["spam"]); assert.equal(items[0].kind, "boxer"); assert.ok(items[0].subject); assert.equal(items[1].kind, "general"); assert.equal(items[1].threadTitle, "Heavyweights of the decade");
  const w0 = c.F.whereIs(c.main, { ...items[0], threadId: 1 }), w1 = c.F.whereIs(c.main, { ...items[1], threadId: g.threadId });
  assert.equal(w0.path, `/boxers/${c.slug}`); assert.ok(w0.label.length > 0); assert.deepEqual(w1, { path: `/forum/${g.threadId}`, label: "Heavyweights of the decade" });
  const bout = c.F.addPost(alice, { kind: "bout", subject: c.boutId }, "A fight with a lot to say about it.", "10.0.0.1", c.main, c.acc, T0 + 3 * MIN) as { ok: true; id: number; threadId: number };
  const bq = c.F.recentForEditors(eddie, c.acc) as { ok: true; posts: { postId: number; kind: string; subject: string | null; threadId: number; threadTitle: string | null }[]; hiddenThreads: unknown[] };
  assert.deepEqual(bq.posts.map((p) => p.postId), [bout.id, r3.id, (g as { postId: number }).postId, id1], "newest first");
  const bw = c.F.whereIs(c.main, { ...bq.posts[0], kind: "bout" }); assert.equal(bw.path, `/bouts/${c.boutId}`);
  c.F.moderatePost(eddie, id1, "hide", "Spam.", c.acc, T0 + 4 * MIN);
  const after = c.F.recentForEditors(eddie, c.acc) as { ok: true; posts: { postId: number; body: string; status: string }[] };
  const hid = after.posts.find((p) => p.postId === id1)!; assert.equal(hid.status, "hidden"); assert.equal(hid.body, "A post about the fighter that people will report.", "an editor reads what was hidden");
  assert.equal(c.F.reportQueue(eddie, c.acc).ok && (c.F.reportQueue(eddie, c.acc) as { items: { postId: number }[] }).items.some((i) => i.postId === id1), false, "hiding settles its reports");
  c.F.moderateThread(eddie, g.threadId, "hide", c.acc);
  const th = (c.F.recentForEditors(eddie, c.acc) as { hiddenThreads: { id: number; title: string }[] }).hiddenThreads; assert.deepEqual(th.map((x) => [x.id, x.title]), [[g.threadId, "Heavyweights of the decade"]]);
  c.F.moderateThread(eddie, g.threadId, "show", c.acc); assert.equal((c.F.recentForEditors(eddie, c.acc) as { hiddenThreads: unknown[] }).hiddenThreads.length, 0);
  c.F.deleteOwnPost(alice, bout.id, c.acc);
  assert.ok(!(c.F.recentForEditors(eddie, c.acc) as { posts: { postId: number }[] }).posts.some((p) => p.postId === bout.id), "a withdrawn post is not listed (its words are gone)");
});

test("a spam wave: many young accounts from one address, from many addresses, and the same advert copied by many accounts (round 127, overnight)", async () => {
  const spamText = (i: number, tag: string) => `Wave ${tag} message ${lett(i)} from an account that wants to be heard a lot today`;
  // 1. sixty young accounts behind ONE address, each trying twenty different posts: the address allows thirty in ten minutes, however many accounts
  const young = await Promise.all(Array.from({ length: 60 }, (_, i) => c.mk(`wave1_${n}_${i}`, "user", 60)));
  let ok1 = 0;
  for (let k = 0; k < 20; k++) for (const u of young) { if (c.F.addPost(u, { kind: "boxer", subject: c.slug }, spamText(k * 100 + u.id, "one"), "203.0.113.9", c.main, c.acc, T0).ok) ok1++; }
  assert.equal(ok1, 30, "one address, sixty accounts: thirty posts");
  // 2. forty young accounts, each from its own address, thirty tries each: ten a day each (young), and ten in ten minutes
  c.limits().forumPost.reset(); c.limits().forumPostIp.reset();
  const spread = await Promise.all(Array.from({ length: 40 }, (_, i) => c.mk(`wave2_${n}_${i}`, "user", 60)));
  const per = new Map<number, number>();
  for (let k = 0; k < 30; k++) for (const u of spread) { if (c.F.addPost(u, { kind: "boxer", subject: c.slug }, spamText(k * 1000 + u.id, "two"), `198.51.100.${u.id % 250}-${u.id}`, c.main, c.acc, T0 + k).ok) per.set(u.id, (per.get(u.id) ?? 0) + 1); }
  assert.deepEqual([...new Set(per.values())], [10], "each young account gets ten, no more");
  assert.equal([...per.values()].reduce((a, b) => a + b, 0), 400);
  // 3. the same long advert from fifty established accounts, each from its own address: the third copy and after are refused
  c.limits().forumPost.reset(); c.limits().forumPostIp.reset();
  const old = await Promise.all(Array.from({ length: 50 }, (_, i) => c.mk(`wave3_${n}_${i}`, "user")));
  const ad = "Visit my amazing offer today and win big every single week without any risk at all";
  const results = old.map((u, i) => c.F.addPost(u, { kind: "boxer", subject: c.slug }, `${ad}${i % 2 ? "!" : ""}`, `192.0.2.${i}`, c.main, c.acc, T0 + 1000 + i));
  assert.equal(results.filter((r) => r.ok).length, 1, "one copy gets through, the rest are refused as a wave from other accounts (PLAN 228: it was two)");
  assert.deepEqual([...new Set(results.filter((r) => !r.ok).map((r) => (r as { error: string }).error))], ["copied"]);
  // short common posts are not a wave
  const shorts = old.slice(0, 10).map((u, i) => c.F.addPost(u, { kind: "boxer", subject: c.slug }, "Great fight, well done", `192.0.2.${100 + i}`, c.main, c.acc, T0 + 2000 + i));
  assert.equal(shorts.filter((r) => r.ok).length, 10, "ten people saying 'Great fight, well done' is a conversation");
  // a day later the advert may be tried again
  c.limits().forumPost.reset(); c.limits().forumPostIp.reset();
  assert.ok(c.F.addPost(old[5], { kind: "boxer", subject: c.slug }, ad, "192.0.2.200", c.main, c.acc, T0 + 26 * 60 * MIN).ok, "after a day the window has moved on");
});

test("the forum's reads and its checks use indexes, so they stay fast when the forum is large (measured overnight: a lookup scanned every thread of its kind until idx_forum_subject)", () => {
  const plan = (sql: string, ...args: (string | number)[]) => (c.acc.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args) as { detail: string }[]).map((r) => r.detail).join(" | ");
  assert.match(plan("SELECT * FROM forum_threads WHERE kind = ? AND subject_ext = ? AND hidden = 0", "boxer", "x"), /idx_forum_subject \(kind=\? AND subject_ext=\?\)/, "the thread under a fighter or a fight");
  assert.match(plan("SELECT * FROM forum_posts WHERE thread_id = ? AND id > ? ORDER BY id LIMIT 31", 1, 0), /idx_forum_posts_thread/, "a page of a thread");
  assert.match(plan("SELECT 1 FROM forum_posts WHERE user_id = ? AND fingerprint = ? AND created_at > ?", 1, "f", "2026"), /idx_forum_posts_(user|fp)/, "the same words by one person");
  assert.match(plan("SELECT COUNT(DISTINCT user_id) FROM forum_posts WHERE fingerprint = ? AND created_at > ? AND user_id <> ?", "f", "2026", 1), /idx_forum_posts_fp \(fingerprint=\? AND created_at>\?\)/, "the same words by others (a wave)");
  assert.match(plan("SELECT COUNT(*) FROM forum_posts WHERE user_id = ? AND created_at > ?", 1, "2026"), /idx_forum_posts_user/, "a young account's day");
  assert.match(plan("SELECT * FROM forum_threads WHERE kind = 'general' AND hidden = 0 ORDER BY last_post_at DESC LIMIT 20"), /idx_forum_threads_recent/, "the board");
  assert.match(plan("SELECT COUNT(DISTINCT user_id) FROM forum_reports WHERE post_id = ? AND status = 'open'", 1), /idx_forum_reports_open/, "reports of a post");
});
