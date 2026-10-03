import { ScrollRegion } from "@/components/ScrollRegion";
import { coverage } from "@/lib/coverage";
import { loadFit } from "@/lib/model-fit";
import { activeWeights, DEFAULT_WEIGHTS } from "@/lib/model";
import { SectionTitle, Stat } from "@/components/ui";
import { pct } from "@/lib/format";
import { arabicReviewStatus } from "@/lib/i18n/review-status";
import { getT } from "@/lib/i18n/server";
import { msg } from "@/lib/i18n/t";
import { metaFor } from "@/lib/seo-server";
import { isDemoData } from "@/lib/seo";
import { siteContact, vendorCredit } from "@/lib/site-info";
import Link from "@/components/L";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => metaFor(params, (p, t) => ({
  path: "/data", title: t("Data & model"),
  description: t("Where every fact in the database comes from, how complete each field is, the latest data load, and how well the prediction model does on fights it has never seen."),
}));

interface Source { name: string; supplies: string; licence: string; status: "built" | "partly" | "planned" | "blocked"; note: string }
const SOURCES: Source[] = [
  { name: msg("Demo league"), supplies: msg("Everything: fictional fighters, trainers, weigh-ins, scorecards, punch stats"), licence: msg("Generated, no rights issues"), status: "built", note: msg("Development data only. It carries every field the real contract supports.") },
  { name: msg("Licensed results feed"), supplies: msg("Fighters, events, bouts, results, belts; sometimes weights, scorecards, referees"), licence: msg("Per contract (storing and redisplay must be confirmed)"), status: "planned", note: msg("Adapter contract is ready (lib/providers). Shortlist in PLAN.md §4.") },
  { name: msg("Wikidata"), supplies: msg("Birth date and place, nationality, height, weight, image, BoxRec ID, a few trainer links"), licence: msg("CC0"), status: "built", note: msg("~19.6k boxers; no bouts, weigh-ins or reliable trainers. Importer + enrichment tested.") },
  { name: msg("Wikimedia Commons"), supplies: msg("Freely licensed fighter photos with author and licence"), licence: msg("CC BY / BY-SA / CC0 / public domain, attribution shown"), status: "built", note: msg("Matches only on verified identity; non-commercial licences rejected.") },
  { name: msg("Athletic commission results"), supplies: msg("Official and pre-fight weights, officials, purses (US states such as Nevada)"), licence: msg("Public records"), status: "planned", note: msg("Automated requests to the Nevada site are blocked, so files must be downloaded manually. A parser is not built.") },
  { name: msg("BoxRec"), supplies: msg("The most complete records, trainers and weigh-ins in boxing"), licence: msg("Scraping prohibited by its terms"), status: "blocked", note: msg("Not used. Data is licensed to partners; an enquiry is the only legitimate route. Only the numeric ID is stored, as a cross-reference.") },
  { name: msg("CompuBox"), supplies: msg("Punch statistics"), licence: msg("Paid"), status: "planned", note: msg("The schema and charts are ready; needs a licence.") },
  { name: msg("Editors"), supplies: msg("Corrections and trainer/manager history with sources"), licence: msg("Contributor terms"), status: "built", note: msg("Anyone signed in can suggest an edit with a source; an editor checks it first. Approved edits are marked as community edits with their link.") },
];
const STATUS_STYLE: Record<Source["status"], string> = { built: "!border-win/40 !text-win", partly: "!border-gold/40 !text-gold", planned: "", blocked: "!border-red/40 !text-red-ink" };
const SEVERITY: Record<string, string> = { error: msg("error"), warning: msg("warning"), info: msg("info") };
const RECOMMENDED: Record<string, string> = { "plain Elo": msg("plain Elo"), "Elo refit": msg("Elo refit"), "all features": msg("all features"), "selected features": msg("selected features") };
const STATUS_LABEL: Record<Source["status"], string> = { built: msg("Built"), partly: msg("Partly built"), planned: msg("Not yet"), blocked: msg("Not used") };

