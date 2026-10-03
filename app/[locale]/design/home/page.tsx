import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "@/components/L";
import { getWorld } from "@/lib/world";
import { overview } from "@/lib/analytics";
import { pound4pound } from "@/lib/rankings";
import { eventViews, isLive, upcomingEvents } from "@/lib/events";
import { predict } from "@/lib/predict";
import { divisionLabel } from "@/lib/divisions";
import { Poster } from "@/components/Poster";
import { Headshot } from "@/components/Portrait";
import { ProbBar } from "@/components/charts";
import { PickEm } from "@/components/PickEm";
import { SectionTitle } from "@/components/ui";
import { AskResults } from "@/components/AskResults";
import { askData } from "@/lib/ask";
import { exampleQuestions } from "@/lib/ask/examples";
import { clientId } from "@/lib/ai-guard";
import { upsetWatch } from "@/lib/upsets";
import { daysUntil, fmtDate, flag } from "@/lib/format";
import { recordStr } from "@/lib/world";
import { getT } from "@/lib/i18n/server";
import { getNames } from "@/lib/i18n/names";
import { localePath } from "@/lib/i18n/config";

/**
 * DESIGN LAB, not part of the site: three alternative directions for the top of the home page, built from the real components and the real
 * data so they can be judged in both languages. DESIGN.md says not to change the look without approval, so none of this touches `/`.
 * Returns 404 in a production build unless DESIGN_LAB=1. Delete the folder when a direction is chosen.
 */
export const metadata: Metadata = { title: "Design lab: home", robots: { index: false, follow: false } };

const VARIANTS = {
  a: { name: "A · Program cover", line: "The next fight is the page. The poster is large, the headline is the matchup, the brand line and the search step back." },
  b: { name: "B · Control room", line: "Numbers first. A status row, the pound-for-pound list, the main event and the pick'em side by side: the page reads like a dashboard with a poster in it." },
  c: { name: "C · Ask first", line: "The question box is the product. A real answer is shown under it, computed from the database, so a visitor sees what asking gives them." },
} as const;
type V = keyof typeof VARIANTS;

