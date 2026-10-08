/**
 * `npm run post-load`, the parts that run things: a production server on a free port against a COPY of the database, requests timed against it, and a real browser (Playwright,
 * found the way scripts/a11y-run.ts finds it) that opens pages, checks them and takes the screenshots. Nothing here writes to the database the owner pointed the command at:
 * the server and the browser only ever see the copy, and the copy is deleted at the end.
 */
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { summarise } from "./loadtest";
import { DIVISION_NAMES, slugifyDivision } from "./divisions";
import { countrySlug } from "./countries";
import { checkFighterHtml, expectedRecord, seeded, shuffled, shorten, sectionLevel, n, type Career, type Level, type Loaded, type Row, type SampleFighter, type Section, type Block, SAMPLE_GROUPS } from "./post-load";

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// processes

export interface Proc { pid: number; ppid: number; comm: string }
/** The output of `ps -eo pid,ppid,comm`. The name can hold spaces ("next-server (v16.3.8)"), so only the first two columns are split off. */
export function parsePs(out: string): Proc[] {
  const procs: Proc[] = [];
  for (const line of out.split("\n")) { const m = /^\s*(\d+)\s+(\d+)\s+(.*\S)\s*$/.exec(line); if (m) procs.push({ pid: Number(m[1]), ppid: Number(m[2]), comm: m[3] }); }
  return procs;
}
/** The process and everything started under it, parents before children. */
export function descendants(procs: Proc[], root: number): number[] {
  const out = [root];
  for (let i = 0; i < out.length; i++) for (const p of procs) if (p.ppid === out[i] && !out.includes(p.pid)) out.push(p.pid);
  return out;
}
const psAll = (): Proc[] => { try { return parsePs(execFileSync("ps", ["-eo", "pid,ppid,comm"], { encoding: "utf8" })); } catch { return []; } };
export function killTree(root: number, signal: NodeJS.Signals = "SIGTERM"): void {
  for (const pid of descendants(psAll(), root).reverse()) { try { process.kill(pid, signal); } catch { /* already gone */ } }
}
/** Resident memory of a process and its children, in MB (ps reports kilobytes on Linux and macOS). */
export function rssMb(root: number): number {
  const ids = descendants(psAll(), root);
  try { return execFileSync("ps", ["-o", "rss=", "-p", ids.join(",")], { encoding: "utf8" }).split("\n").reduce((s, l) => s + (Number(l.trim()) || 0), 0) / 1024; } catch { return 0; }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const freePort = () => new Promise<number>((resolve, reject) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)); }); s.on("error", reject); });

/** The few settings the app it starts needs from this shell (to find node, a home folder, a time zone): nothing else is passed on, so no key reaches the server or the browser. */
export function minimalEnv(from: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "TZ"]) { const v = from[k]; if (v) out[k] = v; }
  return out;
}

export interface Server { base: string; pid: number; child: ChildProcess; startMs: number; rssAtStartMb: number; health: { fighters: number; bouts: number }; logFile: string; stop: () => Promise<void> }
/** `next start` on a free port, BOXING_PROVIDER=licensed, against `database` (a copy). Resolves when /api/health answers; the time it took is the cold start. */
export async function startServer(o: { root: string; database: string; accounts: string; logFile: string; env: Record<string, string>; timeoutMs?: number }): Promise<Server> {
  const port = await freePort();
  const out = fs.openSync(o.logFile, "a");
  const t0 = performance.now();
  // `-H localhost`, not 127.0.0.1: with an address for a host name this Next.js rewrites every page to a URL on "localhost" and then redirects to it forever (found in the first run); it still listens on this machine only
  const child = spawn(process.execPath, [path.join(o.root, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(port), "-H", "localhost"], {
    cwd: o.root, stdio: ["ignore", out, out], detached: true,
    env: { ...o.env, NODE_ENV: "production", DATABASE_PATH: o.database, ACCOUNTS_DB_PATH: o.accounts, BOXING_PROVIDER: "licensed", RINGSIDE_NO_SEED: "1", NEXT_TELEMETRY_DISABLED: "1", SITE_URL: "https://post-load.invalid" },
  });
  const pid = child.pid!;
  const stop = async () => {
    killTree(pid);
    for (let i = 0; i < 40 && psAll().some((p) => p.pid === pid); i++) await sleep(250);
    if (psAll().some((p) => p.pid === pid)) killTree(pid, "SIGKILL");
    try { fs.closeSync(out); } catch { /* closed */ }
  };
  const base = `http://localhost:${port}`;
  const limit = o.timeoutMs ?? 180_000;
  let lastStatus = 0;
  while (performance.now() - t0 < limit) {
    if (child.exitCode !== null) { await stop(); throw new Error(`the server stopped while starting (exit ${child.exitCode}); the end of its log:\n${tail(o.logFile, 8)}`); }
    try {
      const r = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(5000) });
      lastStatus = r.status;
      if (r.ok) {
        const startMs = performance.now() - t0, j = (await r.json()) as { fighters?: number; bouts?: number };
        return { base, pid, child, startMs, rssAtStartMb: rssMb(pid), health: { fighters: j.fighters ?? 0, bouts: j.bouts ?? 0 }, logFile: o.logFile, stop };
      }
    } catch { /* not up yet */ }
    await sleep(250);
  }
  await stop();
  throw new Error(`the server did not become healthy within ${Math.round(limit / 1000)} s (the last health check answered ${lastStatus || "nothing"}${lastStatus === 503 ? ": the data could not be read, often a warm-up error in its log" : ""}); the end of its log:\n${tail(o.logFile, 8)}`);
}
const tail = (file: string, lines: number): string => { try { return fs.readFileSync(file, "utf8").split("\n").filter((l) => l && !/ExperimentalWarning|trace-warnings/.test(l)).slice(-lines).map((l) => l.slice(0, 300)).join("\n"); } catch { return "(no log)"; } };

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// the machine, so a number can be read with the size of what produced it

