/**
 * npm run search:nl
 * How well does the plain-English fighter search (no API key) read a sentence with numbers in it? Runs tests/search-nl-battery.ts over the demo league and prints, for
 * each kind of sentence, whether the fighters returned are exactly the fighters described. Make a NEW group for new kinds of sentence and run this before changing the parser.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.RINGSIDE_NOW = "2026-10-03";
process.env.DATABASE_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ringside-nlbattery-")), "ringside.db");
process.env.ACCOUNTS_DB_PATH = process.env.DATABASE_PATH.replace(/ringside\.db$/, "accounts.db");
delete process.env.ANTHROPIC_API_KEY;

async function main() {
  const w = await (await import("../lib/world")).getWorld();
  const { heuristicParse, applyFilters } = await import("../lib/ai");
  const { nlCases, nlProblem } = await import("../tests/search-nl-battery");
  const countries = [...new Set(w.boxers.map((b) => b.country))];
  const group: Record<string, [number, number]> = {};
  const wrong: string[] = [];
  for (const c of nlCases()) {
    const f = heuristicParse(c.q, countries, w.today);
    const p = nlProblem(w, c, applyFilters(w.boxers.filter((b) => b.bouts > 0), f, w, {}));
    const g = (group[c.group] ??= [0, 0]); g[0]++; if (!p) g[1]++;
    if (p) wrong.push(`  ${c.group} ${c.q.padEnd(54)} ${JSON.stringify(f).slice(0, 80).padEnd(80)} ${p}`);
  }
  for (const [g, [n, ok]] of Object.entries(group).sort()) console.log(`group ${g}: ${ok}/${n} (${Math.round((100 * ok) / n)}%)`);
  if (wrong.length) console.log(`\n${wrong.length} wrong:\n${wrong.join("\n")}`);
  fs.rmSync(path.dirname(process.env.DATABASE_PATH!), { recursive: true, force: true });
  process.exit(0);
}
main();
