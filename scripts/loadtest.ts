/**
 * npm run loadtest -- [--base http://localhost:3000] [--conc 50] [--total 1000] [--paths /a,/b] [--each]
 * Requests the pages in a loop with `conc` at a time and prints requests per second and p50/p95/p99 latency; `--each` also times every page
 * alone (25 requests each) to find the slow one. Point it at a server you own (a production build: `npm run build && npm start`), never at
 * someone else's. It is one Node process, so above a few hundred requests a second it measures itself.
 */
import { DEMO_SLUGS, LOAD_PATHS, summarise, withSlugs } from "../lib/loadtest";

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : undefined; };
const base = (arg("base") ?? "http://localhost:3000").replace(/\/$/, "");
const conc = Number(arg("conc") ?? 50), total = Number(arg("total") ?? 1000);
let paths = arg("paths")?.split(",") ?? LOAD_PATHS;
const hit = async (p: string) => { const t = performance.now(); const r = await fetch(base + p); await r.arrayBuffer(); return { ms: performance.now() - t, ok: r.ok }; };

async function main() {
  try { await hit("/api/health"); } catch { console.error(`no server answering at ${base}`); process.exit(2); }
  // the default paths name two demo-league fighters: against any other league they are 404s, so take two fighters that exist
  if (!arg("paths") && !(await hit(`/boxers/${DEMO_SLUGS[0]}`)).ok) {
    const slugs: string[] = [];
    for (const q of ["ra", "an", "ma", "el", "fi"]) { try { const r = await fetch(`${base}/api/fighters?q=${q}`); for (const h of (await r.json()) as { slug: string }[]) if (!slugs.includes(h.slug)) slugs.push(h.slug); } catch { /* try the next letter */ } if (slugs.length >= 2) break; }
    if (slugs.length >= 2) { paths = withSlugs(paths, slugs[0], slugs[1]); console.log(`(not the demo league: using ${slugs[0]} and ${slugs[1]} for the fighter pages)`); }
  }
  if (process.argv.includes("--each")) {
    for (const p of paths) { const l: number[] = []; for (let i = 0; i < 25; i++) l.push((await hit(p)).ms); const s = summarise(l, 1); console.log(`${p.padEnd(44)} p50 ${s.p50.toFixed(0).padStart(4)} ms  max ${s.max.toFixed(0).padStart(4)} ms`); }
  }
  const lat: number[] = []; let i = 0, bad = 0; const t0 = performance.now();
  await Promise.all(Array.from({ length: conc }, async () => { while (i < total) { const p = paths[i++ % paths.length]; try { const r = await hit(p); lat.push(r.ms); if (!r.ok) bad++; } catch { bad++; } } }));
  const s = summarise(lat, (performance.now() - t0) / 1000);
  console.log(`${conc} at a time, ${s.n} requests: ${s.reqPerSec.toFixed(0)} req/s, p50 ${s.p50.toFixed(0)} ms, p95 ${s.p95.toFixed(0)} ms, p99 ${s.p99.toFixed(0)} ms, max ${s.max.toFixed(0)} ms, failures ${bad}`);
  process.exit(bad ? 1 : 0);
}
main();
