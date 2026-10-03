/**
 * npm run search:battery
 * How forgiving is fighter search? Runs tests/search-battery.ts (thousands of misspelt, abbreviated, re-ordered and Arabic queries made from the league's own
 * names) and prints, for each kind of mistake, how often the fighter meant is first and how often he is in the eight the type-ahead shows.
 * The groups: A the mistakes the matcher was designed for, B related ones, C respellings by ear, D kinds written after it was built.
 * Make a NEW group for new kinds of mistake and run this before changing the matcher: that number is the honest one.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.RINGSIDE_NOW = "2026-10-03";
process.env.DATABASE_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ringside-sbattery-")), "ringside.db");
process.env.ACCOUNTS_DB_PATH = process.env.DATABASE_PATH.replace(/ringside\.db$/, "accounts.db");

async function main() {
  const w = await (await import("../lib/world")).getWorld();
  const ar = await (await import("../lib/i18n/names")).getNames("ar");
  const { searchFighters } = await import("../lib/fighter-search");
  const { searchCases } = await import("../tests/search-battery");
  const stat = new Map<string, { n: number; t1: number; t8: number; g: string }>();
  const group: Record<string, [number, number, number]> = {};
  for (const c of searchCases(w, ar)) {
    const hits = searchFighters(w, c.q, { limit: 8, names: c.ar ? ar : {} });
    const i = hits.findIndex((b) => b.id === c.target);
    const s = stat.get(c.kind) ?? { n: 0, t1: 0, t8: 0, g: c.group };
    s.n++; if (i === 0) s.t1++; if (i >= 0) s.t8++; stat.set(c.kind, s);
    const g = (group[c.group] ??= [0, 0, 0]); g[0]++; if (i === 0) g[1]++; if (i >= 0) g[2]++;
  }
  const pc = (a: number, n: number) => `${Math.round((100 * a) / n)}%`.padStart(4);
  for (const [k, s] of [...stat].sort((a, b) => a[1].g.localeCompare(b[1].g))) console.log(`${s.g.padEnd(2)} ${k.padEnd(62)} first ${pc(s.t1, s.n)}  top eight ${pc(s.t8, s.n)}  (${s.n})`);
  console.log();
  for (const [g, [n, a, b]] of Object.entries(group)) console.log(`group ${g.padEnd(2)} first ${pc(a, n)}  top eight ${pc(b, n)}  (${n} queries)`);
  fs.rmSync(path.dirname(process.env.DATABASE_PATH!), { recursive: true, force: true });
  process.exit(0);
}
main();
