import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { DAY0, DAY1, KEY, ROOT, copyDb, makeLeague, nextDay, serveFaulty, start, state, tmp } from "./update-failures-helpers";

/**
 * The nightly job is `npm run vendor:fetch -- --update` (docs/load-day.md step 8), which reads the key file and runs `vendor:backfill -- --update`. update-failures.test.ts
 * drives vendor:backfill directly; this one goes through vendor:fetch itself, once for a healthy night and once for a vendor that is down, so the wrapper cron runs is covered too
 * (the key file is read, the update is applied, and a failed night exits non-zero with the database untouched).
 */
const work = tmp("wrapper");
after(() => fs.rmSync(work, { recursive: true, force: true }));

function viaFetch(db: string, lockDir: string, url: string, cacheDir: string, keyFile: string): Promise<{ code: number | null; out: string }> {
  const clean = { ...process.env } as Record<string, string | undefined>;
  for (const k of ["BOXING_PROVIDER", "VENDOR_RANKINGS_CONFIRMED", "BOXING_API_PER_HOUR", "MEDIA_RESOLVER", "BOXING_API_KEY"]) delete clean[k];
  const child = spawn(process.execPath, ["--import", "tsx", "scripts/vendor-fetch.ts", "--update", "--key-file", keyFile, "--cache-dir", cacheDir, "--gap-ms", "0", "--retries", "0", "--patience-min", "0", "--per-hour", "3600000"], {
    cwd: ROOT, stdio: ["ignore", "pipe", "pipe"],
    env: { ...clean, BOXING_API_URL: url, DATABASE_PATH: db, ACCOUNTS_DB_PATH: path.join(path.dirname(db), "accounts.db"), RINGSIDE_LOCK_DIR: lockDir, BOXING_API_STORAGE_CONFIRMED: "1", RINGSIDE_NO_SEED: "1", RINGSIDE_NOW: DAY1 } as unknown as NodeJS.ProcessEnv,
  });
  let out = "";
  child.stdout!.on("data", (d) => (out += d)); child.stderr!.on("data", (d) => (out += d));
  return new Promise((resolve) => child.on("close", (code) => resolve({ code, out })));
}

test("vendor:fetch -- --update applies a healthy night, and a night with the vendor down exits non-zero and leaves the data as it was", async () => {
  const w0 = makeLeague(), { world: w1 } = nextDay(w0);
  const tpl = path.join(work, "template.db");
  const v0 = await serveFaulty(w0);
  const first = await start(["--cache-dir", path.join(work, "c0"), "--allow-partial", "--keep-disputed"], { db: tpl, url: v0.url, lockDir: path.join(work, "l0"), now: DAY0 }).wait();
  await v0.close();
  assert.equal(first.code, 0, first.out);
  const x = new DatabaseSync(tpl); x.exec("PRAGMA wal_checkpoint(TRUNCATE)"); x.close();
  const base = state(tpl);
  const keyFile = path.join(work, "key");
  fs.writeFileSync(keyFile, KEY + "\n", { mode: 0o600 });

  // the vendor is down: the wrapper exits non-zero, says so in words, and the database is exactly as it was
  const down = copyDb(tpl, "down");
  const dead = await serveFaulty(w1, { fault: () => ({ status: 503, body: { error: "unavailable" } }) });
  const bad = await viaFetch(down.db, down.lockDir, dead.url, path.join(down.dir, "cache"), keyFile);
  await dead.close();
  assert.notEqual(bad.code, 0, bad.out);
  assert.doesNotMatch(bad.out, new RegExp(KEY), "the key is never printed");
  assert.equal(state(down.db).hash, base.hash, "a failed night changes nothing");

  // a healthy night: applied
  const ok = copyDb(tpl, "ok"), v1 = await serveFaulty(w1);
  const good = await viaFetch(ok.db, ok.lockDir, v1.url, path.join(ok.dir, "cache"), keyFile);
  await v1.close();
  assert.equal(good.code, 0, good.out);
  const after = state(ok.db);
  assert.equal(after.counts.bouts, base.counts.bouts + 1, "the fight that finished is in");
  assert.equal(after.integrity, "ok");
  assert.doesNotMatch(good.out, new RegExp(KEY), "the key is never printed");
});
