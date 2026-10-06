import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { mockVendor, type MockFight, type MockOptions, type MockWorld } from "../lib/vendor-mock";

/**
 * Helpers for tests/update-failures.test.ts: a small league, a stand-in vendor that can be made to fail in every way a real one does, the real daily-update
 * command run against it on a temp-dir database, and a few ways to say "the database is exactly as it was" or "exactly as a clean update leaves it".
 * Nothing here touches ~/ringside-real, a real key or a real vendor: every path is a fresh directory under the OS temp folder.
 */
export const ROOT = path.resolve(__dirname, "..");
export const KEY = "update-failures-key-0123456789abcdef0123456789";
export const DAY0 = "2026-10-03"; // the day of the first load
export const DAY1 = "2026-10-04"; // the day of the update

const DIVS = ["Lightweight", "Welterweight", "Middleweight", "Heavyweight"];
const day = (iso: string, n: number) => new Date(Date.parse(iso) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * A league whose every record adds up and in which no two fighters meet twice (so nothing is merged): four blocks of 15 fighters, one division per block, 130 fights in
 * the last 14 days (two list pages for the update), 40 older ones the update never asks for, and 3 fights to come.
 */
export function makeLeague(): MockWorld {
  const fighters = new Map<string, { id: string; name: string; birthYear: number; division: string; country: string }>();
  for (let i = 0; i < 60; i++) fighters.set(`f${i}`, { id: `f${i}`, name: `Fighter ${i}`, birthYear: 1985 + (i % 15), division: DIVS[Math.floor(i / 15)], country: ["Mexico", "Japan", "Ukraine", "Nigeria"][i % 4] });
  const fights: MockFight[] = [];
  const careers = new Map<string, { wins: number; losses: number; draws: number }>();
  const career = (id: string) => careers.get(id) ?? careers.set(id, { wins: 0, losses: 0, draws: 0 }).get(id)!;
  const add = (i: number, a: string, b: string, date: string, coming: boolean) => {
    const r = i % 7;
    const f: MockFight = { id: `x${i}`, date, a, b, status: coming ? "NOT_STARTED" : "FINISHED", winner: coming ? null : r === 6 ? null : r % 2 ? "a" : "b", outcome: coming ? null : r === 6 ? "UD" : r === 0 ? "KO" : "UD", round: !coming && r === 0 ? 3 + (i % 8) : null, division: fighters.get(a)!.division, event: `e${date}-${i % 5}` };
    fights.push(f);
    if (!coming) { if (f.winner === "a") { career(a).wins++; career(b).losses++; } else if (f.winner === "b") { career(b).wins++; career(a).losses++; } else { career(a).draws++; career(b).draws++; } }
  };
  let i = 0;
  const pair = (n: number) => { const block = n % 4, k = 1 + Math.floor(n / 60), a = block * 15 + (n % 15), b = block * 15 + ((n % 15) + k) % 15; return [`f${a}`, `f${b}`] as const; };
  // older: pairs with k = 4..6 so they never repeat a recent pair; recent: k = 1..3
  for (let n = 0; n < 40; n++) { const a = (n % 4) * 15 + (n % 15), b = (n % 4) * 15 + ((n % 15) + 4 + Math.floor(n / 15)) % 15; add(i++, `f${a}`, `f${b}`, day(DAY0, -(60 + n * 3)), false); }
  for (let n = 0; n < 130; n++) { const [a, b] = pair(n); add(i++, a, b, day(DAY0, -(1 + (n % 13))), false); }
  for (let n = 0; n < 3; n++) add(i++, `f${n * 15 + 3}`, `f${n * 15 + 9}`, day(DAY0, 14 + n * 7), true);
  return { today: DAY0, fighters, fights, careers };
}

/** The same league a day later: one fight finished that evening (so one card, two records and two ratings change). Returns the world and the fight. */
export function nextDay(w: MockWorld): { world: MockWorld; fight: MockFight } {
  const fight: MockFight = { id: "n1", date: DAY0, a: "f0", b: "f7", status: "FINISHED", winner: "a", outcome: "KO", round: 4, division: "Lightweight", event: "e-night-n1" };
  const careers = new Map([...w.careers].map(([k, v]) => [k, { ...v }]));
  careers.get("f0")!.wins++; careers.get("f7")!.losses++;
  return { world: { ...w, today: DAY1, fights: [...w.fights, fight], careers }, fight };
}

// ---- a vendor that fails ----

export interface Ctx { /** nth request of the run (1-based) */ n: number; /** nth request to this path (1-based) */ nth: number; path: string; q: URLSearchParams }
export type Reply =
  | { status: number; headers?: Record<string, string>; body?: unknown }
  | { raw: string; status?: number; type?: string }
  | { destroy: true }
  | { cutAfter: number }
  | { truncateJson: number }
  | { hang: true }
  | { delayMs: number };
export interface FaultyOptions extends MockOptions {
  fault?: (c: Ctx) => Reply | undefined;
  /** change the JSON the vendor sends (a fighter with a field gone, a result of a kind nobody has seen) */
  mutate?: (c: Ctx, json: any) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
  key?: string;
}

/** The stand-in vendor behind a real local port, with the faults of `fault` and `mutate` laid over its normal answers. */
export async function serveFaulty(world: MockWorld, o: FaultyOptions = {}) {
  const v = mockVendor(world, o);
  const log: string[] = [];
  const perPath = new Map<string, number>();
  const sockets = new Set<net.Socket>();
  let n = 0;
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url ?? "/", "http://mock");
    const p = u.pathname.startsWith("/v2/fighters/") ? "/v2/fighters/*" : u.pathname;
    const ctx: Ctx = { n: ++n, nth: (perPath.set(p, (perPath.get(p) ?? 0) + 1), perPath.get(p)!), path: u.pathname, q: u.searchParams };
    log.push(`${ctx.n} ${u.pathname}${u.search}`);
    const send = (status: number, body: string, headers: Record<string, string> = {}, type = "application/json") => { res.writeHead(status, { "content-type": type, ...headers }); res.end(body); };
    if (o.key && req.headers["x-rapidapi-key"] !== o.key) return send(403, JSON.stringify({ message: "Invalid API key." }));
    let f = o.fault?.(ctx);
    if (f && "delayMs" in f) { await new Promise((r) => setTimeout(r, (f as { delayMs: number }).delayMs)); f = undefined; }
    if (f) {
      if ("hang" in f) return; // never answers
      if ("destroy" in f) return void req.socket.destroy();
      if ("raw" in f) return send(f.status ?? 200, f.raw, {}, f.type ?? "text/html");
      if ("status" in f) return send(f.status, typeof f.body === "string" ? f.body : JSON.stringify(f.body ?? { message: "failure" }), f.headers);
    }
    const r = v.handle(req.url ?? "/");
    let body = r.body;
    if (o.mutate && r.status === 200) body = o.mutate(ctx, JSON.parse(JSON.stringify(body)));
    const text = JSON.stringify(body);
    if (f && "cutAfter" in f) { // the headers promise the whole body; the connection dies part way through it
      res.writeHead(200, { "content-type": "application/json", "content-length": String(Buffer.byteLength(text)) });
      res.write(text.slice(0, f.cutAfter));
      setTimeout(() => req.socket.destroy(), 20);
      return;
    }
    if (f && "truncateJson" in f) return send(200, text.slice(0, f.truncateJson)); // a complete HTTP answer whose JSON stops short
    send(r.status, text);
  });
  server.on("connection", (s) => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", () => ok()));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { url, log, stats: v.stats, close: () => new Promise<void>((ok) => { for (const s of sockets) s.destroy(); server.close(() => ok()); }) };
}

