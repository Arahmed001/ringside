/**
 * npm run ask:names
 * How well does the rule-based "Ask the data" planner (no API key) read a fighter or trainer whose name is spelt with a slip? Runs tests/ask-names-battery.ts
 * over the demo league and prints the rate for each kind of slip and group, and the questions it gets wrong. As with the other batteries, make a NEW group
 * for new kinds of slip and run this before changing the planner: that number is the honest one.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.RINGSIDE_NOW = "2026-10-03";
process.env.DATABASE_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ringside-nbattery-")), "ringside.db");
process.env.ACCOUNTS_DB_PATH = process.env.DATABASE_PATH.replace(/ringside\.db$/, "accounts.db");
delete process.env.ANTHROPIC_API_KEY;

async function main() {
  const w = await (await import("../lib/world")).getWorld();
  const { nameCases, judge } = await import("../tests/ask-names-battery");
  const ar = await (await import("../lib/i18n/names")).getNames("ar");
  const verbose = process.argv.includes("--wrong");
  const kind = new Map<string, { n: number; ok: number; g: string }>();
  const group: Record<string, [number, number]> = {};
  const wrong: string[] = [];
  for (const c of nameCases(w, ar)) {
    const p = await judge(w, c, ar);
    const k = kind.get(c.kind) ?? { n: 0, ok: 0, g: c.group };
    k.n++; if (!p) k.ok++; kind.set(c.kind, k);
    const g = (group[c.group] ??= [0, 0]); g[0]++; if (!p) g[1]++;
    if (p) wrong.push(`  ${c.group} ${c.q.padEnd(60)} ${p}`);
  }
  const pc = (a: number, n: number) => `${Math.round((100 * a) / n)}%`.padStart(4);
  for (const [k, s] of [...kind].sort((a, b) => a[1].g.localeCompare(b[1].g) || a[0].localeCompare(b[0]))) console.log(`${s.g} ${k.padEnd(66)} ${pc(s.ok, s.n)}  (${s.n})`);
  console.log();
  for (const [g, [n, ok]] of Object.entries(group).sort()) console.log(`group ${g}: ${ok}/${n} (${pc(ok, n).trim()})`);
  if (verbose && wrong.length) console.log(`\n${wrong.length} wrong:\n${wrong.slice(0, 80).join("\n")}`);
  fs.rmSync(path.dirname(process.env.DATABASE_PATH!), { recursive: true, force: true });
  process.exit(0);
}
main();
