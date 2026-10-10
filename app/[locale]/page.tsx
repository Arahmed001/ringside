import { headers } from "next/headers";
import Link from "@/components/L";
import { getWorld } from "@/lib/world";
import { overview, biggestUpsets } from "@/lib/analytics";
import { pound4pound } from "@/lib/rankings";
import { eventViews, isLive, upcomingEvents, recentEvents } from "@/lib/events";
import { currentYear } from "@/lib/clock";
import { predict } from "@/lib/predict";
import { DIVISIONS_HEAVIEST_FIRST, slugifyDivision, divisionLabel } from "@/lib/divisions";
import { Poster } from "@/components/Poster";
import { Headshot } from "@/components/Portrait";
import { ProbBar } from "@/components/charts";
import { PickEm } from "@/components/PickEm";
import { AskResults } from "@/components/AskResults";
import { askData } from "@/lib/ask";
import { exampleQuestions } from "@/lib/ask/examples";
import { clientId } from "@/lib/ai-guard";
import { getNames } from "@/lib/i18n/names";
import { WatchlistStrip } from "@/components/Watch";
import { BoxerCard, SectionTitle } from "@/components/ui";
import { ScoreBadge } from "@/components/Awards";
import { WatchCard } from "@/components/WatchCard";
import { upsetWatch } from "@/lib/upsets";
import { featuredYear, topFightsOfYear, resultLine } from "@/lib/fight-score";
import { daysUntil, fmtDate, methodLabel } from "@/lib/format";
import { getT } from "@/lib/i18n/server";
import { metaFor } from "@/lib/seo-server";
import { localePath } from "@/lib/i18n/config";
import { abs } from "@/lib/seo";
import { JsonLd } from "@/components/JsonLd";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => metaFor(params, (p, t) => ({ path: "/", title: t("Boxing ratings, rankings and predictions"), description: t("Every fighter, every fight, every number. Ratings, rankings, predictions and scouting reports for professional boxing.") }));

/** Posters shown in the "Coming up" strip; the full calendar is one click away. */
const STRIP = 12;