export interface Machine { cores: number; cpu: string; ramGb: number; platform: string; node: string; load1Start: number }
export const machine = (): Machine => ({ cores: os.cpus().length, cpu: (os.cpus()[0]?.model ?? "unknown").replace(/\s+/g, " ").trim(), ramGb: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10, platform: `${os.platform()} ${os.arch()}`, node: process.versions.node, load1Start: os.loadavg()[0] });
export const machineLabel = (m: Machine): string => `${m.cores} cores (${m.cpu}), ${m.ramGb} GB RAM, ${m.platform}, Node ${m.node}`;

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// what to ask the server for, taken from the data

export interface Targets { fighters: string[]; events: number[]; bouts: number[]; divisions: string[]; countries: string[]; searches: string[]; top: string; other: string; latestEvent: number | null }
export function gatherTargets(db: DatabaseSync, seed: number): Targets {
  const rng = seeded(seed);
  const all = <T,>(sql: string, ...a: (string | number)[]) => db.prepare(sql).all(...a) as T[];
  const slugs = all<{ slug: string; name: string }>("SELECT slug, name FROM boxers WHERE slug IS NOT NULL ORDER BY id");
  const top = all<{ slug: string }>("SELECT slug FROM boxers ORDER BY rating DESC, id LIMIT 2");
  const fighters = shuffled(slugs, rng).slice(0, 400);
  const events = shuffled(all<{ id: number }>("SELECT id FROM events ORDER BY id"), rng).slice(0, 300).map((e) => e.id);
  const bouts = shuffled(all<{ id: number }>("SELECT id FROM bouts WHERE method IS NOT NULL ORDER BY id LIMIT 20000"), rng).slice(0, 100).map((b) => b.id);
  const have = new Set(all<{ w: string }>("SELECT DISTINCT weight_class w FROM boxers").map((r) => r.w));
  const countries = [...new Set(all<{ country: string }>("SELECT country FROM boxers WHERE country IS NOT NULL AND country <> 'Unknown' GROUP BY country ORDER BY COUNT(*) DESC LIMIT 60").map((r) => countrySlug(r.country)))];
  const latest = db.prepare("SELECT e.id FROM events e WHERE EXISTS (SELECT 1 FROM bouts b WHERE b.event_id = e.id AND b.method IS NOT NULL) ORDER BY e.date DESC LIMIT 1").get() as { id: number } | undefined;
  return {
    fighters: fighters.map((f) => f.slug), events, bouts, divisions: DIVISION_NAMES.filter((d) => have.has(d)).map(slugifyDivision), countries,
    searches: shuffled(fighters.map((f) => f.name.split(/\s+/)[0]).filter((w) => w.length >= 3), rng).slice(0, 60),
    top: top[0]?.slug ?? fighters[0]?.slug ?? "", other: top[1]?.slug ?? fighters[1]?.slug ?? "", latestEvent: latest?.id ?? null,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// the sanity sample, over HTTP

export async function get(url: string, timeoutMs = 60_000): Promise<{ status: number; ms: number; bytes: number; text: string }> {
  const t0 = performance.now();
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: "follow" });
    const b = Buffer.from(await r.arrayBuffer());
    return { status: r.status, ms: performance.now() - t0, bytes: b.length, text: /text|json|xml/.test(r.headers.get("content-type") ?? "") ? b.toString("utf8") : "" };
  } catch { return { status: 0, ms: performance.now() - t0, bytes: 0, text: "" }; }
}

