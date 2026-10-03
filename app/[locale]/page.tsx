import Link from "@/components/L";
import { getWorld } from "@/lib/world";
import { overview, biggestUpsets } from "@/lib/analytics";
import { pound4pound } from "@/lib/rankings";
import { eventViews, isLive, upcomingEvents, recentEvents } from "@/lib/events";
import { currentYear } from "@/lib/clock";
import { predict } from "@/lib/predict";
import { DIVISIONS, slugifyDivision, divisionLabel } from "@/lib/divisions";
import { Poster } from "@/components/Poster";
import { Headshot } from "@/components/Portrait";
import { ProbBar } from "@/components/charts";
import { PickEm } from "@/components/PickEm";
import { WatchlistStrip } from "@/components/Watch";
import { BoxerCard, SectionTitle } from "@/components/ui";
import { daysUntil, fmtDate, flag, methodLabel } from "@/lib/format";
import { recordStr } from "@/lib/world";
import { getT } from "@/lib/i18n/server";
import { metaFor } from "@/lib/seo-server";
import { localePath } from "@/lib/i18n/config";
import { msg } from "@/lib/i18n/t";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => metaFor(params, (p, t) => ({ path: "/", title: t("Boxing ratings, rankings and predictions"), description: t("Every fighter, every fight, every number. Ratings, rankings, predictions and AI scouting for professional boxing.") }));

/** Posters shown in the "Coming up" strip; the full calendar is one click away. */
const STRIP = 12;

const EXAMPLES = [
  msg("knockout artists with 15+ KOs"),
  msg("technicians with 20+ wins"),
  msg("young heavyweights with reach over 190"),
  msg("Japanese lightweights"),
  msg("undefeated fighters"),
];

