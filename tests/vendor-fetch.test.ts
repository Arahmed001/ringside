import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fetchArgs, keyFileState, looksLikePlaceholder, readKeyFile, writeKeyFile } from "../lib/vendor-fetch";
import { describeStatus } from "../lib/vendor-status";

/** `npm run vendor:fetch` (round 85): the fetch started with the key read from a file only the owner can read. */
const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), "vfetch-"));
const REAL = "k".repeat(50);

test("the key file: written for its owner only, read back, and refused when other users can read it, empty, or a placeholder", () => {
  const f = path.join(dir(), "sub", ".key");
  writeKeyFile(f, ` ${REAL}\n`);
  assert.equal(fs.statSync(f).mode & 0o777, 0o600, "mode 600");
  assert.equal(readKeyFile(f), REAL);
  assert.deepEqual(keyFileState(f), { exists: true, private: true, length: 50, placeholder: false });
  fs.chmodSync(f, 0o644);
  assert.throws(() => readKeyFile(f), /can be read by other users.*chmod 600/); assert.equal(keyFileState(f).private, false);
  writeKeyFile(f, REAL); // writing again puts the mode back
  assert.equal(fs.statSync(f).mode & 0o777, 0o600);
  assert.throws(() => writeKeyFile(f, "your-key-here"), /The key you entered is not a plausible API key/);
  assert.equal(readKeyFile(f), REAL, "a refused key does not overwrite the good one");
  fs.writeFileSync(f, "  \n", { mode: 0o600 });
  assert.throws(() => readKeyFile(f), /is empty.*--setup/);
  fs.writeFileSync(f, "paste-your-real-key-here\n", { mode: 0o600 });
  assert.throws(() => readKeyFile(f), /the key in it is not a plausible API key.*--setup/); assert.equal(keyFileState(f).placeholder, true);
  assert.throws(() => readKeyFile(path.join(dir(), "missing")), /There is no key file at .*--setup/);
  assert.deepEqual(keyFileState(path.join(dir(), "missing")), { exists: false, private: false, length: 0, placeholder: false });
});

test("placeholder text is recognised, and a real key that merely contains a placeholder word is not", () => {
  for (const p of ["your-key-here", "paste-your-real-key-here", "YOUR_API_KEY_HERE", "xxxxxxxxxxxxxxxxxxxx", "put your key here"]) assert.equal(looksLikePlaceholder(p), true, p);
  for (const real of ["k".repeat(50), "a1b2c3here4d5e6f7g8h9i0j1k2l3m4n5o6p7q8", "sk-0123456789abcdef0123456789abcdef", "HERE" + "9".repeat(40)]) assert.equal(looksLikePlaceholder(real), false, real);
});

test("the key never appears in what is reported", () => {
  const f = path.join(dir(), ".key"); writeKeyFile(f, "sk-super-secret-super-secret-super-secret-1234");
  assert.ok(!JSON.stringify(keyFileState(f)).includes("secret"));
  for (const e of [() => readKeyFile(f)]) { try { assert.ok(e()); } catch (x) { assert.ok(!String(x).includes("secret")); } }
  fs.writeFileSync(f, "bad key with spaces secret-xyz\n", { mode: 0o600 });
  try { readKeyFile(f); assert.fail("should refuse"); } catch (x) { assert.ok(!String((x as Error).message).includes("secret-xyz")); }
});

test("the fetch arguments: paced, patient and checking by default, and anything the user passes wins", () => {
  assert.deepEqual(fetchArgs([], "/c"), ["--check", "--per-hour", "400", "--patience-min", "240", "--cache-dir", "/c"]);
  assert.deepEqual(fetchArgs([], undefined), ["--check", "--per-hour", "400", "--patience-min", "240"], "no known cache folder: the backfill's own default");
  assert.deepEqual(fetchArgs(["--per-hour", "450", "--cache-dir", "/x"], "/c"), ["--check", "--patience-min", "240", "--per-hour", "450", "--cache-dir", "/x"]);
  assert.deepEqual(fetchArgs(["--fighters", "5000"], "/c").slice(-2), ["--fighters", "5000"]);
  assert.ok(!fetchArgs(["--no-check", "--drop-conflicts", "--allow-partial"], "/c").includes("--check") && !fetchArgs(["--no-check"], "/c").includes("--no-check"), "--no-check is for the load: no --check, and the flag itself is not passed on");
  assert.ok(!fetchArgs(["--plan"], "/c").includes("--check") && !fetchArgs(["--update"], "/c").includes("--check"), "a plan or an update is not turned into a check");
});