export interface SampleResult { fighter: SampleFighter; expected: string; source: string; problems: string[]; bytes: number; arBytes: number }
export async function checkSampleOverHttp(base: string, sample: SampleFighter[], db: DatabaseSync, loaded: Map<number, Loaded>): Promise<SampleResult[]> {
  const meta = new Map((db.prepare("SELECT id, birth_year, vendor_wins, vendor_losses, vendor_draws, record_disputed FROM boxers").all() as { id: number; birth_year: number | null; vendor_wins: number | null; vendor_losses: number | null; vendor_draws: number | null; record_disputed: number | null }[]).map((r) => [r.id, r]));
  const out: SampleResult[] = [];
  for (const f of sample) {
    const m = meta.get(f.id)!;
    const vendor = [m.vendor_wins, m.vendor_losses, m.vendor_draws].every((x) => typeof x === "number" && x >= 0) ? { wins: m.vendor_wins as number, losses: m.vendor_losses as number, draws: m.vendor_draws as number } : null;
    const career: Career = { loaded: loaded.get(f.id), vendor, disputed: m.record_disputed === 1 };
    const exp = expectedRecord(career);
    const en = await get(`${base}/boxers/${encodeURIComponent(f.slug)}`), ar = await get(`${base}/ar/boxers/${encodeURIComponent(f.slug)}`);
    const problems = checkFighterHtml(en.text, en.status, { record: exp.text, fights: loaded.get(f.id)?.fights ?? 0, hasBirthYear: !!m.birth_year && m.birth_year > 0 });
    const arProblems = checkFighterHtml(ar.text, ar.status, { record: exp.text, fights: 0, hasBirthYear: false }, { arabic: true }).map((p) => `Arabic page: ${p}`);
    if (en.bytes > 1_500_000) problems.push(`page is ${(en.bytes / 1e6).toFixed(1)} MB`);
    out.push({ fighter: f, expected: exp.text, source: exp.source, problems: [...problems, ...arProblems], bytes: en.bytes, arBytes: ar.bytes });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// speed

/** What docs/capacity.md measured, one visitor at a time on two cores, 35,000 synthetic fighters (the table "The slowest routes", column "after", p50 in ms). The test in tests/post-load.test.ts keeps these in step with the document. */
export const CAPACITY_REFERENCE = {
  p50Ms: { home: 44, "fighters list (sorted, paged)": 74, fighter: 69, event: 44, "rankings (a division)": 30, country: 34, search: 11, "share image (fighter)": 221, sitemap: 95 } as Record<string, number>,
  startSeconds: [10.9, 16.5] as [number, number], rssStartGb: 0.65, rssLoadGb: [0.94, 1.06] as [number, number],
  source: "docs/capacity.md (35,000 synthetic fighters, a 4-core shared virtual machine, one visitor at a time on two cores; the start and memory lines are after the memory diet)",
};
export const LIMITS = { startWarnS: 60, startFailS: 120, rssWarnMb: 2048, rssFailMb: 3072, p95WarnMs: 1500, p95FailMs: 5000, pageWarnBytes: 1_000_000, pageFailBytes: 4_000_000 };

export interface KindDef { kind: string; paths: string[] }
export function speedKinds(t: Targets, seed: number): KindDef[] {
  const rng = seeded(seed + 1), sh = <T,>(a: T[]) => shuffled(a, rng);
  const sorts = ["rating", "wins", "name", "bouts", "ko"];
  const defs: KindDef[] = [
    { kind: "home", paths: ["/"] },
    { kind: "fighters list (sorted, paged)", paths: sh(Array.from({ length: 40 }, (_, i) => `/boxers?sort=${sorts[i % sorts.length]}&page=${1 + Math.floor(rng() * 150)}`)) },
    { kind: "fighter", paths: t.fighters.map((s) => `/boxers/${s}`) },
    { kind: "event", paths: t.events.map((id) => `/events/${id}`) },
    { kind: "rankings (a division)", paths: sh(t.divisions.map((d) => `/rankings/${d}`)) },
    { kind: "country", paths: t.countries.map((s) => `/countries/${s}`) },
    { kind: "search", paths: t.searches.map((q) => `/api/search?q=${encodeURIComponent(q)}`) },
    { kind: "share image (fighter)", paths: t.fighters.slice(0, 80).map((s) => `/boxers/${s}/opengraph-image`) },
    { kind: "sitemap", paths: ["/sitemap.xml", "/sitemaps/0.xml"] },
  ];
  return defs.filter((d) => d.paths.length > 0);
}
export interface KindResult { kind: string; coldMs: number; coldStatus: number; serial: ReturnType<typeof summarise>; conc: ReturnType<typeof summarise>; errors: number; avgBytes: number; refP50: number | undefined }
export interface SpeedResult { kinds: KindResult[]; concurrency: number; rssPeakMb: number; load1Start: number; load1End: number; seconds: number }

export async function measureSpeed(base: string, pid: number, kinds: KindDef[], o: { serial: number; concurrent: number; concurrency: number; seed: number }): Promise<SpeedResult> {
  const t0 = performance.now(), load1Start = os.loadavg()[0];
  const cold = new Map<string, { ms: number; status: number }>();
  const cursor = new Map<string, number>(kinds.map((k) => [k.kind, 0]));
  const next = (k: KindDef) => { const i = cursor.get(k.kind)!; cursor.set(k.kind, i + 1); return k.paths[i % k.paths.length]; };
  // the first request of each kind, one after another, straight after the start: what a first visitor pays
  for (const k of kinds) { const r = await get(base + next(k)); cold.set(k.kind, { ms: r.ms, status: r.status }); }
  const serial = new Map<string, number[]>(), errors = new Map<string, number>(), bytes = new Map<string, number[]>();
  const record = (k: string, ok: boolean, b: number) => { if (!ok) errors.set(k, (errors.get(k) ?? 0) + 1); (bytes.get(k) ?? bytes.set(k, []).get(k)!).push(b); };
  for (const k of kinds) { const xs: number[] = []; for (let i = 0; i < o.serial; i++) { const r = await get(base + next(k)); xs.push(r.ms); record(k.kind, r.status === 200, r.bytes); } serial.set(k.kind, xs); }
  // modest concurrency: all kinds mixed in a seeded order, a few visitors asking again the moment they are answered
  const queue = shuffled(kinds.flatMap((k) => Array.from({ length: o.concurrent }, () => k)), seeded(o.seed + 2));
  const conc = new Map<string, number[]>();
  let rssPeak = rssMb(pid);
  const poll = setInterval(() => { rssPeak = Math.max(rssPeak, rssMb(pid)); }, 750);
  const tc = performance.now();
  await Promise.all(Array.from({ length: o.concurrency }, async () => {
    for (let k = queue.shift(); k; k = queue.shift()) { const r = await get(base + next(k)); (conc.get(k.kind) ?? conc.set(k.kind, []).get(k.kind)!).push(r.ms); record(k.kind, r.status === 200, r.bytes); }
  }));
  const concSeconds = (performance.now() - tc) / 1000;
  clearInterval(poll);
  rssPeak = Math.max(rssPeak, rssMb(pid));
  const results = kinds.map((k): KindResult => {
    const b = bytes.get(k.kind) ?? [];
    return { kind: k.kind, coldMs: cold.get(k.kind)!.ms, coldStatus: cold.get(k.kind)!.status, serial: summarise(serial.get(k.kind) ?? [], 1), conc: summarise(conc.get(k.kind) ?? [], concSeconds), errors: errors.get(k.kind) ?? 0, avgBytes: b.length ? b.reduce((s, x) => s + x, 0) / b.length : 0, refP50: CAPACITY_REFERENCE.p50Ms[k.kind] };
  });
  return { kinds: results, concurrency: o.concurrency, rssPeakMb: rssPeak, load1Start, load1End: os.loadavg()[0], seconds: (performance.now() - t0) / 1000 };
}

const ms0 = (x: number) => (Number.isFinite(x) ? `${Math.round(x)}` : "-");
export function speedSection(s: Server, r: SpeedResult | null, m: Machine, why?: string): Section {
  if (!r) return { id: "speed", number: 4, title: "Speed at real size", level: "skip", summary: why ?? "not run", rows: [{ level: "skip", label: "speed", detail: why ?? "not run" }], blocks: [] };
  const rows: Row[] = [];
  const startS = s.startMs / 1000, [lo, hi] = CAPACITY_REFERENCE.startSeconds;
  rows.push({ level: startS > LIMITS.startFailS ? "fail" : startS > LIMITS.startWarnS ? "warn" : "pass", label: "cold start", detail: `${startS.toFixed(1)} s from launch to the first answered health check (docs/capacity.md: ${lo} to ${hi} s on 35,000 synthetic fighters; the Docker health check allows 120 s). The server answered with ${n(s.health.fighters)} fighters and ${n(s.health.bouts)} bouts.` });
  const peak = r.rssPeakMb;
  rows.push({ level: peak > LIMITS.rssFailMb ? "fail" : peak > LIMITS.rssWarnMb ? "warn" : "pass", label: "memory", detail: `${Math.round(s.rssAtStartMb)} MB resident right after start, ${Math.round(peak)} MB at the peak while ${r.concurrency} visitors asked at once (docs/capacity.md: ${CAPACITY_REFERENCE.rssStartGb * 1000} MB at start, ${CAPACITY_REFERENCE.rssLoadGb[0] * 1000} to ${CAPACITY_REFERENCE.rssLoadGb[1] * 1000} MB under load; 2 GB host is the advice, warn above ${LIMITS.rssWarnMb} MB)` });
  const bad = r.kinds.filter((k) => k.errors > 0 || k.coldStatus !== 200);
  rows.push({ level: bad.length ? "fail" : "pass", label: "answers", detail: bad.length ? `${bad.length} kind(s) of page did not always answer 200: ${bad.map((k) => `${k.kind} (${k.errors} failed, first status ${k.coldStatus})`).join("; ")}` : `every request of ${r.kinds.length} kinds of page answered 200` });
  const slow = r.kinds.filter((k) => k.conc.p95 > LIMITS.p95WarnMs || k.serial.p95 > LIMITS.p95WarnMs);
  const slowest = [...r.kinds].sort((a, b) => b.conc.p95 - a.conc.p95)[0];
  rows.push({ level: r.kinds.some((k) => k.conc.p95 > LIMITS.p95FailMs) ? "fail" : slow.length ? "warn" : "pass", label: "page times", detail: `slowest p95 with ${r.concurrency} at once: ${slowest.kind}, ${ms0(slowest.conc.p95)} ms (warn above ${LIMITS.p95WarnMs} ms, fail above ${LIMITS.p95FailMs} ms)${slow.length ? `; slow: ${slow.map((k) => k.kind).join(", ")}` : ""}` });
  const busy = Math.max(r.load1Start, r.load1End) > m.cores;
  rows.push({ level: busy ? "warn" : "info", label: "how busy the machine was", detail: `1-minute load average ${r.load1Start.toFixed(1)} at the start of the timing and ${r.load1End.toFixed(1)} at its end, on ${m.cores} cores.${busy ? " That is more than one task per core: something else was using the machine, so every time below is inflated. Run it again when the machine is quiet." : " Other work on the machine (this project is often built and tested beside other jobs) makes every time here an upper estimate, not a promise."}` });
  const table: Block = { kind: "table", caption: `Time per page type, in ms. "first" is the very first request of its kind after the start; "1 at a time" and "${r.concurrency} at once" are medians (p50) and 95th percentiles (p95); the last two columns are the documented p50 for one visitor at a time and this run's ratio to it`, head: ["page type", "first", "1 at a time p50", "1 at a time p95", `${r.concurrency} at once p50`, `${r.concurrency} at once p95`, "requests", "avg size KB", "docs p50", "ratio"],
    rows: r.kinds.map((k) => [k.kind, ms0(k.coldMs), ms0(k.serial.p50), ms0(k.serial.p95), ms0(k.conc.p50), ms0(k.conc.p95), k.serial.n + k.conc.n, Math.round(k.avgBytes / 1024), k.refP50 === undefined ? "-" : String(k.refP50), k.refP50 ? `${(k.serial.p50 / k.refP50).toFixed(1)}x` : "-"]) };
  const blocks: Block[] = [{ kind: "text", text: `Machine: ${machineLabel(m)}. The docs numbers come from ${CAPACITY_REFERENCE.source}. This league is different (real fights per fighter, real text), so a ratio near 1 means "about as fast as measured there", not "equal". Timed in ${r.seconds.toFixed(0)} s; other agents and jobs share CPU, so read the times as a ceiling on how slow it is.` }, table];
  const worstKind = [...r.kinds].sort((a, b) => b.conc.p95 - a.conc.p95)[0];
  return { id: "speed", number: 4, title: "Speed at real size", level: sectionLevel(rows), summary: `cold start ${startS.toFixed(1)} s, ${Math.round(peak)} MB peak, slowest p95 ${ms0(worstKind.conc.p95)} ms (${worstKind.kind}) on ${m.cores} cores / ${m.ramGb} GB`, rows, blocks };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// the browser

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadPlaywright(): Promise<any | null> {
  const tries = [process.env.PLAYWRIGHT_MODULE, "playwright", "/opt/node-tools/node_modules/playwright"].filter(Boolean) as string[];
  for (const t of tries) { try { return createRequire(path.join(process.cwd(), "x.js"))(t); } catch { /* next */ } }
  return null;
}

export interface BrowserSample { slug: string; consoleErrors: string[]; brokenImages: string[]; overflow: boolean; ms: number }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function browseSample(pw: any, base: string, slugs: string[]): Promise<BrowserSample[]> {
  const browser = await pw.chromium.launch({ headless: true });
  const out: BrowserSample[] = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    for (const slug of slugs) {
      const page = await ctx.newPage(), errors: string[] = [];
      page.on("console", (m: { type(): string; text(): string }) => { if (m.type() === "error") errors.push(shorten(m.text(), 160)); });
      page.on("pageerror", (e: Error) => errors.push(shorten(`page error: ${e.message}`, 160)));
      const t0 = performance.now();
      try {
        await page.goto(`${base}/boxers/${encodeURIComponent(slug)}`, { waitUntil: "load", timeout: 45_000 });
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(350);
        const info = await page.evaluate(() => ({ broken: [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && (i.currentSrc || i.src)).map((i) => (i.currentSrc || i.src)), over: document.documentElement.scrollWidth > window.innerWidth + 1 }));
        out.push({ slug, consoleErrors: errors, brokenImages: info.broken.map((s: string) => shorten(s, 100)), overflow: info.over, ms: performance.now() - t0 });
      } catch (e) { out.push({ slug, consoleErrors: [...errors, `could not load: ${shorten((e as Error).message.split("\n")[0], 120)}`], brokenImages: [], overflow: false, ms: performance.now() - t0 }); }
      await page.close();
    }
  } finally { await browser.close(); }
  return out;
}

export function sampleSection(results: SampleResult[], browser: BrowserSample[] | null, whyNoBrowser?: string): Section {
  const rows: Row[] = [];
  const bad = results.filter((r) => r.problems.length), by = new Map<string, SampleResult[]>();
  for (const r of results) by.set(r.fighter.group, [...(by.get(r.fighter.group) ?? []), r]);
  rows.push({ level: bad.length ? (bad.length > results.length * 0.1 ? "fail" : "warn") : "pass", label: "pages and records", detail: bad.length ? `${bad.length} of ${results.length} sampled fighters have a problem (a record that is not the database's, a placeholder word, a missing form strip, an implausible age, a page that did not answer 200)` : `all ${results.length} sampled fighters: HTTP 200 in English and Arabic, the record on the page equals the database's, no undefined / NaN / null / [object in the text, an age that makes sense, the form strip present` });
  const sizes = results.map((r) => r.bytes).sort((a, b) => a - b), max = sizes[sizes.length - 1] ?? 0, med = sizes[Math.floor(sizes.length / 2)] ?? 0;
  rows.push({ level: max > LIMITS.pageFailBytes ? "fail" : max > LIMITS.pageWarnBytes ? "warn" : "pass", label: "page size", detail: `median ${(med / 1024).toFixed(0)} KB, largest ${(max / 1024).toFixed(0)} KB of HTML (warn above ${LIMITS.pageWarnBytes / 1e6} MB)` });
  if (browser) {
    const ce = browser.filter((b) => b.consoleErrors.length), bi = browser.filter((b) => b.brokenImages.length), ov = browser.filter((b) => b.overflow);
    rows.push({ level: ce.length ? "fail" : "pass", label: "console errors in a real browser", detail: ce.length ? `${ce.length} of ${browser.length} pages logged an error: ${ce.slice(0, 3).map((b) => `${b.slug}: ${b.consoleErrors[0]}`).join(" | ")}` : `none on ${browser.length} pages (Chromium, 1280 px)` });
    rows.push({ level: bi.length ? "warn" : "pass", label: "broken images", detail: bi.length ? `${bi.length} page(s) have an image that did not load, e.g. ${bi[0].slug}: ${bi[0].brokenImages[0]}. If these are photo links, the host may be refusing the request or this machine may be offline.` : "every image on the sampled pages loaded" });
    rows.push({ level: ov.length ? "warn" : "pass", label: "sideways scroll at 1280 px", detail: ov.length ? `${ov.length} page(s) are wider than the window: ${ov.slice(0, 5).map((b) => b.slug).join(", ")}` : "none" });
  } else rows.push({ level: "skip", label: "browser checks", detail: whyNoBrowser ?? "not run" });
  const byBrowser = new Map((browser ?? []).map((b) => [b.slug, b]));
  const table: Block = { kind: "table", caption: "The 60 fighters (group, page checks, record on the page = database)", head: ["group", "fighter", "record", "record from", "KB", "browser", "problems"],
    rows: results.map((r) => { const b = byBrowser.get(r.fighter.slug); return [SAMPLE_GROUPS.find((g) => g[0] === r.fighter.group)?.[0] ?? "", shorten(r.fighter.name, 36), r.expected, r.source, Math.round(r.bytes / 1024), b ? (b.consoleErrors.length || b.brokenImages.length || b.overflow ? "problem" : "ok") : "-", r.problems.join("; ") || "ok"]; }) };
  const blocks: Block[] = [{ kind: "text", text: `Picked with a seeded generator from the data: ${SAMPLE_GROUPS.map((g) => g[1]).join("; ")}. A fighter already taken by one group is replaced by the next in that group.` }];
  if (bad.length) blocks.push({ kind: "examples", title: "Problems", lines: bad.slice(0, 20).map((r) => `${r.fighter.name} (${r.fighter.slug}, ${r.fighter.group}): ${r.problems.join("; ")}`) });
  blocks.push(table);
  return { id: "sample", number: 3, title: "Sanity sample", level: sectionLevel(rows), summary: `${results.length} fighters rendered, ${bad.length} with a problem${browser ? `, ${browser.filter((b) => b.consoleErrors.length).length} with console errors` : ""}`, rows, blocks };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// accessibility and layout, and the screenshots

export interface A11yPage { label: string; path: string }
export interface A11yResult { page: A11yPage; lang: string; width: number; ok: boolean; message: string; overflow: boolean }
export function representativePages(t: Targets, extra: { disputed?: string; few?: string; bout?: number | null }): A11yPage[] {
  const p = (label: string, path: string): A11yPage => ({ label, path });
  const pages = [p("home", "/"), p("fighters", "/boxers"), p("fighters sorted", "/boxers?sort=wins"), p("fighter (top rated)", `/boxers/${t.top}`)];
  if (extra.disputed) pages.push(p("fighter (disputed)", `/boxers/${extra.disputed}`));
  if (extra.few) pages.push(p("fighter (one fight)", `/boxers/${extra.few}`));
  pages.push(p("rankings", "/rankings"), ...(t.divisions[0] ? [p("a division", `/rankings/${t.divisions[0]}`)] : []), p("events", "/events"));
  if (t.latestEvent) pages.push(p("an event", `/events/${t.latestEvent}`));
  if (extra.bout) pages.push(p("a fight", `/bouts/${extra.bout}`));
  if (t.countries[0]) pages.push(p("a country", `/countries/${t.countries[0]}`));
  pages.push(p("countries", "/countries"), p("data", "/data"), p("titles", "/titles"), p("all-time", "/all-time/greatest"), p("analytics", "/analytics"), p("compare", `/compare?a=${t.top}&b=${t.other}`), p("map", "/map"), p("upset watch", "/upset-watch"));
  return pages;
}
const localised = (lang: string, p: string) => (lang === "ar" ? (p === "/" ? "/ar" : `/ar${p}`) : p);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function a11ySweep(pw: any, base: string, root: string, pages: A11yPage[], widths: number[], langs: string[], progress: (s: string) => void): Promise<A11yResult[]> {
  const axe = fs.readFileSync(path.join(root, "node_modules", "axe-core", "axe.min.js"), "utf8"), sweep = fs.readFileSync(path.join(root, "scripts", "a11y-sweep.js"), "utf8");
  const browser = await pw.chromium.launch({ headless: true }), out: A11yResult[] = [];
  try {
    for (const lang of langs) for (const w of widths) {
      const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, bypassCSP: true }), page = await ctx.newPage();
      for (const pg of pages) {
        try {
          const res = await page.goto(base + localised(lang, pg.path), { waitUntil: "load", timeout: 45_000 });
          if (!res || res.status() >= 400) { out.push({ page: pg, lang, width: w, ok: false, message: `HTTP ${res?.status()}`, overflow: false }); continue; }
          const overflow: boolean = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
          await page.evaluate(axe); await page.evaluate(sweep);
          const msg: string = await page.evaluate("__check()");
          out.push({ page: pg, lang, width: w, ok: msg.startsWith("ok "), message: msg, overflow });
        } catch (e) { out.push({ page: pg, lang, width: w, ok: false, message: shorten((e as Error).message.split("\n")[0], 160), overflow: false }); }
      }
      await ctx.close();
      progress(`a11y ${lang} ${w}px done`);
    }
  } finally { await browser.close(); }
  return out;
}
export function a11ySection(results: A11yResult[] | null, why?: string): Section {
  if (!results) return { id: "a11y", number: 5, title: "Accessibility and layout", level: "skip", summary: why ?? "not run", rows: [{ level: "skip", label: "accessibility sweep", detail: why ?? "not run" }], blocks: [] };
  const bad = results.filter((r) => !r.ok), over = results.filter((r) => r.overflow);
  const rows: Row[] = [
    { level: bad.length ? "fail" : "pass", label: "the repo's sweep (axe-core plus scripts/a11y-sweep.js)", detail: bad.length ? `${bad.length} of ${results.length} page checks are not clean` : `${results.length} page checks clean (${new Set(results.map((r) => r.page.path)).size} pages, ${[...new Set(results.map((r) => r.lang))].join("+")}, ${[...new Set(results.map((r) => r.width))].join(" and ")} px)` },
    { level: over.length ? "fail" : "pass", label: "sideways scroll", detail: over.length ? `${over.length} page(s) wider than the window` : "no page scrolls sideways" },
  ];
  const blocks: Block[] = [];
  if (bad.length || over.length) blocks.push({ kind: "examples", title: "Not clean", lines: [...bad.map((r) => `${r.lang} ${r.width}px ${r.page.path}: ${shorten(r.message, 220)}`), ...over.filter((r) => r.ok).map((r) => `${r.lang} ${r.width}px ${r.page.path}: wider than the window`)].slice(0, 40) });
  return { id: "a11y", number: 5, title: "Accessibility and layout", level: sectionLevel(rows), summary: `${results.length} checks, ${bad.length} not clean, ${over.length} overflowing`, rows, blocks };
}

export interface Shot { caption: string; src: string; bytes: number }
export const GALLERY_BUDGET_BYTES = 11 * 1024 * 1024;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function gallery(pw: any, base: string, pages: { label: string; path: string }[], progress: (s: string) => void): Promise<{ shots: Shot[]; dropped: number }> {
  const browser = await pw.chromium.launch({ headless: true }), shots: Shot[] = [];
  let total = 0, dropped = 0;
  try {
    for (const w of [375, 1280]) for (const lang of ["en", "ar"]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: w === 375 ? 812 : 800 }, reducedMotion: "reduce" }), page = await ctx.newPage();
      for (const pg of pages) {
        try {
          await page.goto(base + localised(lang, pg.path), { waitUntil: "load", timeout: 45_000 });
          await page.waitForTimeout(250);
          const buf: Buffer = await page.screenshot({ type: "jpeg", quality: 52 });
          const src = `data:image/jpeg;base64,${buf.toString("base64")}`;
          if (total + src.length > GALLERY_BUDGET_BYTES) { dropped++; continue; }
          total += src.length; shots.push({ caption: `${pg.label} · ${lang} · ${w}px`, src, bytes: src.length });
        } catch { dropped++; }
      }
      await ctx.close();
      progress(`screenshots ${lang} ${w}px done`);
    }
  } finally { await browser.close(); }
  return { shots, dropped };
}
export function gallerySection(g: { shots: Shot[]; dropped: number } | null, labels: { photo: number; silhouette: number }, why?: string): Section {
  if (!g) return { id: "gallery", number: 6, title: "Screenshot gallery", level: "skip", summary: why ?? "not run", rows: [{ level: "skip", label: "screenshots", detail: why ?? "not run" }], blocks: [] };
  const rows: Row[] = [{ level: g.shots.length ? "info" : "warn", label: "screenshots", detail: `${g.shots.length} taken (top of each page: 375 and 1280 px, English and Arabic), ${(g.shots.reduce((s, x) => s + x.bytes, 0) / 1048576).toFixed(1)} MB embedded${g.dropped ? `; ${g.dropped} left out (a page that did not load, or the size budget)` : ""}` },
    { level: "info", label: "photos and silhouettes", detail: `the six fighters shown are ${labels.photo} with a photo and ${labels.silhouette} without (they show the silhouette): look at both` }];
  return { id: "gallery", number: 6, title: "Screenshot gallery", level: g.shots.length ? "info" : "warn", summary: `${g.shots.length} screenshots`, rows, blocks: [{ kind: "gallery", items: g.shots.map((s) => ({ caption: s.caption, src: s.src, alt: `Screenshot: ${s.caption}` })) }] };
}

export type { Level };
