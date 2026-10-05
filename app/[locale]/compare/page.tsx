import { ShareButton } from "@/components/ShareButton";
import { DASH, isKnown, orDash } from "@/lib/facts";
import Link from "@/components/L";
import { getWorld, koView, recordStr } from "@/lib/world";
import { predict, featuresOf } from "@/lib/predict";
import { MatchupLab } from "@/components/MatchupLab";
import { FighterPicker } from "@/components/FighterPicker";
import { commonOpponents } from "@/lib/common-opponents";
import { resolveFighter } from "@/lib/fighter-search";
import { getNames } from "@/lib/i18n/names";
import { activeFinish, activeWeights } from "@/lib/model";
import { loadFit } from "@/lib/model-fit";
import { Headshot } from "@/components/Portrait";
import { ProbBar, Radar } from "@/components/charts";
import { archetype } from "@/lib/style";
import { SectionTitle } from "@/components/ui";
import { flag, pct, fmtDate, countryName, methodLabel } from "@/lib/format";
import { divisionLabel } from "@/lib/divisions";
import { getT } from "@/lib/i18n/server";
import { metaFor } from "@/lib/seo-server";
import { upcomingEvents, liveBouts } from "@/lib/events";
import type { BoxerFull } from "@/lib/types";

export const generateMetadata = ({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ a?: string; b?: string }> }) => metaFor(params, async (p, t) => {
  const base = {
    path: "/compare", title: t("Matchups"),
    description: t("Pick any two fighters and see win probability, how the fight likely ends and what drives the number, with an interactive model you can re-weight."),
  };
  // a link to one matchup shares as that matchup: its names in the title and a card of its own (two fighters that exist, or the plain page)
  const { a, b } = await searchParams;
  const w = await getWorld();
  const A = a ? w.bySlug.get(a) : undefined, B = b ? w.bySlug.get(b) : undefined;
  if (!A || !B || A.id === B.id) return base;
  return {
    ...base, title: t("{a} vs {b}", { a: t.name(A.name), b: t.name(B.name) }),
    description: t("Win probability, how the fight likely ends and what drives the number for {a} against {b}.", { a: t.name(A.name), b: t.name(B.name) }),
    image: `/api/og/compare?a=${encodeURIComponent(A.slug)}&b=${encodeURIComponent(B.slug)}&lang=${p.locale}`,
  };
});

/** Fighters need a few bouts before a prediction means anything; the type-ahead only offers those. */
const MIN_BOUTS = 5;