/** What the data load counts, and what a failed row can be, in words a reader of either language can follow (the keys are the loader's own names). */
const COUNT: Record<string, string> = { boxers: msg("fighters"), events: msg("events"), bouts: msg("bouts"), people: msg("people"), orgs: msg("organisations"), stints: msg("team stints"), weighIns: msg("weigh-ins"), officials: msg("officials"), scorecards: msg("scorecards"), corners: msg("corner entries"), punches: msg("punch records"), financials: msg("financial records"), purses: msg("purses"), broadcasts: msg("broadcasts"), earnings: msg("earnings records") };
const KIND: Record<string, string> = { boxer: msg("fighter"), event: msg("event"), bout: msg("bout"), stint: msg("team stint"), weigh_in: msg("weigh-in"), official: msg("official"), scorecard: msg("scorecard"), corner: msg("corner entry"), punch_stat: msg("punch record"), financials: msg("financial"), purse: msg("purse"), broadcast: msg("broadcast"), earning: msg("earnings") };

export default async function DataPage() {
  const t = await getT();
  const cov = await coverage();
  const fit = loadFit();
  const ar = await arabicReviewStatus();
  const demo = isDemoData();
  const contact = siteContact(), credit = vendorCredit();
  const act = activeWeights();
  const eloScale = act.rating / DEFAULT_WEIGHTS.rating;

  return (
    <div className="space-y-12">
      <div>
        <div className="eyebrow mb-2">{t("Provenance")}</div>
        <h1 className="font-display text-5xl font-extrabold uppercase">{t("Data & model")}</h1>
        <p className="mt-2 max-w-2xl text-muted">{t("What is in the database, where each kind of fact comes from, how complete it is, and how well the prediction model does on fights it has never seen.")}</p>
      </div>

      <div className={`card p-4 text-sm ${demo ? "!border-gold/40" : ""}`}>
        {demo ? t.rich("<b>Demo mode.</b> Every fighter, trainer, judge and result here is fictional and simulated. Real data arrives through a licensed provider; nothing is scraped.", { b: (c) => <b className="text-gold">{c}</b> }) : t.rich("<b>Live provider.</b> Data comes from the configured licensed feed.", { b: (c) => <b className="text-win">{c}</b> })}
      </div>

      <section>
        <SectionTitle eyebrow={t("Live from the database")} title={t("Field coverage")} />
        <div className="grid gap-5 lg:grid-cols-2">
          {cov.groups.map((g) => (
            <div key={g.title} className="card p-5">
              <div className="eyebrow mb-3">{t(g.title)}</div>
              <ul className="space-y-3">
                {g.rows.map((r) => {
                  const f = r.of ? r.have / r.of : 0;
                  return (
                    <li key={r.field}>
                      <div className="mb-1 flex justify-between gap-3 text-xs"><span>{t(r.field)}{r.note && <span className="ms-1.5 text-muted">· {t(r.note)}</span>}</span><span className="tabular text-muted">{r.have.toLocaleString("en-US")} / {r.of.toLocaleString("en-US")} · <b className="text-ink">{pct(f)}</b></span></div>
                      <div className="h-2 overflow-hidden rounded-full bg-panel2"><div className="growx h-full rounded-full" style={{ width: `${f * 100}%`, background: f > 0.85 ? "var(--green)" : f > 0.4 ? "var(--gold)" : "var(--red)" }} /></div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted">{t("Team history rows by source: {stints}. Weigh-ins by source: {weighIns}. Wikidata staged: {staged} boxers, {linked} linked to our fighters.", { stints: cov.stintSources.map((s) => `${s.source} (${s.n.toLocaleString("en-US")})`).join(", ") || t("none"), weighIns: cov.weighInSources.map((s) => `${s.source} (${s.n.toLocaleString("en-US")})`).join(", ") || t("none"), staged: cov.wikidataStaged.toLocaleString("en-US"), linked: cov.wikidataLinked.toLocaleString("en-US") })}</p>
      </section>

      {cov.lastRun && (
        <section>
          <SectionTitle eyebrow={t("Checked before anything is written")} title={t("Last data load")} />
          <div className="card p-5">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="chip">{cov.lastRun.provider}</span>
              <span className="text-muted">{new Date(cov.lastRun.at).toLocaleString(t.locale === "ar" ? "ar-u-nu-latn-ca-gregory" : "en-GB", { dateStyle: "medium", timeStyle: "short" })}</span>
              <span className={`chip ${cov.lastRun.errors ? "!border-red/40 !text-red-ink" : "!border-win/40 !text-win"}`}>{t.n(cov.lastRun.errors, "{n} error", "{n} errors")}</span>
              <span className={`chip ${cov.lastRun.warnings ? "!border-gold/40 !text-gold" : ""}`}>{t.n(cov.lastRun.warnings, "{n} warning", "{n} warnings")}</span>
              {Object.entries(cov.lastRun.dropped).map(([k, n]) => <span key={k} className="chip !border-red/40 !text-red-ink">{t.n(n, "{n} {kind} row dropped", "{n} {kind} rows dropped", { kind: KIND[k] ? t(KIND[k]) : k.replace("_", " ") })}</span>)}
            </div>
            <p className="mt-3 text-xs text-muted">{t("Loaded: {list}.", { list: Object.entries(cov.lastRun.counts).map(([k, n]) => `${n.toLocaleString("en-US")} ${COUNT[k] ? t(COUNT[k]) : k}`).join(" · ") })}</p>
            {cov.lastRun.issues.length ? (
              <ul className="mt-4 space-y-2 text-sm">
                {cov.lastRun.issues.map((i) => (
                  <li key={`${i.severity}-${i.code}`} className="flex flex-wrap items-baseline gap-x-3 border-t border-line/60 pt-2">
                    <span className={`chip ${i.severity === "error" ? "!border-red/40 !text-red-ink" : i.severity === "warning" ? "!border-gold/40 !text-gold" : ""}`}>{SEVERITY[i.severity] ? t(SEVERITY[i.severity]) : i.severity}</span>
                    <b lang="en">{i.code}</b><span className="tabular text-muted">×{i.n}</span><span className="text-xs text-muted">{t.rich("e.g. <x>{example}</x>", { example: i.example, x: (c) => <span lang="en" dir="ltr">{c}</span> })}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="mt-4 text-sm text-muted">{t.rich("No issues found. Rows that fail a check are dropped and listed here; suspicious ones are kept and flagged. Run <c>{cmd}</c> to test a vendor sample first.", { cmd: "npm run data:check -- --file sample.json", c: (c) => <code className="ltr-fixed rounded bg-panel2 px-1.5 py-0.5 text-ink">{c}</code> })}</p>}
          </div>
        </section>
      )}

      {credit && (
        <section aria-labelledby="credit">
          <SectionTitle eyebrow={t("Credit")} title={t("Data supplier")} />
          <div className="card p-4 text-sm" id="credit">
            <p>{t.rich("Fight, fighter and event data: <a>{name}</a>.", { name: credit.name, a: (c) => <a href={credit.url} lang="en" dir="ltr" target="_blank" rel="noopener noreferrer" className="underline decoration-dotted hover:text-gold">{c}</a> })}{credit.termsUrl && <> · <a href={credit.termsUrl} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted hover:text-gold">{t("Licence terms")}</a></>}</p>
            <p className="mt-2 text-xs text-muted">{t("Ringside adds its own ratings, rankings and predictions on top of this data; those are Ringside’s, not the supplier’s.")}</p>
          </div>
        </section>
      )}

      <section aria-labelledby="mistakes">
        <SectionTitle eyebrow={t("Corrections")} title={t("Spotted a mistake?")} />
        <div className="card p-4 text-sm" id="mistakes">
          <p>{t.rich("Signed-in readers can <a>report a mistake</a> on any fighter or fight page. An editor reads the source before anything changes, and a fight’s result is corrected only from a page its commission or sanctioning body published.", { a: (c) => <Link href="/report" className="underline decoration-dotted hover:text-gold">{c}</Link> })}</p>
          {contact && <p className="mt-2">{t("Not signed in? Write to")} <a href={contact.href} lang="en" dir="ltr" {...(contact.href.startsWith("mailto:") ? {} : { target: "_blank", rel: "noopener noreferrer" })} className="underline decoration-dotted hover:text-gold">{contact.label}</a></p>}
        </div>
      </section>

      <section>
        <SectionTitle eyebrow={t("Where facts come from")} title={t("Source registry")} />
        <ScrollRegion className="card p-2" label={t("Source registry")}>
          <table className="w-full text-sm" aria-label={t("Source registry")}>
            <thead><tr className="text-start text-xs uppercase tracking-widest text-muted"><th className="p-3">{t("Source")}</th><th>{t("Supplies")}</th><th>{t("Licence")}</th><th>{t("Status")}</th></tr></thead>
            <tbody>{SOURCES.map((s) => (
              <tr key={s.name} className="border-t border-line/60 align-top">
                <td className="p-3 font-semibold">{t(s.name)}<div className="mt-1 max-w-xs text-xs font-normal text-muted">{t(s.note)}</div></td>
                <td className="py-3 pe-4 text-muted">{t(s.supplies)}</td><td className="py-3 pe-4 text-muted">{t(s.licence)}</td>
                <td className="py-3 pe-3"><span className={`chip ${STATUS_STYLE[s.status]}`}>{t(STATUS_LABEL[s.status])}</span></td>
              </tr>
            ))}</tbody>
          </table>
        </ScrollRegion>
      </section>

      <section aria-labelledby="languages">
        <SectionTitle eyebrow={t("Who has checked the translation")} title={t("Arabic review")} />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4" id="languages">
          <Stat label={t("Strings")} value={ar.total.toLocaleString("en-US")} sub={t("Arabic sentences and labels")} />
          <Stat label={t("Reviewed by a person")} value={ar.reviewed.toLocaleString("en-US")} sub={ar.changed ? t("{n} changed since", { n: ar.changed }) : ar.lastReview ? t("last on {date}", { date: ar.lastReview.at }) : t("none yet")} />
          <Stat label={t("Written by a machine")} value={(ar.machine + ar.changed).toLocaleString("en-US")} sub={t("not yet checked by a person")} />
          <Stat label={t("Names reviewed")} value={`${ar.namesReviewed.toLocaleString("en-US")} / ${ar.names.toLocaleString("en-US")}`} sub={t("Arabic spellings of names")} />
        </div>
        <p className="mt-3 max-w-3xl text-xs text-muted">{t("The Arabic on this site was written by a machine. A string counts as reviewed only when a native speaker approved or edited it, and only for the exact wording they saw: if the text changes afterwards it goes back to unchecked. Expect mistakes in anything not yet reviewed.")}</p>
      </section>

      <section>
        <SectionTitle eyebrow={t("Fit on past bouts, tested on the most recent 25%")} title={t("Prediction model")} />
        {!fit ? (
          <div className="card p-5 text-sm text-muted">{t.rich("No fit yet. Run <c>{cmd}</c> to learn weights from the bouts in the database.", { cmd: "npm run model:fit", c: (c) => <code className="ltr-fixed rounded bg-panel2 px-1.5 py-0.5 text-ink">{c}</code> })}</div>
        ) : (
          <div className="space-y-5">
            <div className="grid gap-3 md:grid-cols-4">
              {([[msg("Plain Elo"), fit.test.baseline], [msg("Elo refit"), fit.test.eloOnly], [msg("All features"), fit.test.full], [msg("Selected features"), fit.test.selected]] as const).map(([name, m]) => {
                const best = name.toLowerCase() === fit.recommended.toLowerCase();
                return (
                  <div key={name} className={`card p-4 ${best ? "!border-gold/50" : ""}`}>
                    <div className="flex items-center justify-between text-xs uppercase tracking-widest text-muted"><span>{t(name)}</span>{best && <span className="text-gold">{t("best")}</span>}</div>
                    <div className="font-display text-3xl font-bold tabular">{m.logLoss.toFixed(4)}</div>
                    <div className="text-xs text-muted">{t("log-loss · {acc} correct · Brier {brier}", { acc: pct(m.accuracy, 1), brier: m.brier.toFixed(3) })}</div>
                  </div>
                );
              })}
            </div>
            <ScrollRegion className="card p-5" label={t("What the data says each factor is worth")}>
              <div className="eyebrow mb-3">{t("What the data says each factor is worth ({n} fights, {from} to {to})", { n: fit.rows.train.toLocaleString("en-US"), from: fit.rows.from, to: fit.rows.splitDate })}</div>
              <table className="w-full text-sm" aria-label={t("What the data says each factor is worth")}>
                <thead><tr className="text-start text-xs uppercase tracking-widest text-muted"><th className="py-2">{t("Factor")}</th><th>{t("Effect on log-odds of winning")}</th><th>{t("± error")}</th><th>z</th><th className="text-end">{t("Clear signal?")}</th></tr></thead>
                <tbody>{fit.features.map((f) => (
                  <tr key={f.key} className="border-t border-line/60">
                    <td className="py-2">{t(f.label)}</td><td className="tabular">{f.effect >= 0 ? "+" : ""}{f.effect.toFixed(3)} <span className="text-xs text-muted">{t(f.unit)}</span></td>
                    <td className="tabular text-muted">{f.effectSe.toFixed(3)}</td><td className="tabular">{f.z.toFixed(1)}</td>
                    <td className="text-end">{f.selected ? <span className="chip !border-win/40 !text-win">{t("yes")}</span> : <span className="text-xs text-muted">{t("no")}</span>}</td>
                  </tr>
                ))}</tbody>
              </table>
              <p className="mt-3 text-xs text-muted">{t("A factor needs |z| of about 2 or more to count as signal. Fitted on rating, reach, age, layoff, knockout rate, KO losses, experience, usual rehydration, fight-night weight edge, new-trainer flag and the trainer's prior win rate. In this demo league the weigh-in and trainer effects were planted but are small, so they are not detectable at this sample size. That is the honest answer, and real data will say what is really there.")}</p>
            </ScrollRegion>
            <div className="card p-5">
              <div className="eyebrow mb-3">{t("Is it calibrated? ({model}, held-out fights)", { model: RECOMMENDED[fit.recommended] ? t(RECOMMENDED[fit.recommended]) : fit.recommended })}</div>
              <ul className="space-y-2">{fit.calibration.map((c) => (
                <li key={c.bucket} className="grid grid-cols-[84px_1fr_120px] items-center gap-3 text-xs"><span className="text-muted">{t("said {bucket}", { bucket: c.bucket })}</span>
                  <div className="ltr-fixed relative h-3 rounded-full bg-panel2"><div className="absolute inset-y-0 start-0 rounded-full bg-gold/60" style={{ width: `${c.predicted * 100}%` }} /><div className="absolute inset-y-0 w-0.5 bg-win" style={{ insetInlineStart: `${c.actual * 100}%` }} title={t("what actually happened")} /></div>
                  <span className="tabular text-muted">{pct(c.predicted)} <span className="inline-block rtl:rotate-180">→</span> <b className="text-ink">{pct(c.actual)}</b> <span className="opacity-60">{t("n={n}", { n: c.n })}</span></span></li>
              ))}</ul>
              <p className="mt-3 text-xs text-muted">{t("Gold bar = average probability the model gave; green tick = how often those fighters actually won.")}</p>
            </div>
            <p className="text-sm text-muted">{eloScale > 1.05 ? t.rich("The site's default predictions use the fitted rating scale (<b>{scale}</b> a plain Elo expectation); the fit found ratings are compressed relative to true skill gaps in this league.", { scale: `${eloScale.toFixed(1)}×`, b: (c) => <b className="text-ink">{c}</b> }) : t("The site's default predictions use the standard Elo scale.")}</p>
          </div>
        )}
      </section>
    </div>
  );
}
