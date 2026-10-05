import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { DEFAULT_DATABASE, isConfirmation, loadPlan } from "../lib/vendor-load";
import { writeKeyFile } from "../lib/vendor-fetch";
import { degradeWorld, makeWorld, serveMockVendor } from "../lib/vendor-mock";

/** `npm run vendor:load` (round 88): the load, guided: the check first, a typed confirmation, then the load. */
test("the plan: the real cache's policy by default, replaced by the other answers, and the owner's storage statement is never assumed", () => {
  const p = loadPlan([], {}, "/cache");
  assert.equal(p.database, DEFAULT_DATABASE); assert.equal(p.droppedFile, path.join(path.dirname(DEFAULT_DATABASE), "dropped.csv")); assert.equal(p.disputedFile, path.join(path.dirname(DEFAULT_DATABASE), "disputed.csv"));
  assert.deepEqual(p.checkArgs.slice(0, 4), ["--check", "--explain-conflicts", "--show", "3"]);
  assert.ok(p.loadArgs.includes("--keep-disputed") && p.loadArgs.includes("--allow-partial") && !p.loadArgs.includes("--check") && !p.loadArgs.includes("--drop-conflicts"), "conflicted fighters stay, marked");
  assert.ok(p.loadArgs.includes("--disputed-file") && !p.loadArgs.includes("--dropped-file"));
  const drop = loadPlan(["--drop-conflicts"], {}, "/cache").loadArgs;
  assert.ok(drop.includes("--drop-conflicts") && !drop.includes("--keep-disputed") && drop.includes("--dropped-file") && !drop.includes("--disputed-file"), "dropping them is still one flag away");
  assert.match(p.refusal ?? "", /written confirmation.*BOXING_API_STORAGE_CONFIRMED=1.*--storage-confirmed/);
  assert.equal(loadPlan(["--storage-confirmed"], {}, "/cache").refusal, null);
  assert.equal(loadPlan([], { BOXING_API_STORAGE_CONFIRMED: "1" }, "/cache").refusal, null);
  assert.match(loadPlan(["--storage-confirmed"], { BOXING_API_STORAGE_CONFIRMED: "0" }, "/cache").refusal ?? "", /switches storing off/, "an explicit =0 wins");
  const own = loadPlan(["--complete-only"], { DATABASE_PATH: "/x/y.db" }, undefined);
  assert.equal(own.database, "/x/y.db"); assert.ok(!own.loadArgs.includes("--keep-disputed") && !own.loadArgs.includes("--allow-partial"), "--complete-only replaces the policy");
  assert.ok(!loadPlan(["--allow-conflicts"], {}, "/c").loadArgs.includes("--keep-disputed"));
  const tuned = loadPlan(["--per-hour", "450", "--cache-dir", "/mine", "--dry-run", "--yes", "--storage-confirmed"], {}, "/cache").loadArgs;
  assert.ok(tuned.includes("450") && !tuned.includes("400") && tuned.filter((a) => a === "--cache-dir").length === 1 && tuned.includes("/mine"));
  assert.ok(!tuned.some((a) => ["--dry-run", "--yes", "--storage-confirmed"].includes(a)), "the wrapper's own flags are not passed on");
  assert.equal(isConfirmation("LOAD"), true); assert.equal(isConfirmation(" LOAD \n"), true);
  for (const no of ["load", "yes", "y", "LOAD IT", "", "Load"]) assert.equal(isConfirmation(no), false, no);
});