export default async function HomeLab({ searchParams }: { searchParams: Promise<{ v?: string }> }) {
  if (process.env.NODE_ENV === "production" && process.env.DESIGN_LAB !== "1") notFound();
  const v = (((await searchParams).v ?? "a") in VARIANTS ? (await searchParams).v : "a") as V;
  const t = await getT();
  const w = await getWorld();
  const o = overview(w);
  const upcoming = upcomingEvents(w);
  const ups = eventViews(w, upcoming.slice(0, 7));
  const next = ups[0];
  const p = predict(next.red, next.blue, t);
  const p4p = pound4pound(w, 8);
  const live = upsetWatch(w, t).filter((x) => x.tier === "live").length;
  const pickBouts = next.bouts.filter(isLive).slice().reverse().map((b) => {
    const r = w.byId.get(b.redId)!, u = w.byId.get(b.blueId)!;
    const pr = predict(r, u, t);
    const redFav = pr.pA >= pr.pB;
    return { id: b.id, red: t.name(r.name), blue: t.name(u.name), redId: r.id, blueId: u.id, modelPickId: redFav ? r.id : u.id, modelPct: Math.round(Math.max(pr.pA, pr.pB) * 100), label: divisionLabel(b.weightClass, r.sex, t).slice(0, 12) };
  });
  const sur = (n: string) => t.name(n).split(" ").slice(-1)[0];
  const days = daysUntil(next.event.date);

  const matchupCard = (
    <div className="card p-6">
      <div className="ltr-fixed grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4">
        {[next.red, next.blue].map((b, i) => (
          <Link key={b.id} href={`/boxers/${b.slug}`} className={`flex flex-col items-center gap-2 text-center ${i === 1 ? "order-3" : ""}`}>
            <Headshot boxer={b} size={96} />
            <div className="font-display text-2xl font-bold leading-tight">{t.name(b.name)}</div>
            <div className="text-xs text-muted">{flag(b.country)} {recordStr(b)} · Elo {Math.round(b.rating)}</div>
          </Link>
        ))}
        <div className="order-2 text-center font-display text-3xl font-extrabold text-gold">{t("VS")}</div>
      </div>
      <div className="mt-6"><ProbBar a={t.name(next.red.name)} b={t.name(next.blue.name)} pA={p.pA} pB={p.pB} pDraw={p.pDraw} /></div>
      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
        <Link href={`/previews/${next.main.id}`} className="chip !border-gold/40 hover:!text-gold">{t("Read the preview")}</Link>
        <Link href={`/compare?a=${next.red.slug}&b=${next.blue.slug}`} className="ms-auto inline-block py-1 text-ink hover:text-gold">{t("Full matchup breakdown")} <span className="inline-block rtl:rotate-180">→</span></Link>
      </div>
    </div>
  );

  const askBar = (big: boolean) => (
    <form action={localePath(t.locale, "/ask")} className={`flex gap-2 ${big ? "max-w-3xl" : "max-w-xl"}`}>
      <input name="q" aria-label={t("Ask the data")} placeholder={t("Who has the most knockouts among women?")} className={`min-w-0 flex-1 rounded-2xl border border-line bg-panel outline-none transition placeholder:text-muted focus:border-gold/60 ${big ? "px-6 py-5 text-lg" : "px-5 py-3.5"}`} />
      <button className={`rounded-2xl bg-red-btn font-display font-bold uppercase tracking-wide text-white transition hover:brightness-90 ${big ? "px-9 text-2xl" : "px-6 text-lg"}`}>{t("Ask")}</button>
    </form>
  );

  let body: React.ReactNode;
  if (v === "a") {
    body = (
      <>
        <section className="rise grid items-end gap-10 lg:grid-cols-[minmax(0,27rem)_1fr]">
          <div className="relative mx-auto w-full max-w-md">
            <div className="absolute -inset-8 -z-10 rounded-[2rem] bg-red/25 blur-3xl live" />
            <Link href={`/events/${next.event.id}`} className="block transition hover:scale-[1.015]"><Poster event={next.event} main={next.main} red={next.red} blue={next.blue} /></Link>
          </div>
          <div>
            <div className="eyebrow mb-3">{t.n(days, "In {n} day", "In {n} days")} · {fmtDate(next.event.date, undefined, t.locale)} · {next.event.venue}</div>
            <h1 className={`font-display font-extrabold uppercase ${t.locale === "ar" ? "text-6xl leading-[1.25] sm:text-8xl" : "text-7xl leading-[.9] sm:text-9xl"}`}><span>{sur(next.red.name)}</span><br /><span className="text-2xl font-bold text-gold sm:text-4xl">{t("VS")}</span><br /><span className="text-red-ink">{sur(next.blue.name)}</span></h1>
            <p className="mt-5 max-w-xl text-lg text-muted">{t("{a} vs {b}", { a: t.name(next.red.name), b: t.name(next.blue.name) })} · {next.main.title ? t.name(next.main.title) : divisionLabel(next.main.weightClass, next.red.sex, t)}</p>
            <div className="mt-6 max-w-xl"><ProbBar a={t.name(next.red.name)} b={t.name(next.blue.name)} pA={p.pA} pB={p.pB} pDraw={p.pDraw} /></div>
            <div className="mt-5 flex flex-wrap gap-2">
              <Link href={`/previews/${next.main.id}`} className="rounded-xl bg-red-btn px-5 py-2.5 font-display text-lg font-bold uppercase text-white transition hover:brightness-90">{t("Read the preview")}</Link>
              <Link href={`/compare?a=${next.red.slug}&b=${next.blue.slug}`} className="rounded-xl border border-line bg-panel2 px-5 py-2.5 font-display text-lg font-bold uppercase transition hover:border-white/30">{t("Full matchup breakdown")}</Link>
            </div>
            <div className="mt-10">{askBar(false)}</div>
          </div>
        </section>
        <section className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
          <div><SectionTitle eyebrow={t("Fight calendar")} title={t("Coming up")} href="/events" />
            <div className="-mx-5 flex gap-4 overflow-x-auto px-5 pb-3">{ups.slice(1).map((e) => <Link key={e.event.id} href={`/events/${e.event.id}`} className="card-hover w-44 shrink-0"><Poster event={e.event} main={e.main} red={e.red} blue={e.blue} /></Link>)}</div></div>
          <PickEm bouts={pickBouts} />
        </section>
      </>
    );
  } else if (v === "b") {
    const tiles: [string, string, string][] = [
      [t("Next main event"), t.n(days, "In {n} day", "In {n} days"), `${sur(next.red.name)} – ${sur(next.blue.name)}`],
      [t("Fight calendar"), String(upcoming.length), t("Upcoming cards")],
      [t("Upset watch"), String(live), t("Live underdogs")],
      [t("Fighters"), o.boxers.toLocaleString("en-US"), t("{n} bouts", { n: o.bouts.toLocaleString("en-US") })],
    ];
    body = (
      <>
        <section className="rise space-y-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h1 className="font-display text-5xl font-extrabold uppercase leading-[.95] sm:text-6xl">{t("Every fighter.")} <span className="text-red-ink">{t("Every number.")}</span></h1>
            {askBar(false)}
          </div>
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {tiles.map(([k, val, sub]) => <div key={k} className="card p-4"><dt className="text-xs uppercase tracking-widest text-muted">{k}</dt><dd className="font-display text-4xl font-bold leading-tight tabular">{val}</dd><dd className="text-xs text-muted">{sub}</dd></div>)}
          </dl>
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,.8fr)_minmax(0,1.2fr)_minmax(19rem,1fr)]">
            <div className="card p-5">
              <div className="eyebrow mb-2">{t("Pound for pound")}</div>
              <ol className="space-y-1.5">
                {p4p.map((b, i) => (
                  <li key={b.id}><Link href={`/boxers/${b.slug}`} className="flex items-center gap-3 rounded-xl px-2 py-1.5 transition hover:bg-panel2">
                    <span className="w-5 text-end font-display text-lg font-bold text-muted tabular">{i + 1}</span>
                    <Headshot boxer={b} size={36} />
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">{t.name(b.name)}</span>
                    <span className="font-display text-lg font-bold text-gold tabular">{Math.round(b.rating)}</span>
                  </Link></li>
                ))}
              </ol>
              <Link href="/rankings" className="mt-3 inline-block py-1 text-sm text-muted hover:text-ink">{t("All division rankings")} <span className="inline-block rtl:rotate-180">→</span></Link>
            </div>
            <div className="space-y-5">
              <div className="grid items-center gap-4 sm:grid-cols-[9rem_1fr]">
                <Link href={`/events/${next.event.id}`} className="mx-auto block w-36 transition hover:scale-[1.02]"><Poster event={next.event} main={next.main} red={next.red} blue={next.blue} /></Link>
                <div><div className="eyebrow mb-1">{t("Next main event")}</div><div className="font-display text-3xl font-bold uppercase leading-none">{fmtDate(next.event.date, undefined, t.locale)}</div><div className="mt-1 text-sm text-muted">{next.event.venue} · {next.event.city}</div></div>
              </div>
              {matchupCard}
            </div>
            <PickEm bouts={pickBouts} />
          </div>
        </section>
      </>
    );
  } else {
    const names = await getNames(t.locale);
    const q = exampleQuestions(w, t)[0];
    const answer = await askData(q, { w, t, names }, clientId(await headers()));
    body = (
      <>
        <section className="rise grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_17rem]">
          <div>
            <div className="eyebrow mb-3">{t("Ask the data")} · {o.boxers.toLocaleString("en-US")} {t("Fighters")}</div>
            <h1 className="font-display text-6xl font-extrabold uppercase leading-[.92] sm:text-8xl">{t("Ask the data")}<span className="text-red-ink">.</span></h1>
            <p className="mt-4 max-w-2xl text-lg text-muted">{t("Ratings, rankings, win-probabilities and AI scouting for the whole sport, in one place. Ask in plain English.")}</p>
            <div className="mt-7">{askBar(true)}</div>
            <div className="mt-3 flex max-w-3xl flex-wrap gap-2">
              {exampleQuestions(w, t).slice(0, 5).map((e) => <Link key={e} href={`/ask?q=${encodeURIComponent(e)}`} className="chip transition hover:text-ink">{e}</Link>)}
            </div>
            <div className="mt-8 max-w-3xl">
              <div className="eyebrow mb-2">{t("Try: {example}", { example: q })}</div>
              <AskResults a={answer} />
            </div>
          </div>
          <aside className="space-y-4">
            <Link href={`/events/${next.event.id}`} className="block transition hover:scale-[1.015]"><Poster event={next.event} main={next.main} red={next.red} blue={next.blue} /></Link>
            <div className="card p-4"><div className="eyebrow mb-2">{t("Pound for pound")}</div>
              <ol className="space-y-1 text-sm">{p4p.slice(0, 5).map((b, i) => <li key={b.id} className="flex justify-between gap-2"><Link href={`/boxers/${b.slug}`} className="truncate hover:text-gold"><span className="text-muted tabular">{i + 1}</span> {t.name(b.name)}</Link><span className="text-gold tabular">{Math.round(b.rating)}</span></li>)}</ol></div>
          </aside>
        </section>
        <section className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">{matchupCard}<PickEm bouts={pickBouts} /></section>
      </>
    );
  }

  return (
    <div className="space-y-12 overflow-x-clip">
      <div className="card flex flex-wrap items-center gap-x-6 gap-y-3 border-gold/40 p-4 text-sm">
        <div><div className="eyebrow">Design lab · not part of the site</div><div className="text-muted">{VARIANTS[v].line}</div></div>
        <nav aria-label="Directions" className="ms-auto flex flex-wrap gap-2">
          {(Object.keys(VARIANTS) as V[]).map((k) => <Link key={k} href={`/design/home?v=${k}`} aria-current={k === v ? "page" : undefined} className={`chip ${k === v ? "!border-gold/60 !text-gold" : "hover:text-ink"}`}>{VARIANTS[k].name}</Link>)}
          <Link href="/" className="chip hover:text-ink">Current home</Link>
        </nav>
      </div>
      {body}
      <p className="text-xs text-muted">Only the top of the page differs between directions. Below this, the home page is unchanged in all three: calendar, pound for pound, divisions, recent main events, upset of the year, upset watch, fight of the year.</p>
    </div>
  );
}