// ---- the real command ----

export interface Run { code: number | null; signal: NodeJS.Signals | null; out: string; ms: number; child: ChildProcess }
export interface Env { /** the script to run (default: vendor-backfill; the wrapper is scripts/vendor-fetch.ts) */ script?: string; db: string; url: string; lockDir: string; now?: string; extra?: Record<string, string> }
export const tmp = (tag: string) => fs.mkdtempSync(path.join(os.tmpdir(), `uf-${tag}-`));

/** Starts `vendor:backfill` (the script `vendor:fetch -- --update` runs) against `env`. `wait()` resolves when it ends. */
export function start(args: string[], env: Env): { child: ChildProcess; wait: () => Promise<Run>; output: () => string } {
  const t0 = Date.now();
  const clean = { ...process.env } as Record<string, string | undefined>;
  delete clean.BOXING_PROVIDER; delete clean.VENDOR_RANKINGS_CONFIRMED; delete clean.BOXING_API_PER_HOUR; delete clean.MEDIA_RESOLVER;
  const child = spawn(process.execPath, ["--import", "tsx", env.script ?? "scripts/vendor-backfill.ts", "--gap-ms", "0", ...args], {
    cwd: ROOT, stdio: ["ignore", "pipe", "pipe"],
    env: { ...clean, BOXING_API_KEY: KEY, BOXING_API_URL: env.url, DATABASE_PATH: env.db, ACCOUNTS_DB_PATH: path.join(path.dirname(env.db), "accounts.db"), RINGSIDE_LOCK_DIR: env.lockDir, BOXING_API_STORAGE_CONFIRMED: "1", RINGSIDE_NO_SEED: "1", RINGSIDE_NOW: env.now ?? DAY1, ...env.extra } as unknown as NodeJS.ProcessEnv,
  });
  let out = "";
  child.stdout!.on("data", (d) => (out += d)); child.stderr!.on("data", (d) => (out += d));
  const wait = () => new Promise<Run>((resolve) => child.on("close", (code, signal) => resolve({ code, signal, out, ms: Date.now() - t0, child })));
  return { child, wait, output: () => out };
}