export default async function Home() {
  const t = await getT();
  const w = await getWorld();
  const o = overview(w);
  const upcoming = upcomingEvents(w);
  const ups = eventViews(w, upcoming.slice(0, STRIP + 1));
  const next = ups[0] ?? null; // null between seasons, or before the first fixtures are loaded: the page must still render
  const p = next ? predict(next.red, next.blue, t) : null;
  const p4p = pound4pound(w, 8);
  const recent = eventViews(w, recentEvents(w, 5));
  const upset = biggestUpsets(w, 1, `${currentYear() - 1}-01-01`)[0]; // the `since` argument, so it is cached (a spread copy of the world is a new object every request, and never hits the cache)

  const watchTop = upsetWatch(w, t).find((x) => x.tier === "live") ?? null;
  const fy = featuredYear(w);
  const foty = fy ? { year: fy, top: topFightsOfYear(w, fy, 1)[0] } : null;

  const pickBouts = (next?.bouts ?? []).filter(isLive).slice().reverse().map((b) => {
    const r = w.byId.get(b.redId)!, u = w.byId.get(b.blueId)!;
    const pr = predict(r, u, t);
    const redFav = pr.pA >= pr.pB;
    return { id: b.id, red: t.name(r.name), blue: t.name(u.name), redId: r.id, blueId: u.id, modelPickId: redFav ? r.id : u.id, modelPct: Math.round(Math.max(pr.pA, pr.pB) * 100), label: t.locale === "en" ? `${r.sex === "female" ? "W " : ""}${b.weightClass.replace("weight", "")}` : divisionLabel(b.weightClass, r.sex, t) };
  });

  const surname = (n: string) => t.name(n).split(" ").slice(-1)[0];
  // the live answer under the question box: the first example question, answered from the database (cached per language and day; hidden when the league cannot answer it)
  const examples = exampleQuestions(w, t);
  const answer = await askData(examples[0], { w, t, names: await getNames(t.locale) }, clientId(await headers()));

  return (
    <div className="space-y-16 overflow-x-clip">
      <JsonLd data={{
        "@type": "WebSite", name: "Ringside", url: abs(localePath(t.locale, "/")), inLanguage: t.locale,
        potentialAction: { "@type": "SearchAction", target: `${abs(localePath(t.locale, "/boxers"))}?q={search_term_string}`, "query-input": "required name=search_term_string" },
      }} />
      <JsonLd data={{ "@type": "Organization", name: "Ringside", url: abs("/") }} />
      {/* Hero: the next fight is the page (direction A) */}
      {next && p ? (
        <section className="rise grid items-end gap-10 md:grid-cols-[minmax(0,15rem)_1fr] lg:grid-cols-[minmax(0,27rem)_1fr]">
          <div className="relative mx-auto w-full max-w-md md:max-w-none">
            <div className="absolute -inset-8 -z-10 rounded-[2rem] bg-red/25 blur-3xl live" />
            <Link href={`/events/${next.event.id}`} className="block transition hover:scale-[1.015]"><Poster event={next.event} main={next.main} red={next.red} blue={next.blue} priority /></Link>
          </div>
          <div>
            <div className="eyebrow mb-3">{t.n(daysUntil(next.event.date), "In {n} day", "In {n} days")} · {fmtDate(next.event.date, undefined, t.locale)} · {t.name(next.event.venue)}</div>
            <h1 className={`font-display font-extrabold uppercase ${t.locale === "ar" ? "text-6xl leading-[1.25] sm:text-8xl md:text-5xl lg:text-8xl" : "text-7xl leading-[.9] sm:text-9xl md:text-6xl lg:text-9xl"}`}>
              <span className="block">{surname(next.red.name)}</span><span className="block py-1 text-2xl font-bold leading-none text-gold sm:py-2 sm:text-4xl">{t("VS")}</span><span className="block text-red-ink">{surname(next.blue.name)}</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg text-muted">{t("{a} vs {b}", { a: t.name(next.red.name), b: t.name(next.blue.name) })} · {next.main.title ? t.name(next.main.title) : divisionLabel(next.main.weightClass, next.red.sex, t)}</p>
            <div className="mt-6 max-w-xl"><ProbBar a={t.name(next.red.name)} b={t.name(next.blue.name)} pA={p.pA} pB={p.pB} pDraw={p.pDraw} /></div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
              <span className="chip !border-gold/40 !text-gold">✦ {t(p.confidence)}</span>
              <span className="chip">{p.koProb > 0.5 ? t("Stoppage likely · {pct}% KO/TKO", { pct: Math.round(p.koProb * 100) }) : t("Distance likely · {pct}% KO/TKO", { pct: Math.round(p.koProb * 100) })}</span>
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <Link href={`/previews/${next.main.id}`} className="rounded-xl bg-red-btn px-5 py-2.5 font-display text-lg font-bold uppercase text-white transition hover:brightness-90">{t("Read the preview")}</Link>
              <Link href={`/compare?a=${next.red.slug}&b=${next.blue.slug}`} className="rounded-xl border border-line bg-panel2 px-5 py-2.5 font-display text-lg font-bold uppercase transition hover:border-white/30">{t("Full matchup breakdown")}</Link>
            </div>
          </div>
        </section>
      ) : (
        <section className="rise">
          <h1 className="font-display text-6xl font-extrabold uppercase leading-[.92] sm:text-8xl">{t("Every fighter.")}<br /><span className="text-red-ink">{t("Every number.")}</span></h1>
          <p className="mt-6 max-w-xl rounded-xl border border-line bg-panel px-4 py-3 text-sm text-muted">{t("No upcoming fights are scheduled yet.")}</p>
        </section>
      )}

      {/* The question box is the product, with a real answer beside it (direction C): side by side on a wide screen, so the card calendar is not pushed a page down */}
      <section aria-labelledby="ask" className={`grid items-start gap-8 ${answer?.understood ? "xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] xl:gap-12" : "max-w-3xl"}`}>
        <div>
          <div className="eyebrow mb-2">{t("Boxing intelligence · {fighters} fighters · {bouts} bouts", { fighters: o.boxers, bouts: o.bouts.toLocaleString("en-US") })}</div>
          <h2 id="ask" className="font-display text-5xl font-extrabold uppercase leading-[.95] sm:text-6xl">{t("Ask the data")}<span className="text-red-ink">.</span></h2>
          <p className="mt-3 max-w-2xl text-lg text-muted">{t("Ratings, rankings, win-probabilities and scouting reports for the whole sport, in one place. Ask in plain English.")}</p>
          <form action={localePath(t.locale, "/ask")} className="mt-6 flex flex-col gap-2 sm:flex-row">
            <input name="q" aria-label={t("Ask the data")} placeholder={t("Who has the most knockouts among women?")} className="min-w-0 flex-1 rounded-2xl border border-line bg-panel px-4 py-4 text-[15px] outline-none transition placeholder:text-muted focus:border-gold/60 sm:px-6 sm:py-5 sm:text-lg" />
            <button className="rounded-2xl bg-red-btn px-9 py-3 font-display text-2xl font-bold uppercase tracking-wide text-white transition hover:brightness-90">{t("Ask")}</button>
          </form>
          <div className="mt-3 flex flex-wrap gap-2">
            {examples.slice(0, 5).map((e) => <Link key={e} href={`/ask?q=${encodeURIComponent(e)}`} className="chip transition hover:text-ink">{e}</Link>)}
          </div>
        </div>
        {answer?.understood && (
          <div>
            <div className="eyebrow mb-2">{t("Try: {example}", { example: examples[0] })}</div>
            <AskResults a={answer} compact={{ rows: 3 }} />
          </div>
        )}
      </section>

      {next && ups.length > 1 && (
        <section>
          <SectionTitle eyebrow={t("Fight calendar")} title={t("Coming up")} href="/events" cta={upcoming.length > STRIP + 1 ? t.n(upcoming.length, "All {n} upcoming card", "All {n} upcoming cards") : undefined} />
          <div className="-mx-5 flex gap-4 overflow-x-auto px-5 pb-3 md:mx-0 md:grid md:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] md:overflow-visible md:px-0">
            {ups.slice(1).map((e) => (
              <Link key={e.event.id} href={`/events/${e.event.id}`} className="card-hover w-44 shrink-0 md:w-auto">
                <Poster event={e.event} main={e.main} red={e.red} blue={e.blue} />
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* The ranking and the latest results, side by side */}
      <section className="grid gap-8 lg:grid-cols-2">
        <div>
          <SectionTitle eyebrow={t("All divisions")} title={t("Pound for pound")} href="/rankings" cta={t("All division rankings")} />
          <div className="grid gap-3 sm:grid-cols-2">{p4p.slice(0, 6).map((b, i) => <BoxerCard key={b.id} b={b} rank={i + 1} />)}</div>
          <Link href="/rankings?sex=female" className="mt-3 inline-block py-1 text-sm text-muted transition hover:text-ink">{t("Women’s pound for pound")} <span className="inline-block rtl:rotate-180">→</span></Link>
        </div>
        <div>
          <SectionTitle eyebrow={t("Latest")} title={t("Recent main events")} href="/events" />
          <div className="card divide-y divide-line/60">
            {recent.map(({ event, main, red, blue }) => {
              const win = main.winnerId ? (main.winnerId === red.id ? red : blue) : null;
              return (
                <Link key={event.id} href={`/events/${event.id}`} className="flex items-center gap-3 p-3 transition hover:bg-panel2/50">
                  <Headshot boxer={win ?? red} size={40} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm"><b>{win ? t.name(win.name) : t("Draw")}</b> <span className="text-muted">{win ? t("beat {name}", { name: t.name(win === red ? blue.name : red.name) }) : t("{red} vs {blue}", { red: t.name(red.name), blue: t.name(blue.name) })}</span></div>
                    <div className="text-xs text-muted">{t("{date} · {city}", { date: fmtDate(event.date, undefined, t.locale), city: t.name(event.city) })}</div>
                  </div>
                  <span className="chip tabular">{methodLabel(main.method, main.endRound, t)}</span>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      {next && <PickEm bouts={pickBouts} />}

      {/* Three numbers-with-a-story cards, one row on a wide screen */}
      <section className="grid gap-8 lg:grid-cols-2 2xl:grid-cols-3">
        <div>
          <SectionTitle eyebrow={t("Analytics")} title={t("Upset of the year")} href="/analytics" cta={t("More analytics")} />
          {upset ? (
            <div className="card p-5">
              <div className="text-sm text-muted">{t("{date} · {event}", { date: fmtDate(upset.bout.date, undefined, t.locale), event: t.name(upset.bout.eventName) })}</div>
              <div className="mt-2 font-display text-2xl font-bold leading-tight">
                {t.rich("{winner} <m>upset</m> {loser}", { winner: t.name(w.byId.get(upset.bout.winnerId!)!.name), loser: t.name(upset.bout.winnerId === upset.bout.redId ? upset.bout.blueName : upset.bout.redName), m: (c) => <span className="text-muted">{c}</span> })}
              </div>
              <div className="mt-3 text-sm text-muted">{t.rich("Winner entered rated <b>{winner}</b> against <b>{loser}</b> — a {gap}-point underdog.", { winner: Math.round(upset.winnerRating), loser: Math.round(upset.loserRating), gap: Math.round(upset.gap), b: (c) => <b className="text-ink">{c}</b> })}</div>
            </div>
          ) : <div className="card p-5 text-sm text-muted">{t("No upsets recorded yet.")}</div>}
        </div>
        {watchTop && (
          <div>
            <SectionTitle eyebrow={t("Fights to watch")} title={t("Upset watch")} href="/upset-watch" cta={t("All upcoming fights")} />
            <WatchCard x={watchTop} />
          </div>
        )}
        {foty && (
          <div className={watchTop ? "lg:col-span-2 2xl:col-span-1" : ""}>
            <SectionTitle eyebrow={t("Awards")} title={t("Fight of the year {year}", { year: foty.year })} href={`/fight-of-the-year/${foty.year}`} cta={t("Why it won")} />
            <Link href={`/bouts/${foty.top.bout.id}`} className="card card-hover block p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 font-display text-2xl font-bold leading-tight">{t.name(foty.top.bout.redName)} <span className="text-muted">{t("vs")}</span> {t.name(foty.top.bout.blueName)}</div>
                <ScoreBadge score={foty.top.score} className="shrink-0" />
              </div>
              <div className="mt-2 text-sm text-muted">{resultLine(w, foty.top.bout, t)} · {methodLabel(foty.top.bout.method, foty.top.bout.endRound, t)}</div>
            </Link>
          </div>
        )}
      </section>

      {/* The divisions as one wrapped row of links: a way in, not a wall of cards */}
      <section>
        <SectionTitle eyebrow={t("Official names & limits")} title={t("Divisions")} href="/rankings" cta={t("All division rankings")} />
        <ul className="flex flex-wrap gap-2">
          {DIVISIONS_HEAVIEST_FIRST.map((d) => (
            <li key={d.name}>
              <Link href={`/rankings/${slugifyDivision(d.name)}`} className="card card-hover flex min-h-11 items-baseline gap-2 px-3.5 py-2">
                <span className="text-sm font-semibold leading-tight">{t(d.name)}</span>
                <span className="tabular text-xs text-muted">{d.lb ? t("{lb} lb", { lb: d.lb }) : t("200+ lb")}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section><SectionTitle title={t("Your watchlist")} href="/watchlist" cta={t("Open watchlist")} /><WatchlistStrip /></section>
    </div>
  );
}
