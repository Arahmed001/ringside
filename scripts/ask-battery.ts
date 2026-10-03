/**
 * npm run ask:battery [-- --batch 4]
 * How much of what people type does the rule-based "Ask the data" planner (no API key) understand? Runs tests/ask-battery.ts over the demo league and prints
 * the rate for each batch and every question it gets wrong. Add questions to a NEW batch in that file, run this once BEFORE changing the planner (that
 * number is the honest one: the planner has not seen them), then fix what fails; after that the batch only guards against regressions (tests/ask-battery.test.ts).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const only = process.argv.includes("--batch") ? Number(process.argv[process.argv.indexOf("--batch") + 1]) : null;
process.env.RINGSIDE_NOW = "2026-10-03";
process.env.DATABASE_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ringside-battery-")), "ringside.db");
process.env.ACCOUNTS_DB_PATH = process.env.DATABASE_PATH.replace(/ringside\.db$/, "accounts.db");

async function main() {
  const w = await (await import("../lib/world")).getWorld();
  const { planByRules } = await import("../lib/ask/rules");
  const { battery } = await import("../tests/ask-battery");
  const cases = battery(w).filter((c) => !only || c.batch === only);
  const rate = new Map<number, [number, number]>();
  const wrong: string[] = [];
  for (const c of cases) {
    const calls = planByRules(c.q, w, {}), first = calls[0];
    const want = c.tool === null ? [] : Array.isArray(c.tool) ? c.tool : [c.tool];
    const ok = c.tool === null ? calls.length === 0 : !!first && want.includes(first.tool) && Object.entries(c.args ?? {}).every(([k, v]) => JSON.stringify(first.args[k]) === JSON.stringify(v));
    const r = rate.get(c.batch ?? 0) ?? [0, 0]; r[1]++; if (ok) r[0]++; rate.set(c.batch ?? 0, r);
    if (!ok) wrong.push(`  batch ${c.batch} ${c.lang === "ar" ? "[ar] " : ""}${c.q.slice(0, 64).padEnd(64)} wanted ${c.tool === null ? "none" : want.join("|")}${c.args ? JSON.stringify(c.args) : ""}, got ${first ? first.tool + JSON.stringify(first.args) : "none"}`);
  }
  for (const [b, [ok, n]] of [...rate].sort((a, c) => a[0] - c[0])) console.log(`batch ${b}: ${ok}/${n} (${Math.round((100 * ok) / n)}%)`);
  if (wrong.length) console.log(`\n${wrong.length} not understood as expected:\n${wrong.join("\n")}`);
  fs.rmSync(path.dirname(process.env.DATABASE_PATH!), { recursive: true, force: true });
  process.exit(wrong.length ? 1 : 0);
}
main();
