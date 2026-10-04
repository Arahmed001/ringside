/**
 * npm run build && npm run smoke [-- --feed sparse|empty|partial|hostile] [-- --facts unknown] [-- --scale 20] [-- --crawl 200] [-- --database FILE]      render every kind of page in English and Arabic on a real production server and inspect it
 *
 * Seeds a throwaway database with the demo league (clock pinned to 2026-10-03), starts `next start` on a free port, requests a
 * representative page of every kind plus the JSON and image endpoints, and checks each (status, language and direction, a heading,
 * no "undefined" / NaN / unfilled placeholders / error pages in the text, and on the Arabic pages of the demo league no English left behind:
 * `arabicLeaks` in lib/smoke.ts, and no record that the right-to-left order would show backwards: `flippedRecords`). Exits 1 with the list of problems. CI runs it after the build.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { HOSTILE_MARKUP } from "../lib/hostile-feed";

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : undefined; };

const freePort = () => new Promise<number>((resolve, reject) => {
  const s = net.createServer();
  s.listen(0, () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)); });
  s.on("error", reject);
});

async function main() {
  if (!fs.existsSync(path.join(process.cwd(), ".next", "BUILD_ID"))) { console.error("No production build found. Run `npm run build` first."); process.exit(2); }
  const db = path.join(os.tmpdir(), `ringside-smoke-${process.pid}.db`);
  for (const ext of ["", "-wal", "-shm"]) fs.rmSync(db + ext, { force: true });
  process.env.DATABASE_PATH = db;
  // `--database FILE` checks a league you already have (the real one) instead of the demo: a COPY of the file is used and deleted afterwards, so the original is never opened for writing
  const existing = arg("database");
  if (existing) {
    if (!fs.existsSync(existing)) { console.error(`--database: no file at ${existing}`); process.exit(2); }
    if (arg("scale") !== undefined || arg("feed") !== undefined || arg("facts") !== undefined) { console.error("--database is a league of its own: not with --scale, --feed or --facts"); process.exit(2); }
    for (const ext of ["", "-wal", "-shm"]) if (fs.existsSync(existing + ext)) fs.copyFileSync(existing + ext, db + ext);
    process.env.RINGSIDE_NO_SEED = "1";
    console.log(`league: a copy of ${existing}`);
  }
  const accounts = db.replace(/\.db$/, "-accounts.db"); // never touch a real accounts file
  process.env.ACCOUNTS_DB_PATH = accounts;
  process.env.RINGSIDE_NOW = "2026-10-03";

  // `--feed sparse` (one finished card, nothing upcoming) or `--feed empty` (no data at all) run the same checks on a league the real
  // world can be in (the first load, or the gap between seasons): no page may fail because something it expects is not there yet
  const feedName = arg("feed");
  if (feedName) {
    if (feedName !== "sparse" && feedName !== "empty" && feedName !== "partial" && feedName !== "hostile") { console.error('--feed is "sparse", "empty", "partial" or "hostile"'); process.exit(2); }
    const { miniFeed } = await import("../tests/helpers");
    let f = miniFeed();
    // `--feed partial`: the shape a real first load has. A league from the stand-in vendor, read through the real adapter with only the most recently active fighters
    // taken (so most careers are held in part and the supplier's career totals are shown), no organisations, people, officials or any other source
    if (feedName === "partial") {
      const { makeWorld, mockVendor } = await import("../lib/vendor-mock");
      const { boxingDataApiProvider } = await import("../lib/providers/boxing-data-api");
      const { loadFeed } = await import("../lib/feed");
      const league = makeWorld({ fighters: 260, fights: 520, upcoming: 6, seed: 5, today: "2026-10-03" });
      const provider = boxingDataApiProvider({ key: "k".repeat(40), purpose: "evaluation", fetchImpl: mockVendor(league).fetchImpl, scheduleDays: 0, maxRequests: 1e6, retries: 0, gapMs: 0, maxFighters: 100, log: () => {}, sleep: async () => {} });
      f = await loadFeed(provider);
    }
    // `--feed hostile`: awkward values (markup and SQL in names, absurd heights, contradictory results, impossible dates; lib/hostile-feed.ts) read through the real adapter.
    // Every page must still render, and the markup must be on no page as markup
    if (feedName === "hostile") {
      const { hostileFetch } = await import("../lib/hostile-feed");
      const { boxingDataApiProvider } = await import("../lib/providers/boxing-data-api");
      const { loadFeed } = await import("../lib/feed");
      const { sanitizeFeed } = await import("../lib/validate");
      const provider = boxingDataApiProvider({ key: "k".repeat(40), purpose: "evaluation", fetchImpl: hostileFetch(), scheduleDays: 0, maxRequests: 1e6, retries: 0, gapMs: 0, log: () => {}, sleep: async () => {} });
      f = await loadFeed(provider);
      const kept = sanitizeFeed(f, { today: "2026-10-03" });
      console.log(`hostile: ${f.boxers.length} fighters and ${f.bouts.length} fights read; the validator set aside ${kept.dropped.bout ?? 0} fights, ${kept.dropped.boxer ?? 0} fighters and ${kept.dropped.event ?? 0} events (counted)`);
    }
    const feed = feedName === "empty" ? { ...f, boxers: [], events: [], bouts: [], people: [], orgs: [], stints: [], weighIns: [], officials: [], scorecards: [], corners: [], punches: [] } : f;
    const file = path.join(os.tmpdir(), `ringside-smoke-feed-${process.pid}.json`);
    fs.writeFileSync(file, JSON.stringify(feed));
    process.env.BOXING_PROVIDER = "file"; process.env.BOXING_FILE = file;
    process.on("exit", () => fs.rmSync(file, { force: true }));
    console.log(`feed: ${feedName}`);
  }

  // `--scale N` makes the league N times the demo's size (20 is about 19,000 fighters and 160,000 bouts, the size a licensed feed can be): every page kind is rendered and
  // inspected on it, and each page that takes over a second is listed at the end. The names are generated, so the Arabic pages are not checked for English words.
  const scale = Math.max(1, Math.floor(Number(arg("scale") ?? 1)));
  if (scale > 1) {
    if (feedName) { console.error("--scale and --feed are different leagues: use one"); process.exit(2); }
    process.env.RINGSIDE_NO_SEED = "1"; // the server must open the league written here, not seed the demo over it
    const { demoProvider } = await import("../lib/providers/demo");
    const { loadFeed } = await import("../lib/feed");
    const { ingest } = await import("../lib/ingest");
    const { getDb } = await import("../lib/db");
    const { providerOf } = await import("../tests/helpers");
    const t0 = performance.now();
    const feed = await loadFeed(demoProvider(new Date("2026-10-03"), { scale }));
    await ingest(await getDb(), providerOf(feed, "smoke-scale"));
    console.log(`scale ${scale}: ${feed.boxers.length.toLocaleString()} fighters, ${feed.bouts.length.toLocaleString()} bouts, loaded in ${Math.round((performance.now() - t0) / 1000)} s`);
  }

  // seed and read the league in this process, then let the server open the same file
  const { getWorld } = await import("../lib/world");
  const { smokeRoutes, crawlRoutes, problemsIn, arabicLeaks, flippedRecords } = await import("../lib/smoke");
  const { securityProblems, STATIC_HEADERS } = await import("../lib/security");
  const world = await getWorld();
  // `--facts unknown` makes a real feed's gaps real: two fighters in three lose height, reach, birth year, stance and debut year, and a further third lose
  // reach and birth year, so every page that shows or uses those facts is rendered with some of them missing (no page may fail, show "null" or a made-up value)
  if (arg("facts") === "unknown") {
    const { getDb } = await import("../lib/db");
    const d = await getDb();
    d.exec("UPDATE boxers SET height_cm = NULL, reach_cm = NULL, birth_year = NULL, stance = NULL, turned_pro = NULL, birth_date = NULL, debut_date = NULL WHERE id % 3 = 0");
    d.exec("UPDATE boxers SET reach_cm = NULL, birth_year = NULL, birth_date = NULL WHERE id % 3 = 1");
    console.log("facts: unknown for two fighters in three");
  }
  // `--crawl N` adds up to N of every kind of page with a parameter (and every division, list and year), the extremes first: what only some records trip
  const crawl = arg("crawl") === undefined ? 0 : Math.max(1, Math.floor(Number(arg("crawl"))));
  const routes = [...smokeRoutes(world), ...(crawl ? crawlRoutes(world, crawl) : [])];
  if (crawl) console.log(`crawl: ${routes.length} pages in all, each in English and Arabic`);

  const port = Number(arg("port")) || (await freePort());
  const base = `http://127.0.0.1:${port}`;
  const log: string[] = [];
  const server = spawn(process.execPath, [path.join("node_modules", "next", "dist", "bin", "next"), "start", "-p", String(port)], {
    env: { ...process.env, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", INDEXABLE: "" }, stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (d) => log.push(String(d)));
  server.stderr.on("data", (d) => log.push(String(d)));
  const stop = () => { try { server.kill("SIGTERM"); } catch { /* already gone */ } for (const f of [db, accounts]) for (const ext of ["", "-wal", "-shm"]) fs.rmSync(f + ext, { force: true }); };
  process.on("exit", stop);

  let ready = false;
  for (let i = 0; i < 120 && !ready; i++) {
    try { ready = (await fetch(`${base}/robots.txt`, { signal: AbortSignal.timeout(2000) })).status > 0; } catch { await new Promise((r) => setTimeout(r, 500)); }
  }
  if (!ready) { console.error("The server did not start:\n" + log.join("").slice(-2000)); stop(); process.exit(2); }

  let failures = 0, checked = 0;
  const slow: string[] = [];
  const run = async (url: string, label: string, route: (typeof routes)[number], locale: "en" | "ar") => {
    const t0 = performance.now();
    try {
      const res = await fetch(base + url, { redirect: "manual", signal: AbortSignal.timeout(60000) });
      const body = await res.text();
      const bad = problemsIn(route, locale, res.status, res.headers.get("content-type") ?? "", body);
      // the browser-side contract: the policy and nonce on every page, the standing headers on everything (see lib/security.ts)
      if (/text\/html/.test(res.headers.get("content-type") ?? "")) bad.push(...securityProblems(res.headers, body));
      if (feedName === "hostile" && /text\/html/.test(res.headers.get("content-type") ?? "") && body.includes(HOSTILE_MARKUP)) bad.push("hostile markup from a fighter's name is on the page as markup, not escaped");
      if (locale === "ar" && /text\/html/.test(res.headers.get("content-type") ?? "")) bad.push(...flippedRecords(body).map((l) => `a record shown backwards on the Arabic page: ${l}`));
      if (locale === "ar" && (feedName === undefined || feedName === "empty") && scale === 1 && /text\/html/.test(res.headers.get("content-type") ?? "")) bad.push(...arabicLeaks(body).map((l) => `English on the Arabic page: ${l}`));
      else for (const h of STATIC_HEADERS) if (res.headers.get(h.key) !== h.value) bad.push(`header ${h.key} is ${res.headers.get(h.key) ?? "missing"}`);
      checked++;
      const ms = Math.round(performance.now() - t0);
      if (ms >= 1000) slow.push(`${ms} ms  ${locale} ${url}`);
      if (bad.length) { failures++; console.log(`✗ ${locale} ${url}  (${label}, ${ms} ms)`); for (const b of bad) console.log(`    - ${b}`); } else console.log(`✓ ${locale} ${url}  (${label}, ${ms} ms)`);
    } catch (e) { failures++; checked++; console.log(`✗ ${locale} ${url}  (${label})\n    - ${(e as Error).message}`); }
  };
  for (const r of routes) {
    if (r.kind === "page" || r.kind === "missing") {
      await run(r.path, r.label, r, "en");
      if (!r.englishOnly) await run(r.path === "/" ? "/ar" : `/ar${r.path}`, r.label, r, "ar");
    } else if (r.kind === "png" && !r.path.startsWith("/api/")) { // a share card is served in both languages
      await run(r.path, r.label, r, "en");
      await run(`/ar${r.path}`, r.label, r, "ar");
    } else await run(r.path, r.label, r, "en");
  }
  stop();
  if (slow.length) console.log(`\n${slow.length} page${slow.length === 1 ? "" : "s"} took a second or more:\n${slow.sort((a, b) => parseInt(b) - parseInt(a)).slice(0, 25).map((x) => "  " + x).join("\n")}`);
  console.log(`\n${checked - failures}/${checked} ok${failures ? ` · ${failures} with problems` : ""}`);
  if (failures) console.log("\nserver log (tail):\n" + log.join("").split("\n").slice(-25).join("\n"));
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
