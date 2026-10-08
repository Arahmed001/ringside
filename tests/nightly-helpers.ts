import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { DAY0, DAY1, KEY, ROOT, makeLeague, serveFaulty, start, tmp } from "./update-failures-helpers";
import { MANIFEST } from "../lib/backup";
import type { NightlyStatus } from "../lib/nightly-status";

/**
 * Helpers for tests/nightly.test.ts: a data volume in a temp folder (the sports database from a first load against the stand-in vendor, a small accounts database,
 * some old backups and things that are not backups), and the real `npm run nightly` script run against it. Nothing here touches a real database, key or vendor,
 * and the network is a port on 127.0.0.1.
 */
export { DAY0, DAY1, KEY, ROOT, makeLeague, serveFaulty, tmp };

/** The first load of the league, once: the template every volume is copied from. */
export async function makeTemplate(work: string): Promise<string> {
  const tpl = path.join(work, "template.db");
  const v = await serveFaulty(makeLeague());
  const first = await start(["--cache-dir", path.join(work, "c0"), "--allow-partial", "--keep-disputed"], { db: tpl, url: v.url, lockDir: path.join(work, "l0"), now: DAY0 }).wait();
  await v.close();
  if (first.code !== 0) throw new Error("the first load failed:\n" + first.out);
  const x = new DatabaseSync(tpl); x.exec("PRAGMA wal_checkpoint(TRUNCATE)"); x.close();
  return tpl;
}

export interface Volume { dir: string; db: string; accounts: string; backups: string; lockDir: string; status: string }
/** A fresh data folder: real.db copied from the template, a minimal accounts.db, and (optionally) a set of old backups and things that must never be pruned. */
export function makeVolume(tpl: string | null, tag: string, o: { oldBackups?: string[]; extras?: boolean } = {}): Volume {
  const dir = tmp(tag), db = path.join(dir, "real.db");
  const v: Volume = { dir, db, accounts: path.join(dir, "accounts.db"), backups: path.join(dir, "backups"), lockDir: path.join(dir, "locks"), status: path.join(dir, "nightly-status.json") };
  if (tpl) fs.copyFileSync(tpl, db);
  const acc = new DatabaseSync(v.accounts);
  for (const t of ["users", "picks", "contributions"]) acc.exec(`CREATE TABLE ${t} (id INTEGER PRIMARY KEY, v TEXT); INSERT INTO ${t} (v) VALUES ('x')`);
  acc.close();
  fs.mkdirSync(v.backups, { recursive: true });
  for (const n of o.oldBackups ?? []) { fs.mkdirSync(path.join(v.backups, n)); fs.writeFileSync(path.join(v.backups, n, "ringside.db"), "old"); fs.writeFileSync(path.join(v.backups, n, MANIFEST), ""); }
  if (o.extras) { // none of these is a backup this tool made
    fs.mkdirSync(path.join(v.backups, "before-restore", "2019-01-01T00-00-00Z"), { recursive: true });
    fs.writeFileSync(path.join(v.backups, "before-restore", "2019-01-01T00-00-00Z", "ringside.db"), "safety copy");
    fs.mkdirSync(path.join(v.backups, "my-handmade-copy")); fs.writeFileSync(path.join(v.backups, "my-handmade-copy", "ringside.db"), "mine");
    fs.writeFileSync(path.join(v.backups, "notes.txt"), "keep me");
  }
  return v;
}

export const stampDirs = (v: Volume) => fs.readdirSync(v.backups).filter((n) => /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z$/.test(n)).sort();
export const readStatusFile = (v: Volume): NightlyStatus => JSON.parse(fs.readFileSync(v.status, "utf8")) as NightlyStatus;

export interface NightlyRun { code: number | null; signal: NodeJS.Signals | null; out: string; ms: number }
export interface RunOpts { url?: string; now?: string; env?: Record<string, string | undefined>; noKey?: boolean }
/** Starts the real `scripts/nightly.ts` against a volume. */
export function startNightly(v: Volume, o: RunOpts = {}): { child: ChildProcess; wait: () => Promise<NightlyRun>; output: () => string } {
  const t0 = Date.now();
  const clean = { ...process.env } as Record<string, string | undefined>;
  for (const k of ["BOXING_PROVIDER", "VENDOR_RANKINGS_CONFIRMED", "BOXING_API_PER_HOUR", "MEDIA_RESOLVER", "BOXING_API_KEY", "NIGHTLY_SCHEDULE", "NIGHTLY_KEEP", "NIGHTLY_OFFSITE_CMD", "NIGHTLY_OFFSITE_TIMEOUT_MIN", "NIGHTLY_NODE_OPTIONS", "NODE_OPTIONS"]) delete clean[k];
  const env: Record<string, string | undefined> = {
    ...clean, ...(o.noKey ? {} : { BOXING_API_KEY: KEY }), BOXING_API_URL: o.url ?? "http://127.0.0.1:9", DATABASE_PATH: v.db, ACCOUNTS_DB_PATH: v.accounts, RINGSIDE_LOCK_DIR: v.lockDir,
    BOXING_API_STORAGE_CONFIRMED: "1", RINGSIDE_NO_SEED: "1", RINGSIDE_NOW: o.now ?? DAY1, RINGSIDE_NIGHTLY_UPDATE_ARGS: "--gap-ms 0 --retries 0 --patience-min 0", ...o.env,
  };
  for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
  const child = spawn(process.execPath, ["--import", "tsx", "scripts/nightly.ts"], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], env: env as unknown as NodeJS.ProcessEnv });
  let out = "";
  child.stdout!.on("data", (d) => (out += d)); child.stderr!.on("data", (d) => (out += d));
  const wait = () => new Promise<NightlyRun>((resolve) => child.on("close", (code, signal) => resolve({ code, signal, out, ms: Date.now() - t0 })));
  return { child, wait, output: () => out };
}

export const nap = (ms: number) => new Promise((r) => setTimeout(r, ms));
export async function until(f: () => boolean, ms = 30_000, what = "the condition") { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) throw new Error(`timed out waiting for ${what}`); await nap(25); } }
export const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