const run = (args: string[], env: Record<string, string>) => new Promise<{ code: number | null; out: string }>((resolve) => {
  const c = spawn(process.execPath, ["--import", "tsx", "scripts/vendor-load.ts", ...args], { cwd: path.resolve(__dirname, ".."), env: { ...process.env, BOXING_API_KEY: "", BOXING_API_STORAGE_CONFIRMED: "", RINGSIDE_NO_SEED: "1", ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let out = ""; c.stdout.on("data", (d) => (out += d)); c.stderr.on("data", (d) => (out += d));
  c.on("close", (code) => resolve({ code, out }));
});

test("end to end on a stand-in vendor: the check is shown, nothing is written without the typed confirmation, and with it the league is loaded and the dropped fighters listed", async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "vload-")), keyFile = path.join(d, ".key"), cache = path.join(d, "cache"), db = path.join(d, "real.db");
  const secret = "load-test-key-" + "q".repeat(36);
  writeKeyFile(keyFile, secret);
  const world = degradeWorld(makeWorld({ fighters: 400, fights: 1500, upcoming: 0, seed: 12 }), { seed: 3, wrongTotals: 6 });
  const vendor = await serveMockVendor(world, { key: secret, offsetLimit: 10_000, beyond: "reject" });
  const base = ["--key-file", keyFile, "--cache-dir", cache, "--per-hour", "3600000", "--gap-ms", "0"];
  const env = { BOXING_API_URL: vendor.url, DATABASE_PATH: db };
  try {
    const refused = await run(base, env);
    assert.equal(refused.code, 1); assert.match(refused.out, /written confirmation that its data may be stored has not been stated/); assert.ok(!fs.existsSync(db) && !fs.existsSync(cache), "nothing written, nothing fetched");
    // a dry run reads only the cache: on an empty one it says so (and sends nothing), and it needs no key file
    const empty = await run(["--cache-dir", cache, "--dry-run", "--per-hour", "3600000"], { ...env, RINGSIDE_KEY_FILE: path.join(d, "no-such-key-file") });
    assert.match(empty.out, /key:      \(not needed: a dry run reads only the cache and makes no request\)/); assert.match(empty.out, /is not in the cache \(--cached-only makes no request\)/); assert.ok(!fs.existsSync(db));
    assert.equal(vendor.stats.requests, 0, "the dry run on an empty cache asked the vendor for nothing");
    // fill the cache the way the owner does (the fetch wrapper), then the dry run shows the whole report from it
    const filled = await new Promise<number | null>((resolve) => { const c = spawn(process.execPath, ["--import", "tsx", "scripts/vendor-fetch.ts", "--key-file", keyFile, "--cache-dir", cache, "--gap-ms", "0", "--per-hour", "3600000", "--no-caffeinate"], { cwd: path.resolve(__dirname, ".."), env: { ...process.env, BOXING_API_URL: vendor.url, RINGSIDE_NO_SEED: "1" }, stdio: "ignore" }); c.on("close", resolve); });
    assert.ok(filled === 0 || filled === 1, `the fetch ends with the check's verdict (1: this league has conflicts the gate would refuse): ${filled}`);
    assert.ok(fs.readdirSync(cache).filter((f) => f.startsWith("v2-fighters-")).length > 300, "the cache holds the fighters");
    const before = vendor.stats.requests;
    const dry = await run([...base, "--storage-confirmed", "--dry-run"], { ...env, RINGSIDE_KEY_FILE: path.join(d, "no-such-key-file") });
    assert.equal(vendor.stats.requests, before, "the dry run made no request");
    assert.match(dry.out, /vendor:load[\s\S]*database: .*real\.db  \(new\)/); assert.match(dry.out, /step 1: the check/); assert.match(dry.out, /--keep-disputed: \d+ fighter\(s\) whose loaded fights come to more than the vendor's career total are kept and marked/); assert.match(dry.out, /^why the \d+ conflict/m);
    assert.match(dry.out, /--dry-run: stopped after the check/); assert.ok(!fs.existsSync(db), "a dry run writes no database");
    assert.ok(!dry.out.includes(secret), "the key is never printed");
    const noTty = await run([...base, "--storage-confirmed"], env);
    assert.equal(noTty.code, 1); assert.match(noTty.out, /not an interactive terminal.*--yes.*Nothing was loaded/); assert.ok(!fs.existsSync(db));
    const loaded = await run([...base, "--storage-confirmed", "--yes"], env);
    assert.equal(loaded.code, 0, loaded.out.slice(-800)); assert.match(loaded.out, /step 2: the load/); assert.match(loaded.out, /Loaded into .*real\.db\. Next: docs\/real-data-runbook\.md section 4/);
    assert.ok(fs.existsSync(db), "the database exists");
    const { DatabaseSync } = await import("node:sqlite");
    const x = new DatabaseSync(db, { readOnly: true });
    const n = (x.prepare("SELECT COUNT(*) c FROM boxers").get() as { c: number }).c; x.close();
    const listed = fs.readFileSync(path.join(d, "disputed.csv"), "utf8").trim().split("\n").length - 1;
    const marks = new DatabaseSync(db, { readOnly: true }); const marked = (marks.prepare("SELECT COUNT(*) c FROM boxers WHERE record_disputed = 1").get() as { c: number }).c; marks.close();
    assert.ok(n > 300 && listed >= 1 && listed <= 6, `${n} fighters loaded, ${listed} kept and marked as disputed`);
    assert.equal(marked, listed, "every listed fighter is marked in the database, and nobody else");
    assert.ok(!fs.existsSync(path.join(d, "dropped.csv")), "nobody was dropped");
  } finally { await vendor.close(); }
});
