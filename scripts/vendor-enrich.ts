/**
 * npm run vendor:enrich -- [--dry-run] [--yes] [--contact you@example.org] [--steps a,b] [--skip a,b] [--media-limit N]
 * After the load: Arabic names, honours, photos, champions' reigns and belt, logo and venue pictures, from Wikidata, Wikipedia and Wikimedia Commons, in the order the runbook gives.
 * These steps CALL THOSE SERVICES and identify you by WIKIMEDIA_CONTACT (or --contact), so it lists them and changes nothing until you type ENRICH (`--yes` skips the question; a terminal
 * that is not interactive refuses without it). `--dry-run` only lists the steps. It reads and writes DATABASE_PATH (default ~/ringside-real/real.db), which must hold the loaded league.
 * Steps: staging, enrich, champions, venues, headshots, entities. A step that fails stops the run; running it again continues (the steps resume, skip what is done, or cache what they fetched).
 */
import { spawn } from "node:child_process";
import path from "node:path";
import readline from "node:readline";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { enrichPlan, isEnrichConfirmation, runSteps, type EnrichStep } from "../lib/vendor-enrich";

const argv = process.argv.slice(2);
const ask = (q: string): Promise<string> => new Promise((resolve) => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); rl.question(q, (a) => { rl.close(); resolve(a); }); });
const boxersIn = (file: string): number => { try { const db = new DatabaseSync(file, { readOnly: true }); try { return (db.prepare("SELECT COUNT(*) c FROM boxers").get() as { c: number }).c; } finally { db.close(); } } catch { return 0; } };

async function main() {
  const dry = argv.includes("--dry-run"), yes = argv.includes("--yes");
  const plan = enrichPlan(argv, process.env);
  const fighters = fs.existsSync(plan.database) ? boxersIn(plan.database) : 0;
  console.log(`vendor:enrich\n  database: ${plan.database}${fighters ? ` (${fighters.toLocaleString("en-US")} fighters)` : "  (missing or empty)"}\n  contact:  ${plan.contact ?? "(not set)"}  (sent to Wikimedia with every request)\n`);
  console.log("steps (they call Wikidata, Wikipedia and Wikimedia Commons; each prints its own progress):");
  plan.steps.forEach((s, i) => console.log(`  ${i + 1}. ${s.id.padEnd(9)} ${s.title}\n     ${s.what}`));
  if (dry) { console.log(`\n--dry-run: nothing was run.${plan.refusal ? `\nNote: it would be refused: ${plan.refusal}` : ""}`); return; }
  if (plan.refusal) { console.error(`\n${plan.refusal}`); process.exit(1); }
  if (!fighters) { console.error(`\n${plan.database} holds no fighters. Load the league first (npm run vendor:load), or point DATABASE_PATH at the loaded database. Nothing was run.`); process.exit(1); }
  if (!yes) {
    if (!process.stdin.isTTY) { console.error("\nThis is not an interactive terminal, so the confirmation cannot be typed. Run it in a terminal tab, or add --yes if you mean it. Nothing was run."); process.exit(1); }
    const a = await ask(`\nType ENRICH to run these ${plan.steps.length} step(s) against the services above, as ${plan.contact} (anything else cancels): `);
    if (!isEnrichConfirmation(a)) { console.log("Cancelled. Nothing was run."); return; }
  }
  const run = (s: EnrichStep, i: number) => new Promise<number>((resolve) => {
    console.log(`\n=== step ${i + 1} of ${plan.steps.length}: ${s.title} ===\n`);
    const c = spawn(process.execPath, ["--import", "tsx", path.join(__dirname, "..", s.script), ...s.args], { stdio: "inherit", env: { ...process.env, DATABASE_PATH: plan.database, WIKIMEDIA_CONTACT: plan.contact! } });
    c.on("close", (code) => resolve(code ?? 1));
  });
  const r = await runSteps(plan.steps, run);
  if (r.failed) { console.error(`\nStopped at step "${r.failed}" (exit ${r.code}); finished: ${r.done.join(", ") || "none"}. Read why above, then run the same command again: the steps resume and skip what is done.`); process.exit(r.code); }
  console.log(`\nDone: ${r.done.join(", ")}. The running site notices the change by itself. Next: runbook section 4 (check the result by hand).`);
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
