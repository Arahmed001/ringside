/** npm run model:fit : fit win-probability weights on the bouts in the database and write data/model-fit.json */
import fs from "node:fs";
import path from "node:path";
import { getWorld } from "../lib/world";
import { runFit } from "../lib/fit";

async function main() {
  const w = await getWorld();
  const r = runFit(w);
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  console.log(`bouts: ${r.rows.train} train + ${r.rows.test} held-out (${r.rows.splitDate} onwards)\n`);
  console.log("feature".padEnd(27), "log-odds effect".padStart(26), "±se".padStart(8), "z".padStart(7), "kept");
  for (const f of r.features) console.log(f.label.padEnd(27), `${f.effect >= 0 ? "+" : ""}${f.effect.toFixed(3)} ${f.unit}`.padStart(26), f.effectSe.toFixed(3).padStart(8), f.z.toFixed(1).padStart(7), f.selected ? "  yes" : "");
  const m = r.test;
  console.log("\nheld-out log-loss (lower is better):");
  for (const [k, v] of [["plain Elo (nothing fitted)", m.baseline], ["Elo refit", m.eloOnly], ["all features", m.full], ["selected features", m.selected]] as const) console.log(`  ${k.padEnd(28)} ${v.logLoss.toFixed(4)}   accuracy ${pct(v.accuracy)}   brier ${v.brier.toFixed(4)}`);
  console.log(`\nrecommended: ${r.recommended}`);
  console.log("calibration of the recommended model (held-out):"); for (const c of r.calibration) console.log(`  predicted ${c.bucket.padEnd(9)} n=${String(c.n).padStart(4)}  said ${pct(c.predicted)}  happened ${pct(c.actual)}`);
  const f = r.finish;
  if (f) {
    console.log(`\nearly-finish estimate (${f.rows.train} train + ${f.rows.test} held-out; ${pct(f.observed.test)} of held-out fights ended by stoppage):`);
    console.log(`  fitted: logit = ${f.coef.intercept.toFixed(3)} ${f.coef.koRate >= 0 ? "+" : "-"} ${Math.abs(f.coef.koRate).toFixed(3)}·(both KO rates) ${f.coef.koLoss >= 0 ? "+" : "-"} ${Math.abs(f.coef.koLoss).toFixed(3)}·(both KO-loss rates)`);
    for (const [k, v] of [["base rate only", f.test.constant], ["hand-set rule", f.test.heuristic], ["fitted", f.test.fitted]] as const) console.log(`  ${k.padEnd(16)} log-loss ${v.logLoss.toFixed(4)}   brier ${v.brier.toFixed(4)}   said ${pct(v.predicted)} on average, happened ${pct(v.observed)}`);
    console.log(`  recommended: ${f.recommended === "fitted" ? "fitted (applied to every finish estimate)" : "hand-set rule (the fit does not beat it by enough)"}`);
  } else console.log("\nearly-finish estimate: too few bouts to fit");
  fs.mkdirSync(path.join(process.cwd(), "data"), { recursive: true });
  fs.writeFileSync(path.join(process.cwd(), "data", "model-fit.json"), JSON.stringify(r, null, 2));
  console.log("\nwrote data/model-fit.json");
}
main().catch((e) => { console.error(e.message); process.exit(1); });
