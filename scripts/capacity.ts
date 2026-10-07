/**
 * Capacity test driver: how many visitors can ONE instance serve? (docs/capacity.md has the method and the numbers it produced.)
 *
 *   npm run capacity -- --base http://localhost:3417 --pid 12345 --steps 1,5,20,50,100 --seconds 30 [--json out.json]
 *   npm run capacity -- --base ... --pid ... --cold                    the first request of each kind of page, once each, nothing else
 *   npm run capacity -- --base ... --pid ... --steps 20 --seconds 40 --event-at 15 --event-cmd "node ... update"
 *        runs the command (a nightly update, say) 15 s into the step and prints a second-by-second table around it
 *
 * `scripts/loadtest.ts` is the quick one (one number, the demo league's paths). This one is for sizing a host: it replays a weighted mix of the
 * paths a real league has (taken from the server's own sitemap, so they exist), closed loop at stepped concurrency (each of N virtual
 * visitors asks again the moment it is answered, so it finds the ceiling and shows how latency grows past it), and samples the server
 * process's CPU and memory from /proc (Linux only) while it does. Per kind of page it reports the latency, so the slowest routes show.
 *
 * Point it ONLY at a server you own, on a database copy. Give the server and this driver different cores (taskset), or this driver measures
 * itself. Each virtual visitor sends its own X-Forwarded-For so the per-address limits (public API: 60 a minute) behave as behind a proxy.
 * The mix is an assumption (MIX below), not a measurement of real traffic: change it when real traffic is known.
 */
import fs from "node:fs";
import { summarise } from "../lib/loadtest";

const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i > -1 ? argv[i + 1] : d; };
const BASE = (arg("base", "http://localhost:3000") as string).replace(/\/$/, "");
const PID = Number(arg("pid", "0"));
const STEPS = (arg("steps", "1,5,20,50,100") as string).split(",").map(Number);
const SECONDS = Number(arg("seconds", "30"));
const SEED = Number(arg("seed", "11"));
const TIMEOUT_MS = 30_000;

// ---- a small seeded generator, so two runs ask for the same things in the same proportions
let s = SEED >>> 0;
const rand = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = <T,>(a: T[]): T => a[Math.floor(rand() * a.length)];

