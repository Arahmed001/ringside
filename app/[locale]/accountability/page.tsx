import Link from "@/components/L";
import { getWorld } from "@/lib/world";
import { getDb } from "@/lib/db";
import { liveRecord } from "@/lib/ledger";
import { LiveLedger } from "@/components/LiveLedger";
import { calibrationVerdict, finishVerdict, record, weightsInUse } from "@/lib/accountability";
import { ScrollRegion } from "@/components/ScrollRegion";
import { CalibrationChart } from "@/components/CalibrationChart";
import { BarList } from "@/components/charts";
import { Stat } from "@/components/ui";
import { divisionLabel } from "@/lib/divisions";
import { fmtDate, pct } from "@/lib/format";
import { getT } from "@/lib/i18n/server";
import { metaFor } from "@/lib/seo-server";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => metaFor(params, (p, t) => ({
  path: "/accountability", title: t("Track record"),
  description: t("How often the Ringside win model picks the winner, whether its percentages can be trusted, where it is overconfident and its biggest misses, checked against every completed fight."),
}));

export default async function Accountability() {
  const t = await getT();
  const w = await getWorld();
  const r = record(w);
  const live = liveRecord(await getDb(), w);
  const rc = r.recent;
  const cal = calibrationVerdict(rc.calibration);
  const fin = finishVerdict(rc.finish);
  const wt = weightsInUse();
  const d = (s: string | null) => (s ? fmtDate(s, undefined, t.locale) : "–");
  const f2 = (x: number) => x.toFixed(3);
  const calText = cal.verdict === "calibrated" ? t("Well calibrated: when the model is confident, it is right about as often as it says.")
    : cal.verdict === "under" ? t("Under-confident: it picks the winner more often than its percentages claim, so they sit too close to 50%.")
    : t("Over-confident: it picks the winner less often than its percentages claim.");
  const finText = fin.verdict === "calibrated" ? t("Its finish estimates are about right.") : fin.verdict === "high" ? t("Its finish estimates run high: fewer fights end early than it expects.") : t("Its finish estimates run low: more fights end early than it expects.");

  if (!rc.n) return <div className="space-y-4"><h1 className="font-display text-5xl font-extrabold uppercase">{t("Track record")}</h1><p className="text-muted">{t("There are not enough completed fights to check the model yet.")}</p></div>;

  return (
    <div className="space-y-12">
      <div>
        <div className="eyebrow mb-2">{t("Model accountability")}</div>
        <h1 className="font-display text-5xl font-extrabold uppercase">{t("Track record")}</h1>
        <p className="mt-2 max-w-2xl text-muted">{t("Before every fight the model gives each fighter a win probability. This page checks those numbers against what actually happened, using only what was known before each opening bell.")}</p>
      </div>

      {live.locked > 0 && <LiveLedger w={w} rec={live} />}

      <section className="card p-5">
        <div className="eyebrow mb-2">{t("A backtest, not a live record")}</div>
        <p className="max-w-3xl text-sm text-ink/90">{t("These are the calls the model would have made before each of the {n} completed fights in the database, rebuilt from what was known at the time: ratings, records and layoffs up to each fighter’s previous bout. Its settings were chosen with these results in view, so the headline figures use the most recent quarter of fights ({from} to {to}), the period it was not fitted on.", { n: r.all.n.toLocaleString("en-US"), from: d(r.splitDate), to: d(rc.to) })}</p>
        <p className="mt-2 max-w-3xl text-xs text-muted">{wt.finishFitted ? t("The early-finish estimate is fitted to results.") : t("The early-finish estimate is the hand-set rule, not yet fitted to results.")} {wt.fitted ? t("Weights in use: the Elo scale is fitted to results (×{k} the plain Elo expectation); the other terms are hand-set.", { k: wt.eloScale.toFixed(1) }) : t("Weights in use: hand-set defaults, not yet fitted to results.")}</p>
      </section>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t("Fights scored")} value={rc.n.toLocaleString("en-US")} sub={t("{from} to {to}", { from: d(rc.from), to: d(rc.to) })} />
        <Stat label={t("Picked the winner")} value={pct(rc.accuracy, 1)} sub={t("Higher-rated fighter won {p} · a coin flip is 50%", { p: pct(rc.eloAccuracy, 1) })} />
        <Stat label={t("Log loss")} value={f2(rc.logLoss)} sub={t("Lower is better · plain Elo {e} · coin flip {c}", { e: f2(rc.eloLogLoss), c: f2(rc.coinLogLoss) })} />
        <Stat label={t("Early finishes")} value={t("{p} vs {o}", { p: pct(rc.finish.predicted), o: pct(rc.finish.observed) })} sub={t("Predicted vs actual share of fights ending inside the distance")} />
      </section>

      <section className="grid gap-8 lg:grid-cols-[minmax(0,26rem)_1fr]">
        <CalibrationChart bins={rc.calibration} label={t("Calibration chart")} desc={rc.calibration.filter((b) => b.n >= 10).map((b) => t("{lo}–{hi}% confidence: right {o}% of {n} fights", { lo: Math.round(b.lo * 100), hi: Math.round(b.hi * 100), o: Math.round(b.observed * 100), n: b.n })).join("; ")} xLabel={t("Model’s confidence in its pick (%)")} yLabel={t("How often the pick won (%)")} perfect={t("Perfect calibration")} />
        <div className="min-w-0">
          <h2 className="font-display text-3xl font-bold uppercase">{t("When the model says 70%, is it right 70% of the time?")}</h2>
          <p className="mt-2 text-sm text-ink/90">{calText}</p>
          <ScrollRegion className="mt-4 rounded-2xl border border-line" label={t("When the model says 70%, is it right 70% of the time?")}>
            <table className="w-full min-w-[22rem] text-sm tabular" aria-label={t("When the model says 70%, is it right 70% of the time?")}>
              <thead className="text-xs uppercase tracking-widest text-muted"><tr className="border-b border-line"><th className="px-3 py-2 text-start">{t("Model’s confidence")}</th><th className="px-3 py-2 text-end">{t("Fights")}</th><th className="px-3 py-2 text-end">{t("It said")}</th><th className="px-3 py-2 text-end">{t("Actually won")}</th></tr></thead>
              <tbody>
                {rc.calibration.map((b) => (
                  <tr key={b.lo} className="border-b border-line/50 last:border-0"><td className="px-3 py-2"><span dir="ltr">{Math.round(b.lo * 100)}–{Math.round(b.hi * 100)}%</span></td><td className="px-3 py-2 text-end">{b.n}</td><td className="px-3 py-2 text-end">{b.n ? pct(b.predicted) : "–"}</td><td className="px-3 py-2 text-end text-gold">{b.n ? pct(b.observed) : "–"}</td></tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
          <p className="mt-4 text-sm text-muted">{t("The model expected {p} of fights to end inside the distance; {o} did.", { p: pct(rc.finish.predicted), o: pct(rc.finish.observed) })} {finText}</p>
        </div>
      </section>

      <section className="grid gap-8 lg:grid-cols-2">
        <div>
          <h2 className="mb-3 font-display text-3xl font-bold uppercase">{t("Accuracy by year")}</h2>
          <BarList rows={r.byYear.map((y) => ({ label: String(y.year), value: y.accuracy, sub: t.n(y.n, "{n} fight", "{n} fights") }))} max={1} fmt={(v) => pct(v)} color="var(--gold)" />
        </div>
        <div>
          <h2 className="mb-3 font-display text-3xl font-bold uppercase">{t("Accuracy by division")}</h2>
          <BarList rows={r.byDivision.slice(0, 10).map((x) => ({ label: divisionLabel(x.division, x.sex, t), value: x.accuracy, sub: t.n(x.n, "{n} fight", "{n} fights") }))} max={1} fmt={(v) => pct(v)} color="var(--gold)" />
        </div>
      </section>

      <section>
        <h2 className="font-display text-3xl font-bold uppercase">{t("Biggest surprises, by the model’s own numbers")}</h2>
        <p className="mt-1 text-sm text-muted">{t("The fights where the winner had the lowest chance in the model’s eyes before the first bell.")}</p>
        <ol className="mt-4 space-y-2">
          {r.upsets.map((u) => {
            const winner = w.byId.get(u.redWon ? u.redId : u.blueId)!, loser = w.byId.get(u.redWon ? u.blueId : u.redId)!;
            return (
              <li key={u.boutId}>
                <Link href={`/bouts/${u.boutId}`} className="card flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3 transition hover:bg-panel2/70">
                  <span className="font-semibold">{t("{winner} beat {loser}", { winner: t.name(winner.name), loser: t.name(loser.name) })}</span>
                  <span className="tabular text-sm text-muted">{fmtDate(u.date, undefined, t.locale)} · <span className="text-gold">{t("The model gave the winner {p}", { p: pct(u.pWinner) })}</span></span>
                </Link>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="card p-5 text-sm">
        <div className="eyebrow mb-2">{t("How this is computed")}</div>
        <ul className="list-disc space-y-1.5 ps-5 text-ink/90">
          <li>{t("Each fight is scored with the same model and settings as the predictor page, using ratings, records, age and layoff as they stood before the fight.")}</li>
          <li>{t("Draws, no-contests and fights where either fighter had no earlier bout in the database are left out.")}</li>
          <li>{t("Log loss punishes confident misses: 0.693 is what a coin flip scores, and lower is better. Plain Elo is the rating-only expectation.")}</li>
          <li>{t("Everything on this page is computed from the results in the database: nothing is estimated by an AI, and every figure can be reproduced.")}</li>
        </ul>
      </section>
    </div>
  );
}
