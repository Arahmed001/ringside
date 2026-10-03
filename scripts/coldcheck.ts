/**
 * npm run coldcheck -- [--db data/bench-20.db] [--port 3480] [--paths /a,/b] [--shared]
 * What does the first visitor to each page wait for? For every page it starts a fresh production server on the database (so nothing the
 * page needs has been computed yet beyond what start-up warms), waits until it is ready, requests the page once, then three more times,
 * and prints the first time against the usual time. Pages whose first visit costs 300 ms or more extra are flagged.
 * Restarting for every page is the point: in one long-running server the first page to need a table pays for it and every later page
 * looks cheap. `--shared` skips the restarts and measures one server visited in order (quicker, and it hides the shared costs).
 * Make a big database first with `npm run bench -- --scale 20 --keep` (data/bench-20.db). Needs a build (`npm run build`). Takes a few minutes at scale 20.
 */
import { spawn, execSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { NAV_GROUPS, OFF_NAV } from "../lib/nav";
import { SLOW_FIRST_VISIT_MS, coldCost } from "../lib/loadtest";

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : undefined; };
const db = path.resolve(arg("db") ?? "data/bench-20.db");
const port = Number(arg("port") ?? 3480);
const base = `http://localhost:${port}`;
if (!fs.existsSync(db)) { console.error(`no database at ${db}: make one with  npm run bench -- --scale 20 --keep`); process.exit(2); }
if (!fs.existsSync(".next/BUILD_ID")) { console.error("no production build: run  npm run build  first"); process.exit(2); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ringside-cold-"));
let child: ChildProcess | null = null;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const killPort = () => { try { for (const pid of execSync(`lsof -tiTCP:${port} -sTCP:LISTEN`, { encoding: "utf8" }).split("\n").filter(Boolean)) process.kill(Number(pid)); } catch { /* nothing listening */ } };

async function boot(): Promise<number> {
  killPort();
  const t0 = performance.now();
  child = spawn("npx", ["next", "start", "-p", String(port)], {
    env: { ...process.env, NODE_ENV: "production", DATABASE_PATH: db, ACCOUNTS_DB_PATH: path.join(tmp, "accounts.db"), RINGSIDE_NOW: "2026-10-03", RINGSIDE_NO_SEED: "1", NEXT_TELEMETRY_DISABLED: "1" }, stdio: "ignore",
  });
  for (let i = 0; i < 600; i++) {
    try { if ((await fetch(`${base}/api/health`)).ok) return performance.now() - t0; } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error("the server did not become ready in 150 s");
}
const stop = async () => { child?.kill(); killPort(); child = null; await sleep(500); };
const hit = async (p: string) => { const t = performance.now(); const r = await fetch(base + p); await r.arrayBuffer(); return { ms: performance.now() - t, status: r.status }; };

function samples(): string[] {
  const d = new DatabaseSync(db, { readOnly: true });
  const one = (sql: string) => (d.prepare(sql).get() as Record<string, string | number> | undefined);
  const slug = one("SELECT slug FROM boxers ORDER BY rating DESC LIMIT 1")?.slug;
  const ev = one("SELECT id FROM events WHERE date <= '2026-10-03' ORDER BY date DESC LIMIT 1")?.id;
  const bout = one("SELECT id FROM bouts WHERE method IS NOT NULL ORDER BY id DESC LIMIT 1")?.id;
  const up = one("SELECT b.id FROM bouts b JOIN events e ON e.id = b.event_id WHERE e.date > '2026-10-03' AND b.method IS NULL ORDER BY e.date LIMIT 1")?.id;
  const other = one("SELECT slug FROM boxers ORDER BY rating DESC LIMIT 1 OFFSET 1")?.slug;
  d.close();
  return [`/boxers/${slug}`, `/events/${ev}`, `/bouts/${bout}`, ...(up ? [`/previews/${up}`] : []), `/compare?a=${slug}&b=${other}`, "/on-this-day?d=03-06", "/ar", "/ar/on-this-day"];
}

async function main() {
  const bootMs = await boot();
  console.log(`database ${db}\nserver ready in ${(bootMs / 1000).toFixed(1)} s (start-up builds the world and warms what the pages compute: WARM_STEPS in lib/warm.ts)\n`);
  const paths = arg("paths")?.split(",") ?? ["/", ...NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href)), ...OFF_NAV.filter((p) => p !== "/review"), ...samples(), "/api/search?q=ram", "/api/fighters?q=ram"];
  const shared = process.argv.includes("--shared");
  if (!shared) await stop();
  const rows: { path: string; first: number; warm: number; extra: number; status: number }[] = [];
  for (const p of [...new Set(paths)]) {
    if (!shared) await boot();
    const f = await hit(p);
    const rest: number[] = [];
    for (let i = 0; i < 3; i++) rest.push((await hit(p)).ms);
    const c = coldCost(f.ms, rest);
    rows.push({ path: p, ...c, status: f.status });
    console.log(`${p.padEnd(48)} first ${c.first.toFixed(0).padStart(6)} ms   usual ${c.warm.toFixed(0).padStart(5)} ms   extra ${c.extra.toFixed(0).padStart(6)} ms${c.extra >= SLOW_FIRST_VISIT_MS ? "   <-- SLOW FIRST VISIT" : ""}${f.status !== 200 ? `   (status ${f.status})` : ""}`);
    if (!shared) await stop();
  }
  await stop();
  fs.rmSync(tmp, { recursive: true, force: true });
  const slow = rows.filter((r) => r.extra >= SLOW_FIRST_VISIT_MS);
  console.log(`\n${rows.length} pages, ${slow.length} with a first visit ${SLOW_FIRST_VISIT_MS} ms or more slower than usual${slow.length ? `: ${slow.map((r) => r.path).join(", ")}` : ""}`);
  process.exit(slow.length ? 1 : 0);
}
process.on("SIGINT", async () => { await stop(); process.exit(130); });
main().catch(async (e) => { console.error(e instanceof Error ? e.message : e); await stop(); process.exit(2); });
