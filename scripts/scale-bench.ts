/**
 * npm run bench -- --scale 5 [--keep]
 *
 * Generates a demo league `scale` times the default size, ingests it into data/bench-<scale>.db, builds the in-memory
 * world, and times the data work behind each page. Also reports how much data each page would ship to the browser,
 * because a page that is fast on the server can still be too heavy to send. Writes data/bench-<scale>.json.
 * Not part of `npm test`: it is slow by design. Use `npm run bench` (it raises Node's memory limit).
 */
import fs from "node:fs";
import path from "node:path";
import v8 from "node:v8";

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : undefined; };
const scale = Math.max(1, Number(arg("scale") ?? 5));
const file = path.join(process.cwd(), "data", `bench-${scale}.db`);
fs.mkdirSync(path.dirname(file), { recursive: true });
for (const ext of ["", "-wal", "-shm"]) fs.rmSync(file + ext, { force: true });
process.env.DATABASE_PATH = file;
process.env.RINGSIDE_NOW = "2026-10-03";
process.env.RINGSIDE_NO_SEED = "1";

const mb = (n: number) => `${(n / 1048576).toFixed(0)} MB`;
const gc = () => (globalThis as { gc?: () => void }).gc?.();
const rows: { stage: string; ms: number; note?: string }[] = [];
const payloads: { page: string; bytes: number }[] = [];