test("vendor:status points at the key file: set it up, or start the fetch from it", () => {
  const cache = { fighters: 11000, listPages: 477, rankingPages: 0, staleTemp: 0, newest: null, fightersLastHour: 380, fightersLast6Hours: 2280 };
  const base = { cacheDir: "/c", cache, total: 35000, running: [], storageConfirmed: "1", databasePath: "/db" };
  const none = describeStatus({ ...base, key: { set: false, length: 0, placeholder: false }, keyFile: { exists: false, private: false, length: 0, placeholder: false } }).join("\n");
  assert.match(none, /key file: none/); assert.match(none, /save the key once, in a real terminal tab.*vendor:fetch -- --setup/);
  const ready = describeStatus({ ...base, key: { set: false, length: 0, placeholder: false }, keyFile: { exists: true, private: true, length: 50, placeholder: false } }).join("\n");
  assert.match(ready, /key file: ready \(50 characters/); assert.match(ready, /start the paced fetch.*npm run vendor:fetch\b/);
  const open = describeStatus({ ...base, key: { set: false, length: 0, placeholder: false }, keyFile: { exists: true, private: false, length: 50, placeholder: false } }).join("\n");
  assert.match(open, /other users can read it/); assert.match(open, /save the key once/, "an unsafe file is not used");
  const running = describeStatus({ ...base, running: [{ pid: 1, startedAt: "2026-10-05T00:00:00Z", command: "" }], key: { set: false, length: 0, placeholder: false }, keyFile: { exists: true, private: true, length: 50, placeholder: false } }).join("\n");
  assert.match(running, /leave it running/);
});

import { spawnSync, spawn } from "node:child_process";
import { makeWorld, serveMockVendor } from "../lib/vendor-mock";

const runFetch = (args: string[], env: Record<string, string> = {}) => new Promise<{ code: number | null; out: string }>((resolve) => {
  const c = spawn(process.execPath, ["--import", "tsx", "scripts/vendor-fetch.ts", ...args], { cwd: path.resolve(__dirname, ".."), env: { ...process.env, BOXING_API_KEY: "", ...env, RINGSIDE_NO_SEED: "1" }, stdio: ["ignore", "pipe", "pipe"] });
  let out = ""; c.stdout.on("data", (d) => (out += d)); c.stderr.on("data", (d) => (out += d));
  c.on("close", (code) => resolve({ code, out }));
});

test("the wrapper end to end on a stand-in vendor: it reads the key from the file, fetches into the cache without printing the key; without a key file it says how to make one; --setup refuses a chat box", async () => {
  const d = dir(), keyFile = path.join(d, ".key"), cache = path.join(d, "cache");
  const secret = "wrapper-test-key-" + "z".repeat(33);
  writeKeyFile(keyFile, secret);
  const vendor = await serveMockVendor(makeWorld({ fighters: 30, fights: 60, upcoming: 0, seed: 4 }), { key: secret, offsetLimit: 10_000, beyond: "reject" });
  try {
    const r = await runFetch(["--key-file", keyFile, "--cache-dir", cache, "--gap-ms", "0", "--per-hour", "3600000", "--no-caffeinate"], { BOXING_API_URL: vendor.url });
    assert.equal(r.code, 0, r.out.slice(-600));
    assert.match(r.out, /vendor:fetch: key from .* \(50 characters\), vendor:backfill --check --patience-min 240 --gap-ms 0 --per-hour 3600000 --cache-dir /);
    assert.ok(!r.out.includes(secret), "the key is never printed");
    assert.ok(fs.readdirSync(cache).filter((f) => f.startsWith("v2-fighters-")).length > 10, "the fighters are in the cache");
    // the same key file, a second run, nothing new to fetch: the cache answers
    const again = await runFetch(["--key-file", keyFile, "--cache-dir", cache, "--gap-ms", "0", "--per-hour", "3600000", "--no-caffeinate"], { BOXING_API_URL: vendor.url });
    assert.equal(again.code, 0); assert.match(again.out, /0 request\(s\) made/);
  } finally { await vendor.close(); }
  const none = await runFetch(["--key-file", path.join(d, "missing")]);
  assert.equal(none.code, 1); assert.match(none.out, /There is no key file at .*vendor:fetch -- --setup/);
  const setup = await runFetch(["--setup", "--key-file", path.join(d, "never")]);
  assert.equal(setup.code, 1); assert.match(setup.out, /--setup needs a real terminal tab/); assert.ok(!fs.existsSync(path.join(d, "never")), "nothing is written");
  void spawnSync;
});

test("--background: the fetch runs detached with its output in a log beside the cache; --stop ends only a live backfill; the status shows the log (round 102)", async () => {
  const { backgroundFiles, backgroundPid, logTail } = await import("../lib/vendor-fetch");
  const { describeStatus } = await import("../lib/vendor-status");
  const d = dir(), keyFile = path.join(d, ".key"), cache = path.join(d, "cache");
  const secret = "background-test-key-" + "q".repeat(30);
  writeKeyFile(keyFile, secret);
  assert.deepEqual(backgroundFiles(cache), { log: path.join(d, "fetch.log"), pid: path.join(d, "fetch.pid") });
  // a quick fetch on a stand-in vendor: the command returns at once with its log written, the key is nowhere in what it says or logs
  const vendor = await serveMockVendor(makeWorld({ fighters: 20, fights: 40, upcoming: 0, seed: 6 }), { key: secret, offsetLimit: 10_000, beyond: "reject" });
  try {
    const r = await runFetch(["--background", "--key-file", keyFile, "--cache-dir", cache, "--gap-ms", "0", "--per-hour", "3600000", "--no-caffeinate", "--bg-check-ms", "15000"], { BOXING_API_URL: vendor.url });
    assert.equal(r.code, 0, r.out.slice(-500)); assert.match(r.out, /already finished|Started in the background/);
    assert.ok(!r.out.includes(secret));
    const log = fs.readFileSync(backgroundFiles(cache).log, "utf8");
    assert.match(log, /background fetch started: vendor:backfill --check/); assert.ok(!log.includes(secret), "the key is not in the log");
    assert.ok(fs.readdirSync(cache).some((f) => f.startsWith("v2-fighters-")), "the fetch ran");
    assert.equal(logTail(backgroundFiles(cache).log, 2).length, 2);
  } finally { await vendor.close(); }
  // --stop: nothing running; a live process that is not a backfill is never touched; a live backfill is ended
  const pidFile = backgroundFiles(cache).pid;
  fs.writeFileSync(pidFile, "999999\n"); assert.equal(backgroundPid(pidFile), undefined);
  fs.writeFileSync(pidFile, `${process.pid}\n`); assert.equal(backgroundPid(pidFile), undefined, "this process is alive but is not a backfill");
  const none = await runFetch(["--stop", "--cache-dir", cache]); assert.equal(none.code, 0); assert.match(none.out, /No background fetch is running/);
  const fake = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)", "vendor-backfill.fake"], { stdio: "ignore", detached: true });
  try {
    fs.writeFileSync(pidFile, `${fake.pid}\n`);
    assert.equal(backgroundPid(pidFile), fake.pid);
    const stopped = await runFetch(["--stop", "--cache-dir", cache]); assert.equal(stopped.code, 0); assert.match(stopped.out, new RegExp(`Stopped the background fetch \\(process ${fake.pid}\\)`));
    await new Promise((r) => setTimeout(r, 500)); assert.equal(backgroundPid(pidFile), undefined, "it is gone");
  } finally { try { process.kill(fake.pid!, "SIGKILL"); } catch { /* already gone */ } }
  // the status shows the log's last line and points at --background
  const base = { cacheDir: cache, cache: { fighters: 5, listPages: 1, rankingPages: 0, staleTemp: 0, newest: new Date(), fightersLastHour: 0, fightersLast6Hours: 0 }, total: 100, running: [], key: { set: false, length: 0, placeholder: false }, keyFile: { exists: true, private: true, length: 50, placeholder: false }, storageConfirmed: undefined, databasePath: undefined } as unknown as Parameters<typeof describeStatus>[0];
  const lines = describeStatus({ ...base, log: { path: "/x/fetch.log", tail: ["a", "network error: wait"], ageMinutes: 480 } }).join("\n");
  assert.match(lines, /log \/x\/fetch\.log \(8\.0 hours ago\), last line: network error: wait/); assert.match(lines, /vendor:fetch -- --background/);
});
