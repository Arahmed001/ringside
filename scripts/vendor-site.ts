/**
 * npm run vendor:site                       what is running: the process, the address, how many fighters and bouts it serves
 * npm run vendor:site -- --start [--build]  start the site on the real database (~/ringside-real/real.db, or DATABASE_PATH) on port 3480 (--port N), detached: closing
 *                                           the tab or the panel does not stop it. `--build` runs the production build first (needed after the code changed; done
 *                                           on its own when there is no build yet). Log: site.log beside the database (site-PORT.log for a port other than 3480).
 * npm run vendor:site -- --stop             stop it (only the process this command started)
 * npm run vendor:site -- --restart [--build]  stop, then start (after a new load the running site notices the change by itself; a restart is for new code)
 * Run it in the project folder. It never sets the vendor key or the storage statement.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { livePid, logTail } from "../lib/vendor-fetch";
import { portInUse, siteHealth, sitePlan } from "../lib/vendor-site";

const argv = process.argv.slice(2);
const take = (flag: string): string | undefined => { const i = argv.indexOf(flag); if (i < 0) return undefined; const v = argv[i + 1]; argv.splice(i, v === undefined || v.startsWith("--") ? 1 : 2); return v; };
const has = (flag: string) => { const i = argv.indexOf(flag); if (i < 0) return false; argv.splice(i, 1); return true; };
const root = path.join(__dirname, "..");
const SITE = /next/;

async function main() {
  const port = take("--port"), database = take("--database"), waitMs = Number(take("--wait-ms") ?? 40000);
  const start = has("--start"), stop = has("--stop"), restart = has("--restart"), build = has("--build");
  const plan = sitePlan({ port, database });
  const running = () => livePid(plan.pid, SITE);
  const doStop = async (): Promise<boolean> => {
    const pid = running();
    if (!pid) return false;
    process.kill(pid, "SIGTERM");
    for (let i = 0; i < 20 && (await portInUse(plan.port)); i++) await new Promise((r) => setTimeout(r, 250));
    console.log(`Stopped the site (process ${pid}).`);
    return true;
  };
  if (stop) { if (!(await doStop())) console.log(`No site started by this command is running (no live process in ${plan.pid}).`); return; }
  if (!start && !restart) {
    const pid = running(), h = await siteHealth(plan.port);
    if (pid && h) console.log(`The site is running (process ${pid}) at http://localhost:${plan.port}: ${h.fighters.toLocaleString("en-US")} fighters, ${h.bouts.toLocaleString("en-US")} bouts, data updated ${h.updatedAt ?? "unknown"}.\n  database: ${plan.database}\n  log: ${plan.log}\n  stop: npm run vendor:site -- --stop`);
    else if (await portInUse(plan.port)) console.log(`Port ${plan.port} is held by something this command did not start (see:  lsof -iTCP:${plan.port} -sTCP:LISTEN ). Stop that first, or use another port:  npm run vendor:site -- --start --port 3490`);
    else console.log(`The site is not running. Start it:  npm run vendor:site -- --start${fs.existsSync(path.join(root, ".next", "BUILD_ID")) ? "" : " --build"}`);
    return;
  }
  if (!fs.existsSync(plan.database)) { console.error(`There is no database at ${plan.database}. Load one first (docs/load-day.md step 4) or point at one:  npm run vendor:site -- --start --database FILE`); process.exit(1); }
  if (restart) await doStop();
  const existing = running();
  if (existing) { console.error(`The site is already running (process ${existing}). Use --restart, or --stop.`); process.exit(1); }
  if (await portInUse(plan.port)) { console.error(`Port ${plan.port} is held by something this command did not start (lsof -iTCP:${plan.port} -sTCP:LISTEN shows what; kill its process id, or use another port with --port).`); process.exit(1); }
  fs.mkdirSync(path.dirname(plan.log), { recursive: true });
  const out = fs.openSync(plan.log, "a");
  if (build || !fs.existsSync(path.join(root, ".next", "BUILD_ID"))) {
    console.log("Building the site (about a minute)...");
    fs.writeSync(out, `\n--- ${new Date().toISOString()} build\n`);
    const b = spawnSync(process.execPath, [path.join(root, "node_modules", "next", "dist", "bin", "next"), "build"], { cwd: root, stdio: ["ignore", out, out], env: { ...process.env, ...plan.env } });
    if (b.status !== 0) { console.error(`The build failed (exit ${b.status}). The end of ${plan.log}:\n  ${logTail(plan.log, 12).join("\n  ")}`); process.exit(1); }
  }
  fs.writeSync(out, `\n--- ${new Date().toISOString()} start on port ${plan.port}, database ${plan.database}\n`);
  const child = spawn(process.execPath, [path.join(root, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(plan.port)], { cwd: root, stdio: ["ignore", out, out], detached: true, env: { ...process.env, ...plan.env } });
  let ended: number | null | undefined;
  child.on("exit", (code) => { ended = code; });
  child.unref();
  if (!child.pid) { console.error("The site could not be started."); process.exit(1); }
  fs.writeFileSync(plan.pid, `${child.pid}\n`);
  let h = null;
  for (let t = 0; t < waitMs && ended === undefined && !h; t += 500) { await new Promise((r) => setTimeout(r, 500)); h = await siteHealth(plan.port); }
  if (!h) { console.error(`The site did not come up${ended !== undefined ? ` (it ended, exit ${ended})` : " in time"}. The end of ${plan.log}:\n  ${logTail(plan.log, 12).join("\n  ")}`); process.exit(1); }
  console.log(`The site is running (process ${child.pid}) at http://localhost:${plan.port}: ${h.fighters.toLocaleString("en-US")} fighters, ${h.bouts.toLocaleString("en-US")} bouts.\n  Closing this tab does not stop it. Stop it:  npm run vendor:site -- --stop`);
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
