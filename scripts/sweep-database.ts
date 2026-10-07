/**
 * npm run sweep -- --database FILE [--each N]      call every library aggregate, per-card, per-fight and per-fighter view, and every Ask tool, on a database (a copy of the real one: it is only read)
 *
 * The same sweep the tests run on the demo and on an empty league (tests/league-sweep.ts), at the size of the real one: reports any call that throws or returns NaN or Infinity,
 * and the slowest calls. `--each N` takes N cards, fights and fighters at an even stride instead of all of them.
 */
import fs from "node:fs";
import path from "node:path";

const arg = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const file = arg("--database");
if (!file || !fs.existsSync(file)) { console.error("Usage: npm run sweep -- --database FILE [--each N]"); process.exit(2); }
process.env.DATABASE_PATH = path.resolve(file); process.env.BOXING_PROVIDER = "licensed"; process.env.RINGSIDE_NO_SEED = "1";
const each = arg("--each") ? Number(arg("--each")) : undefined;

async function main() {
  const { getWorld } = await import("../lib/world");
  const { sweepAggregates, sweepAskTools } = await import("../tests/league-sweep");
  const w = await getWorld();
  const slow = new Map<string, number>();
  const t0 = Date.now();
  const bad = await sweepAggregates(w, { each, slow });
  const ask = await sweepAskTools(w);
  console.log(`${w.boxers.length} fighters, ${w.bouts.length} fights, ${w.events.length} cards: ${slow.size} library calls and ${ask.runs} Ask runs in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  for (const [n, ms] of [...slow].sort((a, b) => b[1] - a[1]).slice(0, 5)) console.log(`  slowest: ${ms.toFixed(0)} ms  ${n}`);
  const all = [...bad, ...ask.bad];
  for (const b of all.slice(0, 60)) console.log(`  PROBLEM ${b.slice(0, 300)}`);
  console.log(all.length ? `${all.length} problems` : "no problems");
  process.exit(all.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