export default async function Home() {
  const t = await getT();
  const w = await getWorld();
  const o = overview(w);
  const upcoming = upcomingEvents(w);
  const ups = eventViews(w, upcoming.slice(0, STRIP + 1));
  const next = ups[0];
  const p = predict(next.red, next.blue, t);
  const p4p = pound4pound(w, 8);
  const recent = eventViews(w, recentEvents(w, 5));
  const upset = biggestUpsets(w.bouts.length ? { ...w, bouts: w.bouts.filter((b) => b.date >= `${currentYear() - 1}-01-01`) } : w, 1)[0];

  const pickBouts = next.bouts.filter(isLive).slice().reverse().map((b) => {
    const r = w.byId.get(b.redId)!, u = w.byId.get(b.blueId)!;
    const pr = predict(r, u, t);
    const redFav = pr.pA >= pr.pB;
    return { id: b.id, red: t.name(r.name), blue: t.name(u.name), redId: r.id, blueId: u.id, modelPickId: redFav ? r.id : u.id, modelPct: Math.round(Math.max(pr.pA, pr.pB) * 100), label: t.locale === "en" ? `${r.sex === "female" ? "W " : ""}${b.weightClass.replace("weight", "")}` : divisionLabel(b.weightClass, r.sex, t) };
  });

  return (
    <div className="space-y-16 overflow-x-clip">
      {/* Hero */}
      <section className="rise grid items-center gap-10 lg:grid-cols-[1.15fr_.85fr]">
        <div>
          <div className="eyebrow mb-3">{t("Boxing intelligence · {fighters} fighters · {bouts} bouts", { fighters: o.boxers, bouts: o.bouts.toLocaleString("en-US") })}</div>
          <h1 className="font-display text-6xl font-extrabold uppercase leading-[.92] sm:text-8xl">{t("Every fighter.")}<br /><span className="text-red">{t("Every number.")}</span></h1>
          <p className="mt-5 max-w-xl text-lg text-muted">{t("Ratings, rankings, win-probabilities and AI scouting for the whole sport, in one place. Ask in plain English.")}</p>
          <form action={localePath(t.locale, "/boxers")} className="mt-7 flex max-w-xl gap-2">
            <input name="q" placeholder={t("Try: {example}", { example: t(EXAMPLES[0]) })} className="min-w-0 flex-1 rounded-2xl border border-line bg-panel px-5 py-3.5 outline-none transition placeholder:text-muted/70 focus:border-gold/60" />
            <button className="rounded-2xl bg-red px-6 font-display text-lg font-bold uppercase tracking-wide transition hover:brightness-110">{t("Ask")}</button>
          </form>
          <div className="mt-3 flex flex-wrap gap-2">
            {EXAMPLES.map((q) => <Link key={q} href={`/boxers?q=${encodeURIComponent(q)}`} className="chip transition hover:text-ink">{t(q)}</Link>)}
          </div>
        </div>
        <div className="relative mx-auto w-full max-w-sm">
          <div className="absolute -inset-6 -z-10 rounded-[2rem] bg-red/20 blur-3xl live" />
          <Link href={`/events/${next.event.id}`} className="block transition hover:scale-[1.015]">
            <Poster event={next.event} main={next.main} red={next.red} blue={next.blue} />
          </Link>
        </div>
      </section>

      {/* Next main event */}
      <section>
        <SectionTitle eyebrow={t.n(daysUntil(next.event.date), "In {n} day", "In {n} days")} title={t("Next main event")} href={`/events/${next.event.id}`} cta={t("Full card")} />
        <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
          <div className="card p-6">
            <div className="ltr-fixed grid grid-cols-[1fr_auto_1fr] items-center gap-4">
              {[next.red, next.blue].map((b, i) => (
                <Link key={b.id} href={`/boxers/${b.slug}`} className={`flex flex-col items-center gap-2 text-center ${i === 1 ? "order-3" : ""}`}>
                  <Headshot boxer={b} size={104} />
                  <div className="font-display text-2xl font-bold leading-tight">{t.name(b.name)}</div>
                  <div className="text-xs text-muted">{flag(b.country)} {t("{record} · {n} KO · Elo {elo}", { record: recordStr(b), n: b.kos, elo: Math.round(b.rating) })}</div>
                </Link>
              ))}
              <div className="order-2 text-center font-display text-3xl font-extrabold text-gold">{t("VS")}</div>
            </div>
            <div className="mt-6"><ProbBar a={t.name(next.red.name)} b={t.name(next.blue.name)} pA={p.pA} pB={p.pB} pDraw={p.pDraw} /></div>
            <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted">
              <span className="chip !border-gold/40 !text-gold">✦ {t(p.confidence)}</span>
              <span className="chip">{p.koProb > 0.5 ? t("Stoppage likely · {pct}% KO/TKO", { pct: Math.round(p.koProb * 100) }) : t("Distance likely · {pct}% KO/TKO", { pct: Math.round(p.koProb * 100) })}</span>
              <Link href={`/compare?a=${next.red.slug}&b=${next.blue.slug}`} className="ms-auto text-ink hover:text-gold">{t("Full matchup breakdown")} <span className="inline-block rtl:rotate-180">→</span></Link>
            </div>
          </div>
          <PickEm bouts={pickBouts} />
        </div>
      </section>

      {/* Upcoming strip */}
      <section>
        <SectionTitle eyebrow={t("Fight calendar")} title={t("Coming up")} href="/events" cta={upcoming.length > STRIP + 1 ? t.n(upcoming.length, "All {n} upcoming card", "All {n} upcoming cards") : undefined} />
        <div className="-mx-5 flex gap-4 overflow-x-auto px-5 pb-3">
          {ups.slice(1).map((e) => (
            <Link key={e.event.id} href={`/events/${e.event.id}`} className="card-hover w-52 shrink-0">
              <Poster event={e.event} main={e.main} red={e.red} blue={e.blue} />
            </Link>
          ))}
        </div>
      </section>

      {/* Rankings */}
      <section className="grid gap-8 lg:grid-cols-[1fr_1fr]">
        <div>
          <SectionTitle eyebrow={t("All divisions")} title={t("Pound for pound")} href="/rankings" cta={t("All division rankings")} />
          <div className="grid gap-3 sm:grid-cols-2">{p4p.map((b, i) => <BoxerCard key={b.id} b={b} rank={i + 1} />)}</div>
          <Link href="/rankings?sex=female" className="mt-3 inline-block text-sm text-muted transition hover:text-ink">{t("Women’s pound for pound")} <span className="inline-block rtl:rotate-180">→</span></Link>
        </div>
        <div>
          <SectionTitle eyebrow={t("Official names & limits")} title={t("Divisions")} />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {DIVISIONS.map((d) => (
              <Link key={d.name} href={`/rankings/${slugifyDivision(d.name)}`} className="card card-hover px-3 py-2.5">
                <div className="text-sm font-semibold leading-tight">{t(d.name)}</div>
                <div className="text-[11px] text-muted">{d.lb ? t("{lb} lb", { lb: d.lb }) : t("200+ lb")}</div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Results + upset */}
      <section className="grid gap-8 lg:grid-cols-[1.2fr_.8fr]">
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
          <div className="mt-6"><SectionTitle title={t("Your watchlist")} /><WatchlistStrip /></div>
        </div>
      </section>
    </div>
  );
}