async function time<T>(stage: string, f: () => T | Promise<T>, note?: (r: T) => string): Promise<T> {
  gc();
  const s = performance.now();
  const r = await f();
  const ms = performance.now() - s;
  const n = note?.(r);
  rows.push({ stage, ms, note: n });
  console.log(`${stage.padEnd(54)} ${ms.toFixed(0).padStart(8)} ms${n ? "   " + n : ""}`);
  return r;
}
const kb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1024).toFixed(0)} KB`);
const payload = (page: string, v: unknown) => { const bytes = JSON.stringify(v).length; payloads.push({ page, bytes }); return bytes; };

async function main() {
  console.log(`scale ${scale}  ->  ${file}   (heap limit ${mb(v8.getHeapStatistics().heap_size_limit)})\n`);
  const { demoProvider } = await import("../lib/providers/demo");
  const { loadFeed } = await import("../lib/feed");
  const { sanitizeFeed } = await import("../lib/validate");
  const { ingest } = await import("../lib/ingest");
  const { getDb } = await import("../lib/db");

  console.log("== loading data");
  const feed = await time("generate the league", () => loadFeed(demoProvider(new Date("2026-10-03"), { scale })),
    (f) => `${f.boxers.length.toLocaleString()} fighters, ${f.bouts.length.toLocaleString()} bouts, ${f.punches.length.toLocaleString()} punch rows`);
  await time("validate the feed", () => sanitizeFeed(feed, { today: "2026-10-03" }), (r) => `${r.issues.length} issues, ${Object.keys(r.dropped).length} dropped kinds`);
  const provider = { name: "bench", fetchBoxers: async () => feed.boxers, fetchEvents: async () => feed.events, fetchBouts: async () => feed.bouts, fetchPeople: async () => feed.people, fetchOrgs: async () => feed.orgs, fetchStints: async () => feed.stints, fetchWeighIns: async () => feed.weighIns, fetchOfficials: async () => feed.officials, fetchScorecards: async () => feed.scorecards, fetchCorners: async () => feed.corners, fetchPunchStats: async () => feed.punches, fetchFinancials: async () => feed.financials, fetchPurses: async () => feed.purses, fetchBroadcasts: async () => feed.broadcasts, fetchEarnings: async () => feed.earnings };
  const db = await getDb();
  await time("ingest (validate + write + Elo)", () => ingest(db, provider), (r) => `${r.errors} errors`);
  const dbBytes = ["", "-wal"].reduce((s, e) => s + (fs.existsSync(file + e) ? fs.statSync(file + e).size : 0), 0);
  console.log(`database file: ${kb(dbBytes)}`);

  console.log("\n== in-memory world");
  const { getWorld, invalidateWorld } = await import("../lib/world");
  gc(); const heap0 = process.memoryUsage().heapUsed;
  await time("getWorld() cold build", () => getWorld());
  gc(); const heap1 = process.memoryUsage().heapUsed;
  console.log(`world holds ~${mb(heap1 - heap0)} of heap (process RSS ${mb(process.memoryUsage().rss)})`);
  await time("getWorld() rebuild (new day or new data)", async () => { invalidateWorld(); return getWorld(); });
  const w2 = await getWorld();
  await time("getWorld() when nothing changed (cache hit)", () => getWorld());
  invalidateWorld();
  const together = await time("4 simultaneous getWorld() after a change", () => Promise.all([getWorld(), getWorld(), getWorld(), getWorld()]),
    (ws) => `${new Set(ws).size} distinct world(s) built${new Set(ws).size > 1 ? "  <-- STAMPEDE" : ""}`);
  void together;

  console.log("\n== data work behind each page (server side)");
  const { watchEntries } = await import("../lib/watch"), { searchFighters, toHit } = await import("../lib/fighter-search");
  const rk = await import("../lib/rankings"), tm = await import("../lib/team"), of = await import("../lib/officials"), st = await import("../lib/style");
  const an = await import("../lib/analytics"), wt = await import("../lib/weights"), ev = await import("../lib/events"), ai = await import("../lib/ai");
  const { predict } = await import("../lib/predict"), { coverage } = await import("../lib/coverage"), { runFit } = await import("../lib/fit");
  const { DIVISION_NAMES } = await import("../lib/divisions");

  const mid = [...w2.boxers].filter((b) => b.bouts >= 10).sort((a, b) => a.id - b.id)[Math.floor(w2.boxers.length / 3)];
  const someBout = w2.bouts[Math.floor(w2.bouts.length / 2)];

  await time("home: calendar, p4p, recent, upsets", () => { const u = ev.eventViews(w2, ev.upcomingEvents(w2).slice(0, 13)); const r = ev.eventViews(w2, ev.recentEvents(w2, 5)); rk.pound4pound(w2, 8); an.biggestUpsets(w2, 1, "2025-01-01"); if (u[0]) predict(u[0].red, u[0].blue); return r.length; });
  await time("home: watchlist API for 20 starred fighters", () => payload("/api/watch (20 fighters)", watchEntries(w2, w2.boxers.filter((b) => b.active).slice(0, 20).map((b) => b.slug))), (n) => `${kb(n)} per request`);
  await time("rankings: every division, men and women", () => { for (const d of DIVISION_NAMES) { rk.rankDivision(w2, d, 5, "male"); rk.rankDivision(w2, d, 5, "female"); } rk.pound4pound(w2, 10); });
  await time("rankings/[division]: one division, top 15", () => rk.rankDivision(w2, "Welterweight", 15, "male"));
  await time("fighters list: filter + sort everyone", () => w2.boxers.filter((b) => b.bouts > 0).sort((a, b) => b.rating - a.rating).slice(0, 48));
  await time("fighters list: natural-language trainer filter", async () => { const t = [...w2.people.values()].find((p) => w2.roles.get(p.id)?.has("trainer")); return ai.applyFilters(w2.boxers.filter((b) => b.bouts > 0), { trainer: t?.name ?? "a", weightClass: "Welterweight" }, w2).length; });
  await time("fighter profile: team, weights, rank, similar, report", () => {
    tm.boxerTeam(w2, mid.id); wt.weightHistory(w2, mid.id); rk.rankOf(w2, mid); st.similarTo(mid, w2, 4); ai.rulesReport(mid, w2);
    return w2.boxers.filter((x) => x.sex === mid.sex && x.weightClass === mid.weightClass && x.bouts >= 5).length;
  }, (n) => `radar pool ${n}`);
  await time("bout page: look up a bout and its event (maps)", () => { w2.boutById.get(someBout.id); w2.eventById.get(someBout.eventId); });
  await time("compare: one type-ahead keystroke (search API)", () => payload("/api/fighters (8 hits)", searchFighters(w2, "mar", { limit: 8, minBouts: 5 }).map((b) => toHit(b))), (n) => `${kb(n)} per request`);
  await time("compare: head-to-head lookup", () => { const l = w2.boutsByBoxer.get(mid.id) ?? []; return l.length ? l.filter((x) => x.method && (x.redId === l[0].blueId || x.blueId === l[0].blueId)).length : 0; });
  await time("people: trainer leaderboard (all trainers)", () => tm.trainerLeaderboard(w2, 4), (r) => `${r.length} trainers`);
  await time("people: judges and referees", () => { of.judgeStats(w2); of.refereeStats(w2); of.scoringDisputes(w2, 6); });
  await time("orgs: index (top 36 gyms and promotions)", () => tm.orgsIndex(w2, 36), (r) => `${r.gymTotal + r.promoTotal} organisations ranked, ${r.gyms.length + r.promos.length} with full stats`);
  await time("weigh-ins page", () => { wt.divisionWeights(w2); wt.fightNightEdge(w2); wt.missedWeights(w2, 12); });
  await time("analytics page: all aggregations", () => { an.overview(w2); an.byWeightClass(w2); an.methodSplit(w2); an.boutsPerYear(w2); an.finishHeat(w2); an.biggestUpsets(w2, 6); an.countryLeaders(w2); an.longestStreaks(w2, 6); an.stanceEdge(w2); an.reachEdge(w2); });
  await time("style map: project every fighter, sample 400 per style", () => { const { points, total } = st.styleMapSample(w2); return { n: payload("style map (points)", points.map((p) => [p.boxer.slug, p.boxer.name, +p.x.toFixed(3), +p.y.toFixed(3), st.ARCHETYPES.indexOf(p.arch), `${p.boxer.wins}-${p.boxer.losses}-${p.boxer.draws}`, 0])), total, shown: points.length }; }, (r) => `${r.shown.toLocaleString()} of ${r.total.toLocaleString()} points, ships ${kb(r.n)} to the browser`);
  const mn = await import("../lib/money");
  await time("money page: leaderboards, broadcasters, years", () => { mn.moneyCoverage(w2); mn.topGates(w2, 8); mn.topPpv(w2, 8); mn.topPurses(w2, 10); mn.topEarners(w2, 10); mn.topEarners(w2, 8, 2026); mn.broadcasterTable(w2); mn.revenueByYear(w2); return mn.moneyCoverage(w2).purses; }, (n) => `${n.toLocaleString()} purses`);
  await time("event page: money panel + fighter career pay", () => { const e = w2.events[Math.floor(w2.events.length / 2)]; mn.eventMoney(w2, e.id); for (const b of w2.boutsByEvent.get(e.id) ?? []) mn.boutPurses(w2, b.id); mn.careerMoney(w2, mid.id); });
  const fs2 = await import("../lib/fight-score"), rc = await import("../lib/records");
  // a fresh world so the first visitor's cost (punch totals, scoring a year, every list) is what is measured
  invalidateWorld(); const w3 = await getWorld();
  await time("home: fight of the year card (cold: punch totals + one year scored)", () => { const y = fs2.featuredYear(w3); return y ? fs2.fightsOfYear(w3, y).length : 0; }, (n) => `${n} fights scored`);
  await time("fight-of-the-year page: every year's winner", () => fs2.fightOfTheYear(w3), (r) => `${r.length} years`);
  await time("fight-of-the-year/[year]: top ten with reasons", () => fs2.fightsOfYear(w3, fs2.fightYears(w3)[1]).slice(0, 10).length);
  await time("all-time hub: top 5 of every list", () => { for (const l of rc.LISTS) rc.recordList(w3, l.id, {}, 5); });
  await time("all-time/[list]: top 50 of the legacy score, filtered", () => rc.recordList(w3, "greatest", { sex: "female", division: "Welterweight" }, 50));
  await time("bout page: fight score and rank", () => fs2.fightRank(w3, someBout.id));
  await time("fighter profile: records and awards", () => rc.recordsOf(w3, mid.id, 10));
  const up = await import("../lib/upsets"), ti = await import("../lib/trainer-impact"), { tEn } = await import("../lib/i18n/t");
  invalidateWorld(); const w4 = await getWorld();
  await time("upset watch: every upcoming fight with reasons", () => up.upsetWatch(w4, tEn), (r) => `${r.length} fights`);
  await time("upset watch: track record and warning-sign tests (cold)", () => { up.upsetRecord(w4); up.signalLift(w4); up.recentShocks(w4); });
  await time("trainer impact: joint fit of fighters and trainers (cold)", () => ti.trainerImpact(w4), (r) => `${r.fights.toLocaleString()} fights, ${r.all.length} trainers`);
  await time("trainer impact: moves, switch study, underdog table", () => { ti.moves(w4); ti.switchStudy(w4); ti.underdogLifters(w4); });
  await time("trainer page: impact card for one trainer", () => { const p = ti.trainerImpact(w4).ranked[0]; ti.movesOf(w4, p.person.id); ti.underdogRecordOf(w4, p.person.id); });
  await time("data page: coverage queries", () => coverage());
  await time("model fit: features + regression", () => runFit(w2), (r) => `${r.rows.train + r.rows.test} bouts`);

  fs.writeFileSync(path.join(process.cwd(), "data", `bench-${scale}.json`), JSON.stringify({ scale, at: new Date().toISOString(), dbBytes, rows, payloads }, null, 2));
  const slow = rows.filter((r) => r.ms > 250 && !/generate|validate|ingest|getWorld|model fit/.test(r.stage));
  console.log(`\n== summary: ${slow.length ? slow.length + " page(s) over 250 ms" : "every page's data work is under 250 ms"}`);
  for (const r of slow.sort((a, b) => b.ms - a.ms)) console.log(`   SLOW ${r.ms.toFixed(0).padStart(7)} ms  ${r.stage}`);
  const heavy = payloads.filter((p) => p.bytes > 300 * 1024);
  console.log(heavy.length ? `== ${heavy.length} payload(s) over 300 KB:` : "== no oversized payloads");
  for (const p of heavy) console.log(`   HEAVY ${kb(p.bytes).padStart(8)}  ${p.page}`);
  if (!process.argv.includes("--keep")) for (const ext of ["", "-wal", "-shm"]) fs.rmSync(file + ext, { force: true });
}
main().catch((e) => { console.error(e); process.exit(1); });
