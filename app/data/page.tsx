import type { Metadata } from "next";
import { coverage } from "@/lib/coverage";
import { loadFit } from "@/lib/model-fit";
import { activeWeights, DEFAULT_WEIGHTS } from "@/lib/model";
import { SectionTitle } from "@/components/ui";
import { pct } from "@/lib/format";

export const metadata: Metadata = { title: "Data & model" };

interface Source { name: string; supplies: string; licence: string; status: "built" | "partly" | "planned" | "blocked"; note: string }
const SOURCES: Source[] = [
  { name: "Demo league", supplies: "Everything: fictional fighters, trainers, weigh-ins, scorecards, punch stats", licence: "Generated, no rights issues", status: "built", note: "Development data only. It carries every field the real contract supports." },
  { name: "Licensed results feed", supplies: "Fighters, events, bouts, results, belts; sometimes weights, scorecards, referees", licence: "Per contract (storing and redisplay must be confirmed)", status: "planned", note: "Adapter contract is ready (lib/providers). Shortlist in PLAN.md §4." },
  { name: "Wikidata", supplies: "Birth date and place, nationality, height, weight, image, BoxRec ID, a few trainer links", licence: "CC0", status: "built", note: "~19.6k boxers; no bouts, weigh-ins or reliable trainers. Importer + enrichment tested." },
  { name: "Wikimedia Commons", supplies: "Freely licensed fighter photos with author and licence", licence: "CC BY / BY-SA / CC0 / public domain, attribution shown", status: "built", note: "Matches only on verified identity; non-commercial licences rejected." },
  { name: "Athletic commission results", supplies: "Official and pre-fight weights, officials, purses (US states such as Nevada)", licence: "Public records", status: "planned", note: "Automated requests to the Nevada site are blocked, so files must be downloaded manually. A parser is not built." },
  { name: "BoxRec", supplies: "The most complete records, trainers and weigh-ins in boxing", licence: "Scraping prohibited by its terms", status: "blocked", note: "Not used. Data is licensed to partners; an enquiry is the only legitimate route. Only the numeric ID is stored, as a cross-reference." },
  { name: "CompuBox", supplies: "Punch statistics", licence: "Paid", status: "planned", note: "The schema and charts are ready; needs a licence." },
  { name: "Editors", supplies: "Corrections and trainer/manager history with sources", licence: "Contributor terms", status: "planned", note: "Every row already carries a source field to make this auditable." },
];
const STATUS_STYLE: Record<Source["status"], string> = { built: "!border-win/40 !text-win", partly: "!border-gold/40 !text-gold", planned: "", blocked: "!border-red/40 !text-red" };
const STATUS_LABEL: Record<Source["status"], string> = { built: "Built", partly: "Partly built", planned: "Not yet", blocked: "Not used" };