/** The daily job as cron runs it, less the pacing (a real run waits seconds between requests; the stand-in does not need it). */
export const UPDATE = ["--update", "--retries", "0", "--patience-min", "0"];

// ---- looking at a database ----

const TABLES = ["boxers", "events", "bouts", "orgs", "rating_history", "official_rankings"];
export interface State { integrity: string; counts: Record<string, number>; runs: number; hash: string; lastRunAt: string | null }
/** Read-only look at a database file: integrity, row counts, the number of recorded runs and a hash of everything the site shows. */
export function state(file: string): State {
  const db = new DatabaseSync(file); // not read-only: a database a killed process left a write-ahead log for has to be recovered by whoever opens it next
  try {
    const integrity = (db.prepare("PRAGMA integrity_check").all() as { integrity_check: string }[]).map((r) => r.integrity_check).join(";");
    const counts: Record<string, number> = {};
    const h = crypto.createHash("sha1");
    for (const t of TABLES) {
      counts[t] = (db.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as { c: number }).c;
      // the card order (`bouts.position`) is the order the fights happened to arrive in: not something the site shows, and not worth comparing
      const cols = (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name).filter((c) => !(t === "bouts" && c === "position"));
      for (const row of db.prepare(`SELECT ${cols.join(",")} FROM ${t} ORDER BY 1`).iterate()) h.update(JSON.stringify(row));
    }
    const runs = (db.prepare("SELECT COUNT(*) c FROM ingest_runs").get() as { c: number }).c;
    const last = db.prepare("SELECT at FROM ingest_runs ORDER BY id DESC LIMIT 1").get() as { at: string } | undefined;
    return { integrity, counts, runs, hash: h.digest("hex"), lastRunAt: last?.at ?? null };
  } finally { db.close(); }
}

/** A copy of a database file (and nothing else) in a fresh folder, as the starting point of one case. */
export function copyDb(template: string, tag: string): { dir: string; db: string; lockDir: string } {
  const dir = tmp(tag), db = path.join(dir, "real.db");
  fs.copyFileSync(template, db);
  return { dir, db, lockDir: path.join(dir, "locks") };
}

/** Runs `jobs` with at most `n` at a time, keeping the order of the results. */
export async function pool<T>(jobs: (() => Promise<T>)[], n: number): Promise<T[]> {
  const out: T[] = new Array(jobs.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, async () => { while (next < jobs.length) { const i = next++; out[i] = await jobs[i](); } }));
  return out;
}

// ---- in-process pieces ----

export type InProc = { status: number; headers?: Record<string, string>; body?: unknown } | { raw: string } | { throws: unknown } | { cutBody: true } | { hang: true };
/** The stand-in vendor as a `fetch`, for tests that inject the clock and the sleeping: a fault is chosen by request number and path. */
export function faultyFetch(world: MockWorld, fault: (n: number, path: string) => InProc | undefined, o: MockOptions = {}) {
  const v = mockVendor(world, o);
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(String(input)); calls.push(u.pathname);
    const f = fault(calls.length, u.pathname);
    if (f && "throws" in f) throw f.throws;
    if (f && "hang" in f) return new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)));
    if (f && "raw" in f) return new Response(f.raw, { status: 200, headers: { "content-type": "text/html" } });
    if (f && "status" in f) return new Response(JSON.stringify(f.body ?? { message: "failure" }), { status: f.status, headers: f.headers });
    const r = v.handle(String(input));
    if (f && "cutBody" in f) { // the headers arrive, then the connection dies in the middle of the body
      const text = JSON.stringify(r.body);
      return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(text.slice(0, 300))); c.error(new TypeError("terminated")); } }), { status: 200 });
    }
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as typeof fetch;
  return { fetchImpl, calls, stats: v.stats };
}

/** The daily update with no process around it: the same provider, the same ingest, on an open database. */
export async function updateInProcess(db: DatabaseSync, world: MockWorld, o: Record<string, unknown> = {}) {
  const { boxingDataApiProvider } = await import("../lib/providers/boxing-data-api");
  const { ingest } = await import("../lib/ingest");
  const { updateSince } = await import("../lib/vendor-backfill");
  const v = mockVendor(world);
  const p = boxingDataApiProvider({ key: KEY, purpose: "ingest", fetchImpl: v.fetchImpl, rankings: false, since: updateSince(db, process.env.RINGSIDE_NOW!.slice(0, 10)) ?? undefined, retries: 0, gapMs: 0, log: () => {}, sleep: async () => {}, ...o });
  return ingest(db, p, { strict: true });
}

/** Opens a database file the way the app does. */
export function open(file: string): DatabaseSync {
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  return db;
}

/** Every result the database holds: external id to winner and method. */
export function results(file: string): Map<string, string> {
  const db = new DatabaseSync(file);
  try { return new Map((db.prepare("SELECT external_id id, COALESCE(winner_id,'-') || '/' || method m FROM bouts WHERE method IS NOT NULL").all() as { id: string; m: string }[]).map((r) => [r.id, r.m])); } finally { db.close(); }
}
