/**
 * npm run build && npm run e2e [-- --only forum,palette] [--workers 3] [--port N] [--db FILE] [--list] [--headed] [--keep]
 * The end-to-end suite (docs/e2e.md): the critical flows (sign up and in, password, watchlist, picks, search, lists, compare, report a mistake, the forum and its
 * moderation, deleting an account, the 404 page) and the keyboard-only checks, driven in a real browser in English and Arabic at 375 and 1280 px.
 * It starts its own production server on a free port, on a TEMPORARY copy of the demo league (or of `--db FILE`) and a throwaway accounts file, runs the flows in
 * parallel (each in a browser context of its own, with accounts of its own), and exits 1 listing every flow that failed. Not part of `npm test`: it needs a build
 * and a browser. Playwright is found the way scripts/a11y-run.ts finds it (PLAYWRIGHT_MODULE, `playwright`, /opt/node-tools); it is not a dependency of the site.
 */
import { spawn, execSync, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { Harness, type Flow, type Server, type Variant } from "../e2e/harness";
import { FLOWS } from "../e2e/flows";

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : undefined; };
const has = (k: string) => process.argv.includes(`--${k}`);

const freePort = () => new Promise<number>((resolve, reject) => {
  const s = net.createServer();
  s.listen(0, "127.0.0.1", () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)); });
  s.on("error", reject);
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function loadPlaywright(): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const tries = [process.env.PLAYWRIGHT_MODULE, "playwright", "/opt/node-tools/node_modules/playwright"].filter(Boolean) as string[];
  for (const t of tries) { try { return createRequire(import.meta.url ?? __filename)(t); } catch { /* next */ } }
  console.error("playwright is not installed. Install it where you like (npm i -g playwright && npx playwright install chromium) and run again, or point PLAYWRIGHT_MODULE at it.");
  process.exit(2);
}

/** The process ids under `root` (the server may fork), read from `ps`; the server renames itself "next-server (v16...)", so names are no use for finding it. */
function descendants(root: number): number[] {
  let rows: [number, number][] = [];
  try { rows = execSync("ps -eo pid,ppid", { encoding: "utf8" }).split("\n").slice(1).map((l) => l.trim().split(/\s+/).map(Number) as [number, number]).filter((r) => r.length === 2 && !r.some(Number.isNaN)); } catch { /* no ps */ }
  const out = [root];
  for (let i = 0; i < out.length; i++) for (const [pid, ppid] of rows) if (ppid === out[i] && !out.includes(pid)) out.push(pid);
  return out;
}

let child: ChildProcess | null = null;
let tmp = "";
function stopServer() {
  if (!child?.pid) return;
  const pids = descendants(child.pid);
  for (const sig of ["SIGTERM", "SIGKILL"] as const) {
    for (const p of pids) { try { process.kill(p, sig); } catch { /* gone */ } }
    if (sig === "SIGTERM") { try { execSync("sleep 0.3"); } catch { /* ignore */ } }
  }
  child = null;
}