export default async function DataPage() {
  const cov = await coverage();
  const fit = loadFit();
  const demo = (process.env.BOXING_PROVIDER ?? "demo") === "demo";
  const act = activeWeights();
  const eloScale = act.rating / DEFAULT_WEIGHTS.rating;

  return (
    <div className="space-y-12">
      <div>
        <div className="eyebrow mb-2">Provenance</div>
        <h1 className="font-display text-5xl font-extrabold uppercase">Data &amp; model</h1>
        <p className="mt-2 max-w-2xl text-muted">What is in the database, where each kind of fact comes from, how complete it is, and how well the prediction model does on fights it has never seen.</p>
      </div>

      <div className={`card p-4 text-sm ${demo ? "!border-gold/40" : ""}`}>
        {demo ? <><b className="text-gold">Demo mode.</b> Every fighter, trainer, judge and result here is fictional and simulated. Real data arrives through a licensed provider; nothing is scraped.</> : <><b className="text-win">Live provider.</b> Data comes from the configured licensed feed.</>}
      </div>

      <section>
        <SectionTitle eyebrow="Live from the database" title="Field coverage" />
        <div className="grid gap-5 lg:grid-cols-2">
          {cov.groups.map((g) => (
            <div key={g.title} className="card p-5">
              <div className="eyebrow mb-3">{g.title}</div>
              <ul className="space-y-3">
                {g.rows.map((r) => {
                  const f = r.of ? r.have / r.of : 0;
                  return (
                    <li key={r.field}>
                      <div className="mb-1 flex justify-between gap-3 text-xs"><span>{r.field}{r.note && <span className="ml-1.5 text-muted">· {r.note}</span>}</span><span className="tabular text-muted">{r.have.toLocaleString()} / {r.of.toLocaleString()} · <b className="text-ink">{pct(f)}</b></span></div>
                      <div className="h-2 overflow-hidden rounded-full bg-panel2"><div className="growx h-full rounded-full" style={{ width: `${f * 100}%`, background: f > 0.85 ? "var(--green)" : f > 0.4 ? "var(--gold)" : "var(--red)" }} /></div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted">Team history rows by source: {cov.stintSources.map((s) => `${s.source} (${s.n.toLocaleString()})`).join(", ") || "none"}. Weigh-ins by source: {cov.weighInSources.map((s) => `${s.source} (${s.n.toLocaleString()})`).join(", ") || "none"}. Wikidata staged: {cov.wikidataStaged.toLocaleString()} boxers, {cov.wikidataLinked.toLocaleString()} linked to our fighters.</p>
      </section>

      {cov.lastRun && (
        <section>
          <SectionTitle eyebrow="Checked before anything is written" title="Last data load" />
          <div className="card p-5">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="chip">{cov.lastRun.provider}</span>
              <span className="text-muted">{new Date(cov.lastRun.at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</span>
              <span className={`chip ${cov.lastRun.errors ? "!border-red/40 !text-red" : "!border-win/40 !text-win"}`}>{cov.lastRun.errors} error{cov.lastRun.errors === 1 ? "" : "s"}</span>
              <span className={`chip ${cov.lastRun.warnings ? "!border-gold/40 !text-gold" : ""}`}>{cov.lastRun.warnings} warning{cov.lastRun.warnings === 1 ? "" : "s"}</span>
              {Object.entries(cov.lastRun.dropped).map(([k, n]) => <span key={k} className="chip !border-red/40 !text-red">{n} {k.replace("_", " ")} row{n === 1 ? "" : "s"} dropped</span>)}
            </div>
            <p className="mt-3 text-xs text-muted">Loaded: {Object.entries(cov.lastRun.counts).map(([k, n]) => `${n.toLocaleString()} ${k}`).join(" · ")}.</p>
            {cov.lastRun.issues.length ? (
              <ul className="mt-4 space-y-2 text-sm">
                {cov.lastRun.issues.map((i) => (
                  <li key={`${i.severity}-${i.code}`} className="flex flex-wrap items-baseline gap-x-3 border-t border-line/60 pt-2">
                    <span className={`chip ${i.severity === "error" ? "!border-red/40 !text-red" : i.severity === "warning" ? "!border-gold/40 !text-gold" : ""}`}>{i.severity}</span>
                    <b>{i.code}</b><span className="tabular text-muted">×{i.n}</span><span className="text-xs text-muted">e.g. {i.example}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="mt-4 text-sm text-muted">No issues found. Rows that fail a check are dropped and listed here; suspicious ones are kept and flagged. Run <code className="rounded bg-panel2 px-1.5 py-0.5 text-ink">npm run data:check -- --file sample.json</code> to test a vendor sample first.</p>}
          </div>
        </section>
      )}

      <section>
        <SectionTitle eyebrow="Where facts come from" title="Source registry" />
        <div className="card overflow-x-auto p-2">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] uppercase tracking-widest text-muted"><th className="p-3">Source</th><th>Supplies</th><th>Licence</th><th>Status</th></tr></thead>
            <tbody>{SOURCES.map((s) => (
              <tr key={s.name} className="border-t border-line/60 align-top">
                <td className="p-3 font-semibold">{s.name}<div className="mt-1 max-w-xs text-xs font-normal text-muted">{s.note}</div></td>
                <td className="py-3 pr-4 text-muted">{s.supplies}</td><td className="py-3 pr-4 text-muted">{s.licence}</td>
                <td className="py-3 pr-3"><span className={`chip ${STATUS_STYLE[s.status]}`}>{STATUS_LABEL[s.status]}</span></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>

      <section>
        <SectionTitle eyebrow="Fit on past bouts, tested on the most recent 25%" title="Prediction model" />
        {!fit ? (
          <div className="card p-5 text-sm text-muted">No fit yet. Run <code className="rounded bg-panel2 px-1.5 py-0.5 text-ink">npm run model:fit</code> to learn weights from the bouts in the database.</div>
        ) : (
          <div className="space-y-5">
            <div className="grid gap-3 md:grid-cols-4">
              {([["Plain Elo", fit.test.baseline], ["Elo refit", fit.test.eloOnly], ["All features", fit.test.full], ["Selected features", fit.test.selected]] as const).map(([name, m]) => {
                const best = name.toLowerCase() === fit.recommended.toLowerCase();
                return (
                  <div key={name} className={`card p-4 ${best ? "!border-gold/50" : ""}`}>
                    <div className="flex items-center justify-between text-[11px] uppercase tracking-widest text-muted"><span>{name}</span>{best && <span className="text-gold">best</span>}</div>
                    <div className="font-display text-3xl font-bold tabular">{m.logLoss.toFixed(4)}</div>
                    <div className="text-xs text-muted">log-loss · {pct(m.accuracy, 1)} correct · Brier {m.brier.toFixed(3)}</div>
                  </div>
                );
              })}
            </div>
            <div className="card overflow-x-auto p-5">
              <div className="eyebrow mb-3">What the data says each factor is worth ({fit.rows.train.toLocaleString()} fights, {fit.rows.from} to {fit.rows.splitDate})</div>
              <table className="w-full text-sm">
                <thead><tr className="text-left text-[11px] uppercase tracking-widest text-muted"><th className="py-2">Factor</th><th>Effect on log-odds of winning</th><th>± error</th><th>z</th><th className="text-right">Clear signal?</th></tr></thead>
                <tbody>{fit.features.map((f) => (
                  <tr key={f.key} className="border-t border-line/60">
                    <td className="py-2">{f.label}</td><td className="tabular">{f.effect >= 0 ? "+" : ""}{f.effect.toFixed(3)} <span className="text-xs text-muted">{f.unit}</span></td>
                    <td className="tabular text-muted">{f.effectSe.toFixed(3)}</td><td className="tabular">{f.z.toFixed(1)}</td>
                    <td className="text-right">{f.selected ? <span className="chip !border-win/40 !text-win">yes</span> : <span className="text-xs text-muted">no</span>}</td>
                  </tr>
                ))}</tbody>
              </table>
              <p className="mt-3 text-xs text-muted">A factor needs |z| of about 2 or more to count as signal. Fitted on rating, reach, age, layoff, knockout rate, KO losses, experience, usual rehydration, fight-night weight edge, new-trainer flag and the trainer&apos;s prior win rate. In this demo league the weigh-in and trainer effects were planted but are small, so they are not detectable at this sample size. That is the honest answer, and real data will say what is really there.</p>
            </div>
            <div className="card p-5">
              <div className="eyebrow mb-3">Is it calibrated? ({fit.recommended}, held-out fights)</div>
              <ul className="space-y-2">{fit.calibration.map((c) => (
                <li key={c.bucket} className="grid grid-cols-[84px_1fr_120px] items-center gap-3 text-xs"><span className="text-muted">said {c.bucket}</span>
                  <div className="relative h-3 rounded-full bg-panel2"><div className="absolute inset-y-0 left-0 rounded-full bg-gold/60" style={{ width: `${c.predicted * 100}%` }} /><div className="absolute inset-y-0 w-0.5 bg-win" style={{ left: `${c.actual * 100}%` }} title="what actually happened" /></div>
                  <span className="tabular text-muted">{pct(c.predicted)} → <b className="text-ink">{pct(c.actual)}</b> <span className="opacity-60">n={c.n}</span></span></li>
              ))}</ul>
              <p className="mt-3 text-xs text-muted">Gold bar = average probability the model gave; green tick = how often those fighters actually won.</p>
            </div>
            <p className="text-sm text-muted">{eloScale > 1.05 ? <>The site&apos;s default predictions use the fitted rating scale (<b className="text-ink">{eloScale.toFixed(1)}×</b> a plain Elo expectation); the fit found ratings are compressed relative to true skill gaps in this league.</> : "The site's default predictions use the standard Elo scale."}</p>
          </div>
        )}
      </section>
    </div>
  );
}
