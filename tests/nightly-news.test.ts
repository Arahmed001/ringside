import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runNightly } from "../lib/nightly";
import { configFromEnv } from "../lib/nightly";
import { makeTemplate, makeVolume, readStatusFile } from "./nightly-helpers";

/**
 * The nightly job's optional "news" step (round 139). What must hold: nothing is read unless NEWS_REFRESH=1 says so; it needs NEWS_CONTACT (the User-Agent's address) and says so
 * when it is missing; a failed or timed-out refresh is a WARNING in the status and never fails the night, never stops the update before it and never skips the off-host copy after it;
 * and the YouTube key never reaches the log.
 */
const work = fs.mkdtempSync(path.join(os.tmpdir(), "nightly-news-"));
let tpl = "";
before(async () => { tpl = await makeTemplate(work); });
after(() => fs.rmSync(work, { recursive: true, force: true }));
const node = (code: string) => ({ file: process.execPath, args: ["-e", code] });
const OK_UPDATE = node("console.log('loaded: 0 events')");

async function night(name: string, o: { news?: string; contact?: string; newsCode?: string; key?: string; offsite?: string; newsTimeoutMs?: number; realCommand?: boolean }) {
  const v = makeVolume(tpl, `n-${name}`);
  const log: string[] = [];
  const r = await runNightly({
    env: { DATABASE_PATH: v.db, ACCOUNTS_DB_PATH: v.accounts, BOXING_API_KEY: "test-key-not-real", RINGSIDE_LOCK_DIR: v.lockDir, ...(o.contact ? { NEWS_CONTACT: o.contact } : {}), ...(o.key ? { YOUTUBE_API_KEY: o.key } : {}) },
    settings: { NEWS_REFRESH: o.news, NIGHTLY_OFFSITE_CMD: o.offsite },
    lockDir: v.lockDir, now: () => new Date("2026-10-06T03:00:00Z"), log: (l) => log.push(l), updateCommand: OK_UPDATE,
    newsCommand: o.newsCode ? () => node(o.newsCode!) : undefined, newsTimeoutMs: o.newsTimeoutMs,
  });
  const st = readStatusFile(v);
  return { r, st, steps: Object.fromEntries(st.steps.map((s) => [s.name, s])), log: log.join("\n") };
}

test("the setting: only NEWS_REFRESH=1 turns it on", () => {
  assert.equal(configFromEnv({}).news, false); assert.equal(configFromEnv({ NEWS_REFRESH: "0" }).news, false); assert.equal(configFromEnv({ NEWS_REFRESH: "yes" }).news, false); assert.equal(configFromEnv({ NEWS_REFRESH: " 1 " }).news, true);
});

test("nothing is refreshed unless NEWS_REFRESH=1: no step, same result as before", async () => {
  const n = await night("off", { newsCode: "process.exit(9)" });
  assert.equal(n.steps.news, undefined); assert.deepEqual([n.st.result, n.r.exitCode], ["ok", 0]);
});

test("a refresh runs after the update and its summary is kept", async () => {
  const n = await night("ok", { news: "1", contact: "me@example.org", newsCode: "console.log('  Boxing News: ok, 15 new of 15'); console.log('90 new headlines; 210 kept.')" });
  assert.equal(n.steps.news.ok, true); assert.match(n.steps.news.message, /90 new headlines; 210 kept/);
  assert.deepEqual(n.st.steps.map((s) => s.name), ["backup", "update", "news", "offsite"]); assert.deepEqual([n.st.result, n.r.exitCode], ["ok", 0]);
});

test("without NEWS_CONTACT it reads nothing and says why; a failed or timed-out refresh is a warning: the night is done, the update stands and the off-host copy still runs", async () => {
  const noContact = await night("nocontact", { news: "1" });
  assert.equal(noContact.steps.news.ok, false); assert.match(noContact.steps.news.message, /NEWS_CONTACT is not set/); assert.equal(noContact.st.result, "warning"); assert.equal(noContact.r.exitCode, 0);
  for (const [name, code, want, ms] of [["failed", "console.error('feed unreachable'); process.exit(1)", /the news refresh failed \(exit 1\): feed unreachable/, undefined], ["slow", "setTimeout(() => {}, 60000)", /timed out/, 300]] as const) {
    const n = await night(name, { news: "1", contact: "me@example.org", newsCode: code, offsite: "true", newsTimeoutMs: ms });
    assert.equal(n.st.result, "warning", name); assert.equal(n.r.exitCode, 0, "the night's own exit code is untouched"); assert.match(n.steps.news.message, want);
    assert.equal(n.steps.update.ok, true); assert.equal(n.steps.offsite.ok, true, "the off-host copy still ran");
  }
});

test("the YouTube key never reaches the log or the status", async () => {
  const n = await night("key", { news: "1", contact: "me@example.org", key: "AIzaSECRET123456", newsCode: "console.log('using key ' + process.env.YOUTUBE_API_KEY); console.error('error with ' + process.env.YOUTUBE_API_KEY); process.exit(1)" });
  assert.ok(!n.log.includes("AIzaSECRET123456"), "not in the log"); assert.ok(!JSON.stringify(n.st).includes("AIzaSECRET123456"), "not in the status");
});
