import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { configFromEnv, runNightly } from "../lib/nightly";
import { pingMonitor } from "../lib/nightly-ping";
import { makeTemplate, makeVolume, readStatusFile } from "./nightly-helpers";

/**
 * The nightly job's weekly enrichment step and its heartbeat (round 142). What must hold: enrichment runs only when asked for and only on its day (Sundays UTC for weekly), needs
 * WIKIMEDIA_CONTACT, runs AFTER the off-host copy, and a failure is a warning that never fails the night; the heartbeat is sent after a finished night (plain for ok or warning,
 * /fail for a failed one), never for an interrupted one, never printed, and a monitor that is down never fails the night.
 */
const work = fs.mkdtempSync(path.join(os.tmpdir(), "nightly-ops-"));
let tpl = "";
before(async () => { tpl = await makeTemplate(work); });
after(() => fs.rmSync(work, { recursive: true, force: true }));
const node = (code: string) => ({ file: process.execPath, args: ["-e", code] });
const SUNDAY = "2026-10-04T03:00:00Z", TUESDAY = "2026-10-06T03:00:00Z";

async function night(name: string, o: { enrich?: string; contact?: string; enrichCode?: string; day?: string; ping?: string; update?: string; pingFetch?: typeof fetch; offsite?: string }) {
  const v = makeVolume(tpl, `o-${name}`), log: string[] = [];
  const r = await runNightly({
    env: { DATABASE_PATH: v.db, ACCOUNTS_DB_PATH: v.accounts, BOXING_API_KEY: "test-key-not-real", RINGSIDE_LOCK_DIR: v.lockDir, ...(o.contact ? { WIKIMEDIA_CONTACT: o.contact } : {}) },
    settings: { NIGHTLY_ENRICH: o.enrich, NIGHTLY_PING_URL: o.ping, NIGHTLY_OFFSITE_CMD: o.offsite },
    lockDir: v.lockDir, now: () => new Date(o.day ?? TUESDAY), log: (l) => log.push(l), updateCommand: node(o.update ?? "console.log('loaded: 0 events')"),
    enrichCommand: o.enrichCode ? () => node(o.enrichCode!) : undefined, pingFetch: o.pingFetch,
  });
  const st = readStatusFile(v);
  return { r, st, steps: Object.fromEntries(st.steps.map((s) => [s.name, s])), log: log.join("\n") };
}

test("the settings: enrichment is off unless NIGHTLY_ENRICH says weekly or nightly, and a typo warns", () => {
  assert.equal(configFromEnv({}).enrich, "off"); assert.equal(configFromEnv({ NIGHTLY_ENRICH: "weekly" }).enrich, "weekly"); assert.equal(configFromEnv({ NIGHTLY_ENRICH: " Nightly " }).enrich, "nightly");
  const c = configFromEnv({ NIGHTLY_ENRICH: "sometimes" }); assert.equal(c.enrich, "off"); assert.ok(c.warnings.some((w) => /NIGHTLY_ENRICH/.test(w)));
  assert.equal(configFromEnv({ NIGHTLY_PING_URL: " https://hc.example/abc " }).pingUrl, "https://hc.example/abc"); assert.equal(configFromEnv({}).pingUrl, null);
});

test("weekly enrichment runs on Sundays only, after the off-host copy, with the contact; any other day it is not even a step", async () => {
  const tue = await night("tue", { enrich: "weekly", contact: "me@example.org", enrichCode: "process.exit(9)" });
  assert.equal(tue.steps.enrich, undefined); assert.deepEqual([tue.st.result, tue.r.exitCode], ["ok", 0]);
  const sun = await night("sun", { enrich: "weekly", contact: "me@example.org", day: SUNDAY, offsite: "true", enrichCode: "console.log('Done: staging, enrich, champions, venues, headshots, entities.')" });
  assert.equal(sun.steps.enrich.ok, true); assert.match(sun.steps.enrich.message, /^Done: staging/);
  assert.deepEqual(sun.st.steps.map((s) => s.name), ["backup", "update", "offsite", "enrich"], "enrichment is last, so a long run never delays the off-host copy");
  const every = await night("nightly", { enrich: "nightly", contact: "me@example.org", enrichCode: "console.log('Done: staging.')" });
  assert.equal(every.steps.enrich.ok, true, "nightly means any day");
});

test("enrichment without WIKIMEDIA_CONTACT asks nothing of Wikidata and says why; a failure or a timeout is a warning and the night is still done", async () => {
  const none = await night("nocontact", { enrich: "nightly" });
  assert.equal(none.steps.enrich.ok, false); assert.match(none.steps.enrich.message, /WIKIMEDIA_CONTACT is not set/); assert.deepEqual([none.st.result, none.r.exitCode], ["warning", 0]);
  const bad = await night("fail", { enrich: "nightly", contact: "me@example.org", enrichCode: "console.error('wikidata unreachable'); process.exit(1)" });
  assert.match(bad.steps.enrich.message, /the enrichment stopped \(exit 1; it resumes next time\): wikidata unreachable/); assert.deepEqual([bad.st.result, bad.r.exitCode], ["warning", 0]);
  assert.equal(bad.steps.update.ok, true);
});

test("the heartbeat: plain after a good or warning night, /fail after a failed one, never the address in the log, and a monitor that is down fails nothing", async () => {
  const seen: string[] = [];
  const f = (async (u: URL) => { seen.push(String(u)); return new Response("OK", { status: 200 }); }) as unknown as typeof fetch;
  const ok = await night("ping-ok", { ping: "https://hc.example/ping/secret-uuid", pingFetch: f });
  assert.deepEqual(seen, ["https://hc.example/ping/secret-uuid"]); assert.match(ok.log, /heartbeat: heartbeat sent \(success\)/); assert.ok(!ok.log.includes("secret-uuid"), "the address is never printed");
  seen.length = 0;
  const bad = await night("ping-fail", { ping: "https://hc.example/ping/secret-uuid", pingFetch: f, update: "process.exit(2)" });
  assert.deepEqual([bad.st.result, bad.r.exitCode], ["failed", 2]); assert.deepEqual(seen, ["https://hc.example/ping/secret-uuid/fail"]);
  const down = await night("ping-down", { ping: "https://hc.example/ping/secret-uuid", pingFetch: (async () => { throw new Error("offline"); }) as unknown as typeof fetch });
  assert.deepEqual([down.st.result, down.r.exitCode], ["ok", 0]); assert.match(down.log, /heartbeat: the monitor could not be reached/);
});

test("pingMonitor: nothing without an address, nothing after an interrupted night, https only, and a monitor's error is reported not thrown", async () => {
  const f = (async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
  assert.equal((await pingMonitor(null, "ok", f)).outcome, "skipped");
  assert.equal((await pingMonitor("https://hc.example/x", "interrupted", f)).outcome, "skipped");
  assert.equal((await pingMonitor("http://hc.example/x", "ok", f)).outcome, "failed");
  assert.equal((await pingMonitor("not a url", "ok", f)).outcome, "failed");
  assert.match((await pingMonitor("https://hc.example/x", "ok", f)).note, /answered 500/);
});