export default async function Compare({ searchParams }: { searchParams: Promise<{ a?: string; b?: string; aq?: string; bq?: string }> }) {
  const t = await getT();
  const { a: sa, b: sb, aq, bq } = await searchParams;
  const w = await getWorld();
  // a link or the type-ahead gives a slug; a typed name (no JavaScript, or typed without picking) is resolved here
  const names = await getNames(t.locale); // a typed Arabic name resolves too
  const A = resolveFighter(w, sa, aq, MIN_BOUTS, names), B = resolveFighter(w, sb, bq, MIN_BOUTS, names);

  const featured = upcomingEvents(w).slice(0, 3).flatMap((e) => liveBouts(w, e.id).slice(0, 2));

  return (
    <div className="space-y-10">
      <div>
        <div className="eyebrow mb-2">{t("Fight predictor")}</div>
        <h1 className="font-display text-5xl font-extrabold uppercase">{t("Matchup lab")}</h1>
        <p className="mt-2 max-w-2xl text-muted">{t("Pick any two fighters — even from different eras or weights — and see win probability, how the fight likely ends, and what drives the number.")}</p>
        <div className="mt-4 flex flex-wrap gap-2 text-sm">
          <span className="chip !border-gold/50 !text-gold">{t("Predict any fight")}</span>
          <Link href="/matchmaking" className="chip hover:text-ink">{t("Matchmaking")}</Link>
          <Link href="/titles" className="chip hover:text-ink">{t("Title lineages")}</Link>
        </div>
      </div>
      <form className="card grid gap-3 p-4 sm:grid-cols-[1fr_auto_1fr_auto] sm:items-center">
        {(["a", "b"] as const).map((k, i) => {
          const f = k === "a" ? A : B, typed = k === "a" ? aq : bq;
          return (
            <div key={`${k}:${f?.slug ?? typed ?? ""}`} className={i === 1 ? "sm:col-start-3" : ""}>
              <FighterPicker name={k} label={k === "a" ? t("A") : t("B")} minBouts={MIN_BOUTS} initial={f ? { slug: f.slug, name: t.name(f.name) } : typed ? { slug: "", name: typed } : undefined} />
            </div>
          );
        })}
        <span className="hidden font-display text-xl font-bold text-gold sm:col-start-2 sm:row-start-1 sm:block">{t("VS")}</span>
        <button className="rounded-xl bg-red-btn px-6 text-white py-2.5 font-display text-lg font-bold uppercase transition hover:brightness-90">{t("Predict")}</button>
      </form>

      {([["A", sa || aq, A], ["B", sb || bq, B]] as const).map(([k, asked, f]) => asked && !f && (
        <p key={k} className="text-sm text-muted">{t("No fighter with {n}+ bouts matches “{q}”.", { n: MIN_BOUTS, q: (k === "A" ? aq || sa : bq || sb) ?? "" })}</p>
      ))}
      {A && B && A.id !== B.id ? <Result A={A} B={B} w={w} /> : (
        <section>
          <SectionTitle eyebrow={t("Or start from the calendar")} title={t("Booked fights")} />
          <div className="grid gap-3 sm:grid-cols-2">
            {featured.map((b) => (
              <Link key={b.id} href={`/compare?a=${b.redSlug}&b=${b.blueSlug}`} className="card card-hover flex items-center justify-between p-4">
                <span><b>{t.name(b.redName)}</b> <span className="text-muted">{t("vs")}</span> <b>{t.name(b.blueName)}</b></span><span className="chip">{divisionLabel(b.weightClass, w.byId.get(b.redId)!.sex, t)}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

async function Result({ A, B, w }: { A: BoxerFull; B: BoxerFull; w: Awaited<ReturnType<typeof getWorld>> }) {
  const t = await getT();
  const p = predict(A, B, t);
  const cm = (n: number | null) => orDash(n, (x) => t("{n} cm", { n: x }));
  const withReach = isKnown(A.reachCm) && isKnown(B.reachCm); // the chart compares like with like: a reach nobody knows is left off for both
  const co = commonOpponents(w, A, B);
  const h2h = (w.boutsByBoxer.get(A.id) ?? []).filter((x) => x.method && (x.redId === B.id || x.blueId === B.id));
  const rows: [string, string, string][] = [
    [t("Record"), recordStr(A), recordStr(B)], [t("KO rate"), pct(koView(A).rate), pct(koView(B).rate)], [t("Rating"), String(Math.round(A.rating)), String(Math.round(B.rating))],
    [t("Age"), orDash(A.age, String), orDash(B.age, String)], [t("Height"), cm(A.heightCm), cm(B.heightCm)], [t("Reach"), cm(A.reachCm), cm(B.reachCm)],
    [t("Stance"), A.stance ? t(A.stance) : DASH, B.stance ? t(B.stance) : DASH], [t("Style"), t(archetype(A)), t(archetype(B))], [t("Division"), divisionLabel(A.weightClass, A.sex, t), divisionLabel(B.weightClass, B.sex, t)],
  ];
  const ax = (b: BoxerFull) => [
    { label: t("Power"), v: b.koRate }, { label: t("Winning"), v: b.winRate }, { label: t("Durability"), v: 1 - Math.min(1, (b.koLosses / Math.max(1, b.bouts)) * 4) },
    ...(withReach ? [{ label: t("Reach"), v: Math.min(1, Math.max(0, ((b.reachCm as number) - 150) / 60)) }] : []), { label: t("Experience"), v: Math.min(1, b.bouts / 40) }, { label: t("Rating"), v: Math.min(1, Math.max(0, (b.rating - 1350) / 400)) },
  ];
  return (
    <section className="space-y-6">
      <div className="card p-6">
        <div className="ltr-fixed grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4">
          {[A, B].map((f, i) => (
            <Link key={f.id} href={`/boxers/${f.slug}`} className={`flex flex-col items-center gap-2 text-center ${i === 1 ? "order-3" : ""}`}>
              <Headshot boxer={f} size={120} />
              <div className="font-display text-3xl font-bold leading-tight">{t.name(f.name)}</div>
              <div className="text-xs text-muted">{flag(f.country)} {countryName(f.country, t.locale)}</div>
            </Link>
          ))}
          <div className="order-2 font-display text-4xl font-extrabold text-gold">{t("VS")}</div>
        </div>
        <div className="mt-6"><ProbBar a={t.name(A.name)} b={t.name(B.name)} pA={p.pA} pB={p.pB} pDraw={p.pDraw} /></div>
        <div className="mt-4 flex flex-wrap gap-2 text-xs"><span className="chip !border-gold/40 !text-gold">✦ {t(p.confidence)}</span><span className="chip">{t("{n}% chance of KO/TKO", { n: Math.round(p.koProb * 100) })}</span>{A.weightClass !== B.weightClass && <span className="chip !border-red/50 !text-red-ink">{t("Different divisions — treat with caution")}</span>}<ShareButton title={t("{a} vs {b}", { a: t.name(A.name), b: t.name(B.name) })} /></div>
      </div>
      <MatchupLab a={{ name: t.name(A.name), features: featuresOf(A) }} b={{ name: t.name(B.name), features: featuresOf(B) }} defaults={activeWeights()} finish={activeFinish()}
        modelNote={(() => { const f = loadFit(); return f && f.recommended !== "plain Elo" ? t("The rating weight is fitted on {n} past bouts (held-out log-loss {fit} vs {base} for plain Elo). Other weights are hand-set; see Data & model for how each compares.", { n: f.rows.train.toLocaleString("en-US"), fit: f.test[f.recommended === "Elo refit" ? "eloOnly" : f.recommended === "all features" ? "full" : "selected"].logLoss.toFixed(3), base: f.test.baseline.logLoss.toFixed(3) }) : t("Weights are hand-set until real results are available to fit the model."); })()} />
      <div className="card ltr-fixed flex flex-wrap items-center justify-center gap-2 p-5">
        <Radar axes={ax(A)} color="#e5322d" /><Radar axes={ax(B)} color="#4a8cff" />
      </div>
      <div className="card overflow-hidden">
        {rows.map(([k, x, y]) => (
          <div key={k} className="ltr-fixed grid grid-cols-3 items-center border-t border-line/60 px-5 py-2.5 text-sm first:border-0"><span className="font-semibold tabular">{x}</span><span className="text-center text-xs uppercase tracking-widest text-muted">{k}</span><span className="text-end font-semibold tabular">{y}</span></div>
        ))}
      </div>
      {h2h.length > 0 && <div className="card p-5 text-sm"><div className="eyebrow mb-2">{t("Head to head")}</div>{h2h.map((x) => <div key={x.id}>{x.winnerId ? t("{date}: {winner} by {method}", { date: fmtDate(x.date, undefined, t.locale), winner: t.name(w.byId.get(x.winnerId)!.name), method: t(x.method!) }) : t("{date}: {result}", { date: fmtDate(x.date, undefined, t.locale), result: methodLabel(x.method, x.endRound, t) })}</div>)}</div>}
      {co.rows.length > 0 && (
        <div className="card p-5 text-sm">
          <div className="eyebrow mb-2">{t("Common opponents")}</div>
          <div>
            {co.rows.map((c) => (
              <div key={c.opponent.id} className="border-t border-line/60 py-2 first:border-0">
                <Link href={`/boxers/${c.opponent.slug}`} className="inline-block py-0.5 font-semibold hover:text-gold">{t.name(c.opponent.name)}</Link>
                <div className="mt-1 grid grid-cols-2 gap-3 text-xs">
                  {([[A, c.a], [B, c.b]] as const).map(([f, fights]) => (
                    <div key={f.id} className="min-w-0">
                      <div className="truncate text-muted">{t.name(f.name).split(" ").slice(-1)[0]}</div>
                      {fights.map((x) => (
                        <div key={x.id} className={x.winnerId === f.id ? "text-win" : x.winnerId === null ? "text-muted" : "text-red-ink"}>
                          {x.winnerId === null ? t("Draw") : `${x.winnerId === f.id ? t("W") : t("L")} ${methodLabel(x.method, x.endRound, t)}`}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {co.total > co.rows.length && <p className="mt-2 text-xs text-muted">{t.n(co.total - co.rows.length, "{n} more opponent in common", "{n} more opponents in common")}</p>}
          {co.partial && <p className="mt-2 text-xs text-muted">{t("Held in part: an opponent missing here may be a fight Ringside does not hold.")}</p>}
        </div>
      )}
    </section>
  );
}