async function boot(): Promise<Server> {
  if (!fs.existsSync(".next/BUILD_ID")) { console.error("no production build: run  npm run build  first"); process.exit(2); }
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ringside-e2e-"));
  const mainDb = path.join(tmp, "demo.db"), accountsDb = path.join(tmp, "accounts.db");
  const given = arg("db");
  if (given) { // a COPY of the league you name: the original is never opened for writing
    if (!fs.existsSync(given)) { console.error(`--db: no file at ${given}`); process.exit(2); }
    for (const ext of ["", "-wal", "-shm"]) if (fs.existsSync(given + ext)) fs.copyFileSync(given + ext, mainDb + ext);
  }
  const port = Number(arg("port") ?? (await freePort()));
  const base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [path.join("node_modules", "next", "dist", "bin", "next"), "start", "-p", String(port)], {
    env: {
      ...process.env, NODE_ENV: "production", DATABASE_PATH: mainDb, ACCOUNTS_DB_PATH: accountsDb, RINGSIDE_NOW: "2026-10-03", NEXT_TELEMETRY_DISABLED: "1",
      FORUM_AUTO_HIDE_REPORTS: "2", // the smallest number the setting allows, so the automatic hide can be reached with two aged accounts
      ...(given ? { RINGSIDE_NO_SEED: "1" } : {}),
    }, stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout?.on("data", (d) => { log += d; }); child.stderr?.on("data", (d) => { log += d; });
  for (let i = 0; i < 600; i++) {
    if (child.exitCode !== null) throw new Error(`the server stopped while starting:\n${log}`);
    try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* not up yet */ }
    if (i === 599) throw new Error("the server did not become ready in 150 s");
    await sleep(250);
  }
  await (await fetch(`${base}/boxers`)).arrayBuffer(); // the first request that reads data builds (and, for a throwaway league, seeds) the database the flows read fighters from
  child.on("exit", () => { if (has("verbose")) console.log(log); });
  return { base, accountsDb, mainDb, tmp };
}

interface Job { flow: Flow; v: Variant; name: string }
const nameOf = (f: Flow, v: Variant) => `${f.name} [${v.lang}@${v.width}]`;

async function main() {
  const only = arg("only")?.split(",").map((s) => s.trim()).filter(Boolean);
  const flows = only ? FLOWS.filter((f) => only.some((o) => f.name.includes(o))) : FLOWS;
  const jobs: Job[] = flows.flatMap((flow) => flow.variants.map((v) => ({ flow, v, name: nameOf(flow, v) })));
  if (has("list")) { for (const j of jobs) console.log(j.name); console.log(`${jobs.length} runs of ${flows.length} flows`); return; }
  if (!jobs.length) { console.error(`no flow matches ${only?.join(",")}`); process.exit(2); }

  const started = Date.now();
  const { chromium } = await loadPlaywright();
  const server = await boot();
  console.log(`server ${server.base} (temporary league in ${server.tmp})`);
  const browser = await chromium.launch({ headless: !has("headed") });
  const workers = Math.max(1, Number(arg("workers") ?? 3));
  const queue = [...jobs];
  const failures: string[] = [];
  let done = 0;

  async function worker() {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const t0 = Date.now();
      const h = new Harness(server, browser, job.v, job.name);
      let error: Error | null = null;
      try {
        await h.init();
        await Promise.race([job.flow.run(h, job.v), new Promise((_, rej) => setTimeout(() => rej(new Error("the flow took more than 150 s")), 150_000).unref())]);
      } catch (e) { error = e as Error; }
      const problems = [...new Set(h.problems)];
      const shots = await h.finish(!!error || problems.length > 0);
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      done++;
      if (!error && problems.length === 0) { console.log(`ok    ${job.name} (${secs}s)`); continue; }
      const why = [error ? error.message.split("\n").slice(0, 6).join("\n      ") : "", ...problems.map((p) => `watched: ${p}`)].filter(Boolean).join("\n      ");
      console.log(`FAIL  ${job.name} (${secs}s)\n      ${why}${shots.length ? `\n      pictures: ${shots.join(", ")}` : ""}`);
      failures.push(job.name);
    }
  }
  await Promise.all(Array.from({ length: Math.min(workers, jobs.length) }, worker));

  await browser.close();
  stopServer();
  if (failures.length === 0 && !has("keep")) fs.rmSync(tmp, { recursive: true, force: true });
  else console.log(`kept ${tmp}`);
  console.log(`\n${done} runs of ${flows.length} flows in ${((Date.now() - started) / 1000).toFixed(0)} s, ${failures.length} failed${failures.length ? `: ${failures.join("; ")}` : ""}`);
  process.exit(failures.length ? 1 : 0);
}
for (const s of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(s, () => { stopServer(); process.exit(130); });
process.on("exit", stopServer);
main().catch((e) => { stopServer(); console.error(e.message ?? e); process.exit(1); });
