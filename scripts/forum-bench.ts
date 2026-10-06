/**
 * npm run forum:bench: how fast the forum is when it is large. Builds a throwaway accounts database (5,000 accounts, 32,000 threads, 200,000 posts, 6,000 reports,
 * one thread of 5,000 posts), times every read and write path in process, and prints the query plans of the ones that matter. It touches no real database (ACCOUNTS_DB_PATH
 * is a temporary file) and never starts the site. Measured 2026-10-06: every read under 5 ms, adding a post 0.15 ms (it was 4 ms before idx_forum_subject).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { User } from "../lib/accounts/users";

async function main() {
  const file = path.join(os.tmpdir(), `forumbench-${process.pid}.db`); process.env.ACCOUNTS_DB_PATH = file;
    const { accountsDb } = await import("../lib/accounts/store"); const F = await import("../lib/forum/posts"); const { getDb } = await import("../lib/db"); const { limits } = await import("../lib/accounts/guard");
  const acc = accountsDb(), main = await getDb();
  const t = (label: string, fn: () => unknown, n = 1) => { const t0 = performance.now(); for (let i = 0; i < n; i++) fn(); const ms = (performance.now() - t0) / n; console.log(`${label.padEnd(58)} ${ms.toFixed(2)} ms`); return ms; };
  const USERS = 5000, SUBJECT_THREADS = 30000, GENERAL = 2000, POSTS = 200000, BIG = 5000;
  const now = Date.now(), old = new Date(now - 30 * 86400_000).toISOString();
  acc.exec("BEGIN");
  const ins = acc.prepare("INSERT INTO users (username, pw_hash, created_at) VALUES (?,?,?)");
  for (let i = 0; i < USERS; i++) ins.run(`bench_${i}`, "x", old);
  const real = main.prepare("SELECT slug, external_id e FROM boxers ORDER BY id LIMIT 400").all() as { slug: string; e: string }[];
  const boxers = Array.from({ length: SUBJECT_THREADS }, (_, i) => real[i] ?? { slug: `fake-${i}`, e: `ext-fake-${i}` });
  const th = acc.prepare("INSERT INTO forum_threads (kind, subject_ext, title, user_id, created_at, last_post_at) VALUES (?,?,?,?,?,?) RETURNING id");
  const subj = boxers.map((b, i) => (th.get("boxer", b.e, null, 1 + (i % USERS), old, old) as { id: number }).id);
  const gen = Array.from({ length: GENERAL }, (_, i) => (th.get("general", null, `General thread number ${i} about boxing`, 1 + (i % USERS), new Date(now - (GENERAL - i) * 60_000).toISOString(), new Date(now - (GENERAL - i) * 60_000).toISOString()) as { id: number }).id);
  const post = acc.prepare("INSERT INTO forum_posts (thread_id, user_id, body, fingerprint, created_at) VALUES (?,?,?,?,?)");
  const bigThread = subj[0];
  for (let i = 0; i < POSTS; i++) { const tid = i < BIG ? bigThread : i % 3 === 0 ? gen[i % GENERAL] : subj[i % SUBJECT_THREADS]; post.run(tid, 1 + (i * 7) % USERS, `Post number ${i} with some words about the fight and the jab ${"lorem ipsum ".repeat(5)}`, `fp${i}`, new Date(now - (POSTS - i) * 1000).toISOString()); }
  acc.exec("UPDATE forum_threads SET post_count = (SELECT COUNT(*) FROM forum_posts p WHERE p.thread_id = forum_threads.id), last_post_at = COALESCE((SELECT MAX(created_at) FROM forum_posts p WHERE p.thread_id = forum_threads.id), last_post_at)");
  const rep = acc.prepare("INSERT OR IGNORE INTO forum_reports (post_id, user_id, reason, created_at) VALUES (?,?,?,?)");
  for (let p = 1; p <= 3000; p++) for (let k = 0; k < 1 + (p % 3); k++) rep.run(p * 5, 1 + ((p * 13 + k * 101) % USERS), "spam", old);
  acc.exec("COMMIT");
  console.log(`seeded: ${USERS} users, ${SUBJECT_THREADS + GENERAL} threads, ${POSTS} posts (${BIG} in one thread), reports ${(acc.prepare("SELECT COUNT(*) c FROM forum_reports").get() as { c: number }).c}; file ${Math.round(fs.statSync(file).size / 1e6)} MB`);
  const ed: User = { id: 1, username: "bench_0", role: "editor", createdAt: old, picksPublic: true };
  console.log("--- reads");
  t("listThreads page 1 (300 general threads)", () => F.listThreads(1, acc), 200);
  t("listThreads page 15", () => F.listThreads(15, acc), 200);
  t("findSubjectThread (a fighter's thread)", () => F.findSubjectThread(main, "boxer", boxers[5].slug, acc), 500);
  t("listPosts: first page of the 5,000-post thread", () => F.listPosts(bigThread, null, 0, acc), 200);
  t("listPosts: page deep in the big thread (after id 4500)", () => F.listPosts(bigThread, null, 4500, acc), 200);
  t("listPosts as an editor (report counts) on the big thread", () => F.listPosts(bigThread, ed, 0, acc), 100);
  t("reportQueue (editor), 3,000 reported posts", () => F.reportQueue(ed, acc), 20);
  t("recentForEditors (newest 50)", () => F.recentForEditors(ed, acc), 50);
  console.log("--- writes");
  const who: User[] = Array.from({ length: 300 }, (_, i) => ({ id: 100 + i, username: `bench_${100 + i}`, role: "user" as const, createdAt: old, picksPublic: true }));
  let i = 0;
  t("addPost (distinct user, limits reset each time)", () => { limits().forumPost.reset(); limits().forumPostIp.reset(); F.addPost(who[i++ % 300], { kind: "boxer", subject: real[i % 50].slug }, `A new post number ${i} about the footwork`, `ip${i}`, main, acc); }, 1000);
  t("startThread", () => { limits().forumThread.reset(); limits().forumPost.reset(); limits().forumPostIp.reset(); F.startThread(who[i++ % 300], `Title about round ${i}`, `Body about round ${i} and the jab`, `ip${i}`, acc); }, 200);
  t("reportPost", () => { limits().forumReport.reset(); F.reportPost(who[i++ % 300], 10000 + i, "spam", null, acc); }, 500);
  t("moderatePost hide", () => F.moderatePost(ed, 12000 + (i++ % 500), "hide", "x", acc), 500);
  console.log("--- query plans");
  for (const [label, sql, args] of [
    ["thread by subject", "SELECT t.*, u.username AS author FROM forum_threads t LEFT JOIN users u ON u.id = t.user_id WHERE t.kind = ? AND t.subject_ext = ? AND t.hidden = 0", ["boxer", boxers[5].e]],
    ["posts of a thread after id", "SELECT p.*, u.username FROM forum_posts p LEFT JOIN users u ON u.id = p.user_id WHERE p.thread_id = ? AND p.id > ? ORDER BY p.id LIMIT 31", [bigThread, 4500]],
    ["duplicate check", "SELECT 1 FROM forum_posts WHERE user_id = ? AND fingerprint = ? AND created_at > ? AND status <> 'deleted'", [5, "fp", old]],
    ["daily count (young account)", "SELECT COUNT(*) c FROM forum_posts WHERE user_id = ? AND created_at > ?", [5, old]],
    ["general board list", "SELECT * FROM forum_threads WHERE kind = 'general' AND hidden = 0 ORDER BY last_post_at DESC, id DESC LIMIT 20 OFFSET 0", []],
    ["report count of open per post", "SELECT COUNT(DISTINCT user_id) FROM forum_reports WHERE post_id = ? AND status = 'open'", [10]],
    ["newest posts for editors", "SELECT p.id FROM forum_posts p JOIN forum_threads t ON t.id = p.thread_id WHERE p.status <> 'deleted' ORDER BY p.id DESC LIMIT 50", []],
    ["report queue grouping", "SELECT p.id, COUNT(r.id) n FROM forum_reports r JOIN forum_posts p ON p.id = r.post_id WHERE r.status = 'open' GROUP BY p.id ORDER BY n DESC, p.id LIMIT 100", []],
  ] as const) console.log(`${label.padEnd(30)} ${(acc.prepare("EXPLAIN QUERY PLAN " + sql).all(...(args as unknown as (string | number)[])) as { detail: string }[]).map((r) => r.detail).join(" | ")}`);
  fs.rmSync(file, { force: true }); fs.rmSync(file + "-wal", { force: true }); fs.rmSync(file + "-shm", { force: true });
}
main().catch((e) => { console.error(e); process.exit(1); });
