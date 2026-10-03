/**
 * npm run build && npm run smoke       render every kind of page in English and Arabic on a real production server and inspect it
 *
 * Seeds a throwaway database with the demo league (clock pinned to 2026-10-03), starts `next start` on a free port, requests a
 * representative page of every kind plus the JSON and image endpoints, and checks each (status, language and direction, a heading,
 * no "undefined" / NaN / unfilled placeholders / error pages in the text). Exits 1 with the list of problems. CI runs it after the build.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";

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
  process.env.RINGSIDE_NOW = "2026-10-03";

  // seed and read the league in this process, then let the server open the same file
  const { getWorld } = await import("../lib/world");
  const { smokeRoutes, problemsIn } = await import("../lib/smoke");
  const world = await getWorld();
  const routes = smokeRoutes(world);

  const port = Number(arg("port")) || (await freePort());
  const base = `http://127.0.0.1:${port}`;
  const log: string[] = [];
  const server = spawn(process.execPath, [path.join("node_modules", "next", "dist", "bin", "next"), "start", "-p", String(port)], {
    env: { ...process.env, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", INDEXABLE: "" }, stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (d) => log.push(String(d)));
  server.stderr.on("data", (d) => log.push(String(d)));
  const stop = () => { try { server.kill("SIGTERM"); } catch { /* already gone */ } for (const ext of ["", "-wal", "-shm"]) fs.rmSync(db + ext, { force: true }); };
  process.on("exit", stop);

  let ready = false;
  for (let i = 0; i < 120 && !ready; i++) {
    try { ready = (await fetch(`${base}/robots.txt`, { signal: AbortSignal.timeout(2000) })).status > 0; } catch { await new Promise((r) => setTimeout(r, 500)); }
  }
  if (!ready) { console.error("The server did not start:\n" + log.join("").slice(-2000)); stop(); process.exit(2); }

  let failures = 0, checked = 0;
  const run = async (url: string, label: string, route: (typeof routes)[number], locale: "en" | "ar") => {
    const t0 = performance.now();
    try {
      const res = await fetch(base + url, { redirect: "manual", signal: AbortSignal.timeout(60000) });
      const body = await res.text();
      const bad = problemsIn(route, locale, res.status, res.headers.get("content-type") ?? "", body);
      checked++;
      const ms = Math.round(performance.now() - t0);
      if (bad.length) { failures++; console.log(`✗ ${locale} ${url}  (${label}, ${ms} ms)`); for (const b of bad) console.log(`    - ${b}`); } else console.log(`✓ ${locale} ${url}  (${label}, ${ms} ms)`);
    } catch (e) { failures++; checked++; console.log(`✗ ${locale} ${url}  (${label})\n    - ${(e as Error).message}`); }
  };
  for (const r of routes) {
    if (r.kind === "page" || r.kind === "missing") {
      await run(r.path, r.label, r, "en");
      await run(r.path === "/" ? "/ar" : `/ar${r.path}`, r.label, r, "ar");
    } else await run(r.path, r.label, r, "en");
  }
  stop();
  console.log(`\n${checked - failures}/${checked} ok${failures ? ` · ${failures} with problems` : ""}`);
  if (failures) console.log("\nserver log (tail):\n" + log.join("").split("\n").slice(-25).join("\n"));
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
