import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { writeKeyFile } from "../lib/vendor-fetch";
import { makeWorld, serveMockVendor } from "../lib/vendor-mock";

/**
 * The runbook's preview recipe (round 118): while a fetch holds the key's lock, `vendor:load --cached-only` into a SECOND database file works (it reads the cache only and
 * needs neither the key's lock nor the allowance), and the real database is not touched. Without --cached-only the same load is refused for the lock: that is why the
 * recipe has the flag.
 */
const root = path.resolve(__dirname, "..");
const go = (script: string, args: string[], env: Record<string, string>) => new Promise<{ code: number | null; out: string }>((resolve) => {
  const c = spawn(process.execPath, ["--import", "tsx", script, ...args], { cwd: root, env: { ...process.env, BOXING_API_KEY: "", BOXING_API_STORAGE_CONFIRMED: "", RINGSIDE_NO_SEED: "1", ...env } });
  let out = ""; c.stdout.on("data", (d) => (out += d)); c.stderr.on("data", (d) => (out += d));
  c.on("close", (code) => resolve({ code, out }));
});

test("the preview recipe: with a fetch holding the lock, a cached-only load into a second database works and leaves the real one alone", async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "vpreview-")), keyFile = path.join(d, ".key"), cache = path.join(d, "cache"), real = path.join(d, "real.db"), preview = path.join(d, "preview.db"), locks = path.join(d, "locks");
  const secret = "preview-test-key-" + "k".repeat(33);
  writeKeyFile(keyFile, secret);
  fs.mkdirSync(locks);
  const vendor = await serveMockVendor(makeWorld({ fighters: 120, fights: 400, upcoming: 0, seed: 4 }), { key: secret, offsetLimit: 10_000, beyond: "reject" });
  const base = ["--key-file", keyFile, "--cache-dir", cache, "--per-hour", "3600000", "--gap-ms", "0"];
  try {
    const fetched = await go("scripts/vendor-fetch.ts", [...base, "--no-caffeinate"], { BOXING_API_URL: vendor.url, DATABASE_PATH: real, RINGSIDE_LOCK_DIR: locks });
    assert.ok(fetched.code === 0 || fetched.code === 1, fetched.out.slice(-500));
    // a fetch is "running": its lock file, held by this (live) process
    const lockFile = path.join(locks, `ringside-backfill-${crypto.createHash("sha256").update(secret).digest("hex").slice(0, 12)}.lock`);
    fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), command: "the fetch" }));
    const env = { BOXING_API_URL: vendor.url, RINGSIDE_LOCK_DIR: locks };
    const refused = await go("scripts/vendor-load.ts", [...base, "--storage-confirmed", "--yes"], { ...env, DATABASE_PATH: preview });
    assert.notEqual(refused.code, 0, "without --cached-only the lock is in the way");
    assert.match(refused.out, /Another backfill is already running/);
    assert.ok(!fs.existsSync(preview), "and nothing was written");
    const loaded = await go("scripts/vendor-load.ts", [...base, "--storage-confirmed", "--cached-only", "--yes"], { ...env, DATABASE_PATH: preview });
    assert.equal(loaded.code, 0, loaded.out.slice(-1200));
    assert.match(loaded.out, /The audit passed/);
    assert.ok(fs.existsSync(preview) && !fs.existsSync(real), "the preview file exists and the real database was never made");
    const x = new DatabaseSync(preview, { readOnly: true });
    try { assert.ok((x.prepare("SELECT COUNT(*) n FROM boxers").get() as { n: number }).n > 50, "the league is in it"); } finally { x.close(); }
    assert.ok(!loaded.out.includes(secret), "the key is nowhere in the output");
    assert.ok(fs.existsSync(lockFile), "the fetch's lock was not taken or removed");
  } finally { await vendor.close(); fs.rmSync(d, { recursive: true, force: true }); }
});
