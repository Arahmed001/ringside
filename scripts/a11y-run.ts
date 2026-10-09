/**
 * npm run a11y -- [--db FILE] [--port 3481] [--paths /a,/b] [--widths 375,1280] [--langs en,ar] [--headed]
 * The browser sweep of docs/accessibility.md ("Re-running the sweep"), run for you: for every page, in both languages, at phone and desktop width, it loads
 * the page in a real browser, runs scripts/a11y-sweep.js (axe-core, horizontal overflow with WCAG 1.4.12 text spacing forced on, clipped text, tiny text,
 * chart text under 12 px, overlapping boxes, exactly one h1) and prints "ok" or what is wrong. Exits 1 if any page is not clean.
 * It starts its own production server on the database (default: a throwaway demo league), so it needs a build (`npm run build`) and a browser:
 * `npx playwright install chromium` once (the package is loaded when it runs; it is not a dependency of the site). Takes several minutes for all pages.
 */
import { spawn, execSync, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { NAV_GROUPS, OFF_NAV } from "../lib/nav";

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : undefined; };
const port = Number(arg("port") ?? 3481);
const base = `http://localhost:${port}`;
const widths = (arg("widths") ?? "375,1280").split(",").map(Number);
const langs = (arg("langs") ?? "en,ar").split(",");
if (!fs.existsSync(".next/BUILD_ID")) { console.error("no production build: run  npm run build  first"); process.exit(2); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ringside-a11y-"));
const db = path.resolve(arg("db") ?? path.join(tmp, "demo.db"));
let child: ChildProcess | null = null;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const killPort = () => { try { for (const pid of execSync(`lsof -tiTCP:${port} -sTCP:LISTEN`, { encoding: "utf8" }).split("\n").filter(Boolean)) process.kill(Number(pid)); } catch { /* nothing listening */ } };
/** Asks the port itself (lsof does not always see a server started from another shell): is anything answering there? */
const portBusy = () => new Promise<boolean>((resolve) => { const c = net.connect({ port, host: "127.0.0.1" }); c.once("connect", () => { c.destroy(); resolve(true); }); c.once("error", () => resolve(false)); });
const stop = () => { if (child?.pid) { try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill(); } } killPort(); child = null; };

async function boot() {
  killPort();
  for (let i = 0; i < 40 && (await portBusy()); i++) await sleep(250); // a server that is still shutting down would answer the health check and hold the port
  if (await portBusy()) throw new Error(`port ${port} is in use by a server this script cannot stop (a leftover?): stop it, or pick another port with --port`);
  child = spawn("npx", ["next", "start", "-p", String(port)], {
    env: { ...process.env, NODE_ENV: "production", DATABASE_PATH: db, ACCOUNTS_DB_PATH: path.join(tmp, "accounts.db"), RINGSIDE_NOW: "2026-10-03", NEXT_TELEMETRY_DISABLED: "1" }, stdio: "ignore",
    detached: true, // its own process group, so stop() can end the server under the npx wrapper too
  });
  for (let i = 0; i < 600; i++) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) throw new Error("the server stopped while starting");
    try { if ((await fetch(`${base}/api/health`)).ok) return; } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error("the server did not become ready in 150 s");
}

/** One of each kind of page that has an id in its address. */
function samples(): string[] {
  const d = new DatabaseSync(db, { readOnly: true });
  const one = (sql: string) => (d.prepare(sql).get() as Record<string, string | number> | undefined);
  const slug = one("SELECT slug FROM boxers ORDER BY rating DESC LIMIT 1")?.slug;
  const other = one("SELECT slug FROM boxers ORDER BY rating DESC LIMIT 1 OFFSET 1")?.slug;
  const ev = one("SELECT id FROM events WHERE date <= '2026-10-03' ORDER BY date DESC LIMIT 1")?.id;
  const bout = one("SELECT id FROM bouts WHERE method IS NOT NULL ORDER BY id DESC LIMIT 1")?.id;
  const up = one("SELECT b.id FROM bouts b JOIN events e ON e.id = b.event_id WHERE e.date > '2026-10-03' AND b.method IS NULL ORDER BY e.date LIMIT 1")?.id;
  d.close();
  return [`/boxers/${slug}`, `/events/${ev}`, `/bouts/${bout}`, ...(up ? [`/previews/${up}`] : []), `/compare?a=${slug}&b=${other}`];
}

async function loadPlaywright(): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const tries = [process.env.PLAYWRIGHT_MODULE, "playwright", "/opt/node-tools/node_modules/playwright"].filter(Boolean) as string[];
  for (const t of tries) { try { return createRequire(import.meta.url ?? __filename)(t); } catch { /* next */ } }
  console.error("playwright is not installed. Install it where you like (npm i -g playwright && npx playwright install chromium) and run again, or point PLAYWRIGHT_MODULE at it.");
  process.exit(2);
}

async function main() {
  const { chromium } = await loadPlaywright();
  const axe = fs.readFileSync(path.join("node_modules", "axe-core", "axe.min.js"), "utf8");
  const sweep = fs.readFileSync(path.join("scripts", "a11y-sweep.js"), "utf8");
  await boot();
  await (await fetch(base + "/boxers")).arrayBuffer(); // the first request that reads data builds (and, for a throwaway league, seeds) the database that the sample pages are read from
  const pathsEn = arg("paths")?.split(",") ?? [...new Set(["/", ...NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href)), ...OFF_NAV.filter((p) => p !== "/review" && p !== "/review/reports" && p !== "/review/updates"), ...samples()])];
  const browser = await chromium.launch({ headless: !process.argv.includes("--headed") });
  let pages = 0; const bad: string[] = [];
  for (const lang of langs) for (const w of widths) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, bypassCSP: true });
    const page = await ctx.newPage();
    for (const p of pathsEn) {
      const url = base + (lang === "ar" ? (p === "/" ? "/ar" : `/ar${p}`) : p);
      try {
        const res = await page.goto(url, { waitUntil: "load", timeout: 30000 });
        if (!res || res.status() >= 400) { bad.push(`${lang} w${w} ${p}: HTTP ${res?.status()}`); console.log(`BAD  ${lang} w${w} ${p}: HTTP ${res?.status()}`); continue; }
        await page.evaluate(axe); await page.evaluate(sweep);
        const out: string = await page.evaluate("__check()");
        pages++;
        if (!out.startsWith("ok ")) { bad.push(`${lang} w${w} ${p}: ${out}`); console.log(`BAD  ${lang} w${w} ${p}\n     ${out}`); }
      } catch (e) { bad.push(`${lang} w${w} ${p}: ${(e as Error).message}`); console.log(`BAD  ${lang} w${w} ${p}: ${(e as Error).message.split("\n")[0]}`); }
    }
    await ctx.close();
    console.log(`-- ${lang} at ${w}px: done`);
  }
  await browser.close();
  stop(); fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${pages} page checks, ${bad.length} not clean`);
  process.exit(bad.length ? 1 : 0);
}
process.on("SIGINT", () => { stop(); process.exit(130); });
main().catch((e) => { stop(); console.error(e.message); process.exit(1); });