// ---- what exists in this league, from the server's own sitemap
interface Known { fighters: string[]; events: string[]; bouts: string[]; countries: string[]; divisions: string[]; titles: string[]; people: string[]; allTime: string[]; chunks: string[] }
async function discover(): Promise<Known> {
  const k: Known = { fighters: [], events: [], bouts: [], countries: [], divisions: [], titles: [], people: [], allTime: [], chunks: [] };
  const idx = await (await fetch(`${BASE}/sitemap.xml`)).text();
  const files = [...idx.matchAll(/\/sitemaps\/(\d+)\.xml/g)].map((m) => Number(m[1]));
  if (!files.length) throw new Error("no sitemap: is SITE_URL a public address and BOXING_PROVIDER not demo? (see docs/deploy.md)");
  const take = [...new Set([0, Math.floor(files.length / 3), Math.floor((2 * files.length) / 3), files.length - 1])].filter((i) => files.includes(i));
  for (const i of take) {
    const xml = await (await fetch(`${BASE}/sitemaps/${i}.xml`)).text();
    for (const m of xml.matchAll(/<loc>[^<]*?(\/(boxers|events|bouts|countries|rankings|titles|people|all-time)\/[^<]+)<\/loc>/g)) {
      if (m[0].includes("/ar/")) continue;
      const [, p, kind] = m;
      (({ boxers: k.fighters, events: k.events, bouts: k.bouts, countries: k.countries, rankings: k.divisions, titles: k.titles, people: k.people, "all-time": k.allTime } as Record<string, string[]>)[kind]).push(p);
    }
  }
  k.chunks = [...(await (await fetch(`${BASE}/`)).text()).matchAll(/(\/_next\/static\/[^"']+\.(?:js|css))/g)].map((m) => m[1]).filter((v, i, a) => a.indexOf(v) === i);
  for (const key of ["fighters", "events", "bouts", "countries", "divisions", "titles", "people", "allTime"] as const) if (!k[key].length && key !== "people" && key !== "titles") throw new Error(`the sitemap names no ${key}`);
  return k;
}

// ---- the mix: [kind, weight, builder]. Weights are shares of requests (an assumption, see the header). Page kinds get the Arabic prefix a quarter of the time.
type Req = { kind: string; path: string };
const WC = ["Heavyweight", "Lightweight", "Welterweight", "Middleweight", "Featherweight", "Bantamweight", "Flyweight", "Super Middleweight"];
const SORTS = ["rating", "wins", "name", "bouts", "ko"];
function mix(k: Known): { kind: string; w: number; page: boolean; make: () => string }[] {
  const q = () => pick(["fighter 1", "fighter 12", "fighter 2", "mex", "fighter 3", "jap", "fighter 9"]);
  return [
    { kind: "home", w: 8, page: true, make: () => "/" },
    { kind: "rankings index", w: 3, page: true, make: () => "/rankings" },
    { kind: "rankings division", w: 8, page: true, make: () => pick(k.divisions) + pick(["", "", "?sex=female", "?page=2", "?sort=rating&dir=asc", "?list=wba"]) },
    { kind: "fighters list", w: 4, page: true, make: () => "/boxers" },
    { kind: "fighters list sorted/paged", w: 4, page: true, make: () => `/boxers?sort=${pick(SORTS)}&page=${1 + Math.floor(rand() * 200)}` },
    { kind: "fighters list filtered", w: 4, page: true, make: () => `/boxers?wc=${encodeURIComponent(pick(WC))}&sex=male&status=${pick(["active", "retired"])}&page=${1 + Math.floor(rand() * 20)}` },
    { kind: "fighters list text search", w: 2, page: true, make: () => `/boxers?q=${encodeURIComponent(q())}` },
    { kind: "fighter page", w: 22, page: true, make: () => pick(k.fighters) },
    { kind: "events list", w: 3, page: true, make: () => pick(["/events", "/events?page=2", "/events"]) },
    { kind: "event page", w: 5, page: true, make: () => pick(k.events) },
    { kind: "bout page", w: 3, page: true, make: () => pick(k.bouts) },
    { kind: "country page", w: 4, page: true, make: () => pick(k.countries) },
    { kind: "countries index", w: 1, page: true, make: () => "/countries" },
    { kind: "all-time list", w: 2, page: true, make: () => pick(k.allTime) },
    { kind: "other whole-league pages", w: 3, page: true, make: () => pick(["/analytics", "/map", "/upset-watch", "/money", "/trainers", "/titles", "/matchmaking", "/on-this-day"]) },
    { kind: "api search", w: 5, page: false, make: () => `/api/search?q=${encodeURIComponent(q())}` },
    { kind: "api fighters typeahead", w: 3, page: false, make: () => `/api/fighters?q=${encodeURIComponent(q())}` },
    // the public /api/v1 is closed for licensed data until the owner switches it on (lib/public-api.ts), so it is left out unless asked for: --v1
    ...(argv.includes("--v1") ? [{ kind: "api v1", w: 3, page: false, make: () => pick(["/api/v1/fighters?limit=20", "/api/v1/divisions", "/api/v1/events?limit=20", "/api/v1/rankings/lightweight"]) }] : []),
    { kind: "og image (fighter)", w: 2, page: false, make: () => `${pick(k.fighters)}/opengraph-image` },
    { kind: "og image (event/home)", w: 1, page: false, make: () => pick([`${pick(k.events)}/opengraph-image`, "/opengraph-image"]) },
    { kind: "fighter card api", w: 1, page: false, make: () => `/api/fighter-card/${pick(k.fighters).split("/").pop()}` },
    { kind: "sitemap file", w: 0.3, page: false, make: () => `/sitemaps/${Math.floor(rand() * 19)}.xml` },
    { kind: "sitemap index + health", w: 0.7, page: false, make: () => pick(["/sitemap.xml", "/api/health"]) },
  ];
}
function buildPicker(k: Known) {
  const only = arg("only"); // e.g. --only "fighter page,country page": a profile of one kind of request
  const m = mix(k).filter((x) => !only || only.split(",").includes(x.kind)), total = m.reduce((a, b) => a + b.w, 0);
  return (): Req => {
    let r = rand() * total, e = m[0];
    for (const x of m) { r -= x.w; if (r <= 0) { e = x; break; } }
    const path = e.make();
    return { kind: e.kind, path: e.page && rand() < 0.25 ? `/ar${path === "/" ? "" : path}` : path };
  };
}

// ---- the server process, from /proc
const TICK = 100; // USER_HZ on Linux
const readProc = (pid: number) => {
  try {
    const st = fs.readFileSync(`/proc/${pid}/stat`, "utf8"), f = st.slice(st.lastIndexOf(")") + 2).split(" ");
    const cpuS = (Number(f[11]) + Number(f[12])) / TICK; // utime + stime
    const status = fs.readFileSync(`/proc/${pid}/status`, "utf8");
    const rss = Number(/VmRSS:\s+(\d+)/.exec(status)?.[1] ?? 0) / 1024, hwm = Number(/VmHWM:\s+(\d+)/.exec(status)?.[1] ?? 0) / 1024;
    return { cpuS, rss, hwm };
  } catch { return null; }
};

interface Sample { t: number; ms: number; ok: boolean; status: number; kind: string; bytes: number }
async function hit(r: Req, ip: string): Promise<{ ms: number; ok: boolean; status: number; bytes: number }> {
  const t0 = performance.now();
  try {
    const res = await fetch(BASE + r.path, { headers: { "x-forwarded-for": ip }, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "follow" });
    const b = await res.arrayBuffer();
    return { ms: performance.now() - t0, ok: res.ok, status: res.status, bytes: b.byteLength };
  } catch { return { ms: performance.now() - t0, ok: false, status: 0, bytes: 0 }; }
}

interface StepResult { conc: number; seconds: number; n: number; reqPerSec: number; p50: number; p95: number; p99: number; max: number; errors: number; errorRate: number; cpuPct: number; rssStart: number; rssEnd: number; rssPeak: number; mbPerSec: number; /** the machine's 1-minute load average when the step ended: well above the cores given to the server and this driver means other work was competing, and the step is suspect */ load1: number; byKind: Record<string, { n: number; p50: number; p95: number; max: number; errors: number }>; bucket?: { sec: number; n: number; p50: number; max: number; rss: number }[]; /** with --event-at: how long nothing at all was answered after the event started, the slowest answer after it, and how many took over 2 s */ afterEvent?: { longestSilenceS: number; slowestMs: number; over2s: number; peakRssMb: number } }

async function step(pick: () => Req, conc: number, seconds: number, eventAt?: number, eventCmd?: string): Promise<StepResult> {
  const samples: Sample[] = [];
  const rssTrace: { t: number; rss: number }[] = [];
  const p0 = PID ? readProc(PID) : null;
  const t0 = performance.now(), end = t0 + seconds * 1000;
  let rssPeak = p0?.rss ?? 0;
  const poll = setInterval(() => { const p = PID ? readProc(PID) : null; if (p) { rssPeak = Math.max(rssPeak, p.rss); rssTrace.push({ t: (performance.now() - t0) / 1000, rss: p.rss }); } }, 250);
  if (eventAt !== undefined && eventCmd) setTimeout(() => { console.log(`  [t=${eventAt}s] running: ${eventCmd}`); void import("node:child_process").then(({ exec }) => exec(eventCmd, (e, so, se) => console.log(`  [event finished at t=${((performance.now() - t0) / 1000).toFixed(1)}s${e ? ` exit ${e.code}` : ""}]\n${(so + se).split("\n").filter((l) => /updating|after the update|world_built|records:/.test(l)).join("\n")}`))); }, eventAt * 1000);
  await Promise.all(Array.from({ length: conc }, async (_, v) => {
    const ip = `10.${(v >> 8) & 255}.${v & 255}.${1 + Math.floor(rand() * 250)}`;
    while (performance.now() < end) {
      const r = pick(), a = await hit(r, ip);
      samples.push({ t: (performance.now() - t0) / 1000, ms: a.ms, ok: a.ok, status: a.status, kind: r.kind, bytes: a.bytes });
    }
  }));
  clearInterval(poll);
  const wall = (performance.now() - t0) / 1000, p1 = PID ? readProc(PID) : null;
  const sum = summarise(samples.map((x) => x.ms), wall);
  const byKind: StepResult["byKind"] = {};
  for (const kind of new Set(samples.map((x) => x.kind))) {
    const xs = samples.filter((x) => x.kind === kind), sm = summarise(xs.map((x) => x.ms), 1);
    byKind[kind] = { n: xs.length, p50: sm.p50, p95: sm.p95, max: sm.max, errors: xs.filter((x) => !x.ok).length };
  }
  const errors = samples.filter((x) => !x.ok).length;
  const out: StepResult = { conc, seconds: wall, n: samples.length, reqPerSec: sum.reqPerSec, p50: sum.p50, p95: sum.p95, p99: sum.p99, max: sum.max, errors, errorRate: samples.length ? errors / samples.length : 0, cpuPct: p0 && p1 ? ((p1.cpuS - p0.cpuS) / wall) * 100 : NaN, rssStart: p0?.rss ?? NaN, rssEnd: p1?.rss ?? NaN, rssPeak, mbPerSec: samples.reduce((a, b) => a + b.bytes, 0) / 1048576 / wall, load1: Number(fs.readFileSync("/proc/loadavg", "utf8").split(" ")[0]), byKind };
  if (eventAt !== undefined) {
    out.bucket = [];
    // "blocked": the longest stretch after the event in which no request finished at all (a request counts when it finished, so a stall is a silence)
    const after = samples.filter((x) => x.t >= eventAt).map((x) => x.t).sort((a, b) => a - b);
    let longest = 0, prev = eventAt;
    for (const t of [...after, wall]) { longest = Math.max(longest, t - prev); prev = t; }
    const late = samples.filter((x) => x.t >= eventAt);
    out.afterEvent = { longestSilenceS: longest, slowestMs: late.length ? Math.max(...late.map((x) => x.ms)) : 0, over2s: late.filter((x) => x.ms > 2000).length, peakRssMb: Math.max(0, ...rssTrace.filter((x) => x.t >= eventAt).map((x) => x.rss)) };
    for (let sec = 0; sec < Math.floor(wall); sec++) {
      const xs = samples.filter((x) => x.t >= sec && x.t < sec + 1), rs = rssTrace.filter((x) => x.t >= sec && x.t < sec + 1);
      // a request is counted in the second it finished, so a stall shows as an empty second followed by a very slow one
      out.bucket.push({ sec, n: xs.length, p50: summarise(xs.map((x) => x.ms), 1).p50, max: xs.length ? Math.max(...xs.map((x) => x.ms)) : 0, rss: rs.length ? Math.max(...rs.map((x) => x.rss)) : NaN });
    }
  }
  return out;
}

const f0 = (n: number) => (Number.isFinite(n) ? n.toFixed(0) : "-");

async function cold(k: Known) {
  // the first request of each kind, once, in this order, against a server that has just started: what a first visitor pays
  const list = ["/", "/boxers", `/boxers?sort=rating&page=7`, k.fighters[3], k.fighters[900], "/events", k.events[5], k.bouts[3], k.countries[0], k.divisions[0], "/rankings", "/analytics", "/all-time/greatest", "/ar", `/ar${k.fighters[4]}`, "/api/search?q=fighter%201", "/api/fighters?q=fighter%2012", `${k.fighters[5]}/opengraph-image`, "/sitemap.xml", "/sitemaps/2.xml"];
  console.log("first request of each kind after boot (ms; the second request of the same URL is beside it):");
  for (const p of list) {
    const a = await hit({ kind: "cold", path: p }, "10.9.9.9"), b = await hit({ kind: "cold", path: p }, "10.9.9.9");
    console.log(`  ${p.padEnd(44)} ${f0(a.ms).padStart(6)} ms   again ${f0(b.ms).padStart(5)} ms   ${a.status}`);
  }
}

async function main() {
  const k = await discover();
  console.log(`league: ${k.fighters.length}+ fighters, ${k.events.length}+ events, ${k.bouts.length}+ bouts in the sampled sitemap files; server pid ${PID || "(none: no CPU/RSS)"}; ${process.versions.node}`);
  if (argv.includes("--cold")) return cold(k);
  const picker = buildPicker(k);
  const results: StepResult[] = [];
  const eventAt = arg("event-at") ? Number(arg("event-at")) : undefined, eventCmd = arg("event-cmd");
  if (argv.includes("--static")) {
    // the page's own code and styles, which a CDN or the browser cache normally absorbs: how much does the origin pay if they all arrive?
    const kk = { ...k }; const p = () => ({ kind: "static chunk", path: pick(kk.chunks) });
    for (const c of STEPS) { const r = await step(p, c, SECONDS); results.push(r); console.log(`static chunks, ${c} at a time: ${f0(r.reqPerSec)} req/s, p50 ${f0(r.p50)} p95 ${f0(r.p95)} ms, cpu ${f0(r.cpuPct)}%, ${r.mbPerSec.toFixed(1)} MB/s`); }
  } else {
    console.log("\nconc  secs  requests  req/s   p50   p95   p99   max  errors  cpu%(of 1 core)  rss start/peak/end MB   MB/s  load1");
    for (const c of STEPS) {
      const r = await step(picker, c, SECONDS, eventAt, eventCmd);
      results.push(r);
      console.log(`${String(c).padStart(4)} ${f0(r.seconds).padStart(5)} ${String(r.n).padStart(9)} ${r.reqPerSec.toFixed(1).padStart(6)} ${f0(r.p50).padStart(5)} ${f0(r.p95).padStart(5)} ${f0(r.p99).padStart(5)} ${f0(r.max).padStart(5)} ${String(r.errors).padStart(7)} ${f0(r.cpuPct).padStart(10)}      ${f0(r.rssStart)}/${f0(r.rssPeak)}/${f0(r.rssEnd)}   ${r.mbPerSec.toFixed(1).padStart(6)} ${r.load1.toFixed(1).padStart(6)}`);
    }
    // the first step's numbers are the cost of the request itself (nothing queues behind another); the last one's show what waiting adds
    for (const r of results.length > 1 ? [results[0], results[results.length - 1]] : results) {
      console.log(`\nper kind at ${r.conc} at a time (ms):`);
      for (const [kind, v] of Object.entries(r.byKind).sort((a, b) => b[1].p50 - a[1].p50)) console.log(`  ${kind.padEnd(30)} n ${String(v.n).padStart(6)}  p50 ${f0(v.p50).padStart(6)}  p95 ${f0(v.p95).padStart(6)}  max ${f0(v.max).padStart(6)}  errors ${v.errors}`);
    }
    const ae = results[0].afterEvent;
    if (ae) console.log(`\nafter the event: nothing answered for ${ae.longestSilenceS.toFixed(1)} s at the longest; slowest answer ${f0(ae.slowestMs)} ms; ${ae.over2s} answers took over 2 s; peak rss ${f0(ae.peakRssMb)} MB`);
    if (results[0].bucket) { console.log("\nsecond-by-second (requests finished, p50 ms, worst ms, rss MB):"); for (const b of results[0].bucket) console.log(`  t=${String(b.sec).padStart(3)}s  n ${String(b.n).padStart(4)}  p50 ${f0(b.p50).padStart(5)}  max ${f0(b.max).padStart(6)}  rss ${f0(b.rss)}`); }
  }
  const out = arg("json");
  if (out) fs.writeFileSync(out, JSON.stringify({ base: BASE, seed: SEED, node: process.version, cores: (await import("node:os")).cpus().length, results }, null, 1));
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
