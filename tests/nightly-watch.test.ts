import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runNightly } from "../lib/nightly";
import { isDue, parseWatchSources } from "../lib/watch/schedule";
import { makeTemplate, makeVolume, readStatusFile } from "./nightly-helpers";

/**
 * The nightly job's optional "watch" step (PLAN 253, step C). What must hold: nothing is watched unless WATCH_SOURCES says so; a source is looked at on the days it is
 * due (weekly means Mondays, UTC); a failed or refused look is a WARNING in the status and never fails the night, never stops the update that ran before it and never
 * skips the off-host copy after it; and a bad entry in the setting is reported and skipped, not a reason to stop.
 */
const work = fs.mkdtempSync(path.join(os.tmpdir(), "nightly-watch-"));
let tpl = "";
before(async () => { tpl = await makeTemplate(work); });
after(() => fs.rmSync(work, { recursive: true, force: true }));
const node = (code: string) => ({ file: process.execPath, args: ["-e", code] });
const OK_UPDATE = node("console.log('loaded: 0 events')");
const MONDAY = new Date("2026-10-05T03:00:00Z"), TUESDAY = new Date("2026-10-06T03:00:00Z");

async function night(name: string, o: { watch?: string; watchCode?: string; update?: { file: string; args: string[] }; now?: Date; offsite?: string; watchTimeoutMs?: number }) {
  const v = makeVolume(tpl, `w-${name}`);
  const log: string[] = [];
  const r = await runNightly({
    env: { DATABASE_PATH: v.db, ACCOUNTS_DB_PATH: v.accounts, BOXING_API_KEY: "test-key-not-real", RINGSIDE_LOCK_DIR: v.lockDir },
    settings: { WATCH_SOURCES: o.watch, NIGHTLY_OFFSITE_CMD: o.offsite },
    lockDir: v.lockDir, now: () => o.now ?? MONDAY, log: (l) => log.push(l),
    updateCommand: o.update ?? OK_UPDATE,
    watchCommand: o.watchCode ? () => node(o.watchCode!) : undefined, watchTimeoutMs: o.watchTimeoutMs,
  });
  const st = readStatusFile(v);
  const steps = Object.fromEntries(st.steps.map((s) => [s.name, s]));
  return { r, st, steps, log: log.join("\n") };
}

test("the setting: names, frequencies, unknown and malformed entries, repeats", () => {
  assert.deepEqual(parseWatchSources(undefined).watched, []);
  assert.deepEqual(parseWatchSources("champions").watched, [{ id: "wikipedia:champions", every: "nightly" }]);
  assert.deepEqual(parseWatchSources(" wikipedia:champions:weekly ").watched, [{ id: "wikipedia:champions", every: "weekly" }], "the full id, with its own colon, and a frequency");
  assert.deepEqual(parseWatchSources("wikipedia:champions").watched, [{ id: "wikipedia:champions", every: "nightly" }]);
  const p = parseWatchSources("champions:weekly, boxrec, champions:monthly, champions:nightly, :weekly");
  assert.deepEqual(p.watched, [{ id: "wikipedia:champions", every: "weekly" }], "the first entry for a source wins");
  assert.equal(p.warnings.length, 3);
  assert.match(p.warnings.join("\n"), /no such source "boxrec"/);
  assert.match(p.warnings.join("\n"), /champions:monthly" is not source or source:nightly or source:weekly/);
  assert.ok(isDue({ id: "x", every: "nightly" }, TUESDAY));
  assert.ok(isDue({ id: "x", every: "weekly" }, MONDAY)); assert.ok(!isDue({ id: "x", every: "weekly" }, TUESDAY));
});

test("nothing is watched unless WATCH_SOURCES says so: no step, same result as before", async () => {
  const n = await night("off", {});
  assert.equal(n.steps.watch, undefined);
  assert.deepEqual([n.st.result, n.r.exitCode], ["ok", 0]);
});

test("a source that is due is looked at after the update and its summary is kept", async () => {
  const n = await night("ok", { watch: "champions", watchCode: "console.log('wikipedia:champions: 129 rows compared, 2 difference(s)'); console.log('  proposals: 2 new, 0 updated, 0 already pending, 0 rejected before and unchanged, 0 no longer true')" });
  assert.equal(n.steps.watch.ok, true);
  assert.equal(n.steps.watch.exitCode, 0);
  assert.match(n.steps.watch.message, /champions: proposals: 2 new/);
  assert.deepEqual(n.st.steps.map((s) => s.name), ["backup", "update", "watch", "offsite"]);
  assert.deepEqual([n.st.result, n.r.exitCode], ["ok", 0]);
});

test("weekly sources wait for Monday, and say so", async () => {
  const tue = await night("tue", { watch: "champions:weekly", watchCode: "process.exit(1)", now: TUESDAY });
  assert.equal(tue.steps.watch.skipped, true); assert.match(tue.steps.watch.message, /nothing due tonight/);
  assert.equal(tue.st.result, "ok");
  const mon = await night("mon", { watch: "champions:weekly", watchCode: "console.log('  proposals: 0 new')", now: MONDAY });
  assert.equal(mon.steps.watch.skipped, undefined); assert.equal(mon.steps.watch.ok, true);
});

test("a refused list (exit 3) and a failed look (exit 1) are warnings: the night is still done, the update stands and the off-host copy still runs", async () => {
  for (const [name, code, want] of [["refused", "console.log('  not proposed from WBC: 40 changes in 70 rows'); process.exit(3)", /a list was refused \(not proposed from WBC/], ["failed", "console.error('Set WIKIMEDIA_CONTACT'); process.exit(1)", /failed \(exit 1\): Set WIKIMEDIA_CONTACT/]] as const) {
    const n = await night(name, { watch: "champions", watchCode: code, offsite: "true" });
    assert.equal(n.st.result, "warning", name); assert.equal(n.r.exitCode, 0, "the night's own exit code is untouched");
    assert.equal(n.steps.watch.ok, false); assert.match(n.steps.watch.message, want);
    assert.equal(n.steps.update.ok, true);
    assert.equal(n.steps.offsite.ok, true); assert.equal(n.steps.offsite.skipped, undefined, "the copy still ran after the watch");
  }
});

test("a failed update does not stop the watch, and does not turn into a warning: the night still fails with the update's code", async () => {
  const n = await night("update-fails", { watch: "champions", watchCode: "console.log('  proposals: 0 new')", update: node("console.log('vendor said no'); process.exit(2)") });
  assert.equal(n.steps.watch.ok, true);
  assert.deepEqual([n.st.result, n.r.exitCode], ["failed", 2]);
});

test("a bad entry in the setting is reported and skipped, and a setting with only bad entries adds no step", async () => {
  const n = await night("bad", { watch: "boxrec,champions:monthly" });
  assert.equal(n.steps.watch, undefined);
  assert.match(n.log, /warning: WATCH_SOURCES: no such source "boxrec"/);
  assert.equal(n.st.result, "ok");
});

test("a look that never ends is stopped and recorded", async () => {
  const n = await night("slow", { watch: "champions", watchCode: "setTimeout(() => {}, 60000)", watchTimeoutMs: 400 });
  assert.equal(n.steps.watch.ok, false); assert.match(n.steps.watch.message, /timed out/);
  assert.deepEqual([n.st.result, n.r.exitCode], ["warning", 0]);
});
