import { notFound, redirect } from "next/navigation";
import Link from "@/components/L";
import { getWorld } from "@/lib/world";
import { buildPreview } from "@/lib/preview";
import { getT } from "@/lib/i18n/server";
import { metaFor } from "@/lib/seo-server";
import { localePath } from "@/lib/i18n/config";
import { abs } from "@/lib/seo";
import { daysUntil, fmtDate } from "@/lib/format";
import { divisionLabel } from "@/lib/divisions";
import { Headshot } from "@/components/Portrait";
import { ProbBar } from "@/components/charts";
import { PreviewArticle } from "@/components/PreviewArticle";
import { JsonLd } from "@/components/JsonLd";
import { SectionTitle } from "@/components/ui";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string; id: string }> }) => metaFor(params, async ({ id }, t) => {
  const w = await getWorld();
  const b = w.boutById.get(Number(id));
  if (!b) notFound();
  const pv = buildPreview(w, b, t);
  return {
    path: `/previews/${id}`, type: "article" as const, title: pv.headline,
    description: t("{standfirst} The model favours {name} at {pct}%.", { standfirst: pv.standfirst, name: t.name(pv.pick.favourite.name), pct: Math.round(Math.max(pv.pick.pA, pv.pick.pB) * 100) }).slice(0, 300),
  };
});

export default async function PreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getT();
  const w = await getWorld();
  const bout = w.boutById.get(Number(id));
  if (!bout) notFound();
  if (!bout.upcoming) redirect(localePath(t.locale, `/bouts/${bout.id}`)); // a finished fight has a result page, not a preview
  const pv = buildPreview(w, bout, t);
  const { red, blue, event } = pv;
  const days = Math.max(0, daysUntil(event.date));
  const name = (b: typeof red) => t.name(b.name);

  return (
    <div className="space-y-12">
      <JsonLd data={{
        "@type": "SportsEvent", name: `${name(red)} vs ${name(blue)}`, sport: "Boxing", startDate: event.date, url: abs(localePath(t.locale, `/previews/${bout.id}`)), inLanguage: t.locale,
        location: { "@type": "Place", name: t.name(event.venue), address: { "@type": "PostalAddress", addressLocality: t.name(event.city), addressCountry: event.country } },
        competitor: [red, blue].map((f) => ({ "@type": "Person", name: name(f), url: abs(localePath(t.locale, `/boxers/${f.slug}`)) })),
        eventStatus: bout.status === "cancelled" ? "https://schema.org/EventCancelled" : "https://schema.org/EventScheduled",
      }} />
      <header className="rise">
        <div className="eyebrow mb-2">{t("Fight preview")} · <Link href={`/events/${event.id}`} className="hover:text-ink">{t.name(event.name)}</Link> · {t.n(Math.max(0, days), "In {n} day", "In {n} days")}</div>
        <h1 className="font-display text-4xl font-extrabold uppercase leading-[1.02] sm:text-6xl">{pv.headline}</h1>
        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          <span className="chip">{divisionLabel(bout.weightClass, red.sex, t)}</span>
          <span className="chip">{t.n(bout.rounds, "{n} round", "{n} rounds")}</span>
          <span className="chip">{fmtDate(event.date, { weekday: "short", month: "short", day: "numeric", year: "numeric" }, t.locale)}</span>
          <span className="chip">{t.name(event.venue)}, {t.name(event.city)}</span>
          <span className="chip !border-gold/40 !text-gold" title={t("Fight score out of 100: how close, relevant, entertaining, bookable, fresh and meaningful the fight is")}>{t("fight score")} {pv.score}</span>
        </div>
      </header>

      <section className="card p-6">
        <div className="ltr-fixed grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4">
          {[red, blue].map((f, i) => (
            <Link key={f.id} href={`/boxers/${f.slug}`} className={`flex min-w-0 flex-col items-center gap-2 text-center ${i === 1 ? "order-3" : ""}`}>
              <Headshot boxer={f} size={110} />
              <div className="w-full truncate font-display text-3xl font-bold leading-tight" dir="auto" style={{ color: i === 0 ? "#e5322d" : "#4a8cff" }}>{name(f)}</div>
              <div className="text-xs text-muted"><span className="tabular">{pv.tape[0][i === 0 ? "red" : "blue"]}</span> · Elo {Math.round(f.rating)}</div>
            </Link>
          ))}
          <div className="order-2 font-display text-3xl font-extrabold text-gold">{t("VS")}</div>
        </div>
        <div className="mt-6"><ProbBar a={name(red)} b={name(blue)} pA={pv.pick.pA} pB={pv.pick.pB} pDraw={pv.pick.pDraw} /></div>
        <p className="mt-3 text-center text-xs text-muted">{t("The model’s view (Elo, reach, age, layoff, power and chin), not a guarantee.")}</p>
      </section>

      <section className="grid gap-8 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-8">
          <PreviewArticle id={bout.id} initial={pv.prose} />
          {pv.stakes.length > 0 && (
            <div>
              <div className="eyebrow mb-3">{t("What is at stake")}</div>
              <ul className="space-y-2 text-sm">{pv.stakes.map((s) => <li key={s} className="flex gap-2"><span className="text-gold" aria-hidden>◆</span><span>{s}</span></li>)}</ul>
            </div>
          )}
          <div>
            <div className="eyebrow mb-3">{t("Form")}</div>
            <div className="grid gap-4 sm:grid-cols-2">
              {pv.form.map((f, i) => (
                <div key={f.boxer.id} className="card p-4">
                  <div className="mb-2 flex items-center gap-1.5" dir="ltr" aria-label={t("Last five results")}>
                    {f.results.map((r, k) => <span key={k} className={`grid h-7 w-7 place-items-center rounded-md text-xs font-bold ${r === "W" ? "bg-win/20 text-win" : r === "L" ? "bg-red/20 text-red-ink" : "bg-panel2 text-muted"}`}>{t(r)}</span>)}
                  </div>
                  <div className="text-sm" style={{ color: i === 0 ? "#ff5a54" : "#4a8cff" }}><b>{name(f.boxer)}</b></div>
                  <p className="mt-1 text-sm text-muted">{f.line}</p>
                  {f.last && <p className="mt-1 text-xs text-muted">{f.last}</p>}
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="eyebrow mb-3">{t("The cases")}</div>
            <div className="grid gap-4 sm:grid-cols-2">
              {([[red, pv.cases.red, "#e5322d"], [blue, pv.cases.blue, "#4a8cff"]] as const).map(([f, list, color]) => (
                <div key={f.id} className="card p-4">
                  <div className="mb-2 font-display text-xl font-bold" style={{ color }}>{t("The case for {name}", { name: name(f) })}</div>
                  {list.length ? <ul className="space-y-1.5 text-sm">{list.map((c) => <li key={c}>{c}</li>)}</ul> : <p className="text-sm text-muted">{t("The numbers do not favour either side on this point.")}</p>}
                </div>
              ))}
            </div>
          </div>
          {pv.watch.length > 0 && (
            <div>
              <div className="eyebrow mb-3">{t("What to watch for")}</div>
              <ul className="space-y-2 text-sm">{pv.watch.map((s) => <li key={s} className="flex gap-2"><span className="text-gold" aria-hidden>◆</span><span>{s}</span></li>)}</ul>
            </div>
          )}
        </div>

        <aside className="space-y-6">
          <div className="card p-5">
            <div className="eyebrow mb-3">{t("Tale of the tape")}</div>
            <div className="ltr-fixed text-sm" dir="ltr">
              {pv.tape.map((r) => (
                <div key={r.label} className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 border-t border-line/60 py-2 first:border-0">
                  <span className={`tabular font-semibold ${r.edge === "red" ? "text-red-ink" : ""}`}>{r.red}</span>
                  <span className="text-center text-xs uppercase tracking-widest text-muted" dir="auto">{r.label}</span>
                  <span className={`text-end tabular font-semibold ${r.edge === "blue" ? "text-blue" : ""}`}>{r.blue}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="card p-5">
            <div className="eyebrow mb-3">{t("How it could end")}</div>
            <ul className="space-y-2.5 text-sm">
              {pv.pick.endings.map((e) => (
                <li key={e.label}>
                  <div className="mb-1 flex justify-between gap-3"><span className="min-w-0 truncate">{e.label}</span><b className="tabular">{Math.round(e.pct * 100)}%</b></div>
                  <div className="ltr-fixed h-2 overflow-hidden rounded-full bg-panel2"><div className="h-full rounded-full" style={{ width: `${e.pct * 100}%`, background: e.side === "red" ? "#e5322d" : e.side === "blue" ? "#4a8cff" : "#666" }} /></div>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted">{t("Model estimates; the split between stoppage and points follows each fighter’s finishing record.")}</p>
          </div>
          <div className="card p-5">
            <div className="eyebrow mb-2">{t("Head to head")}</div>
            <p className="text-sm">{pv.head2head}</p>
            <Link href={`/matchmaking?x=${red.slug}&y=${blue.slug}#dream`} className="mt-2 inline-block py-1 text-sm text-muted hover:text-ink">{t("Common opponents and more")} <span className="inline-block rtl:rotate-180">→</span></Link>
          </div>
          {pv.where.length > 0 && (
            <div className="card p-5">
              <div className="eyebrow mb-2">{t("Where to watch")}</div>
              <ul className="space-y-1 text-sm">{pv.where.map((s) => <li key={s}>{s}</li>)}</ul>
            </div>
          )}
        </aside>
      </section>

      <section>
        <SectionTitle eyebrow={t("Keep going")} title={t("More on this fight")} />
        <div className="flex flex-wrap gap-3 text-sm">
          <Link href={`/compare?a=${red.slug}&b=${blue.slug}`} className="chip hover:text-ink">{t("Full matchup breakdown")}</Link>
          <Link href={`/bouts/${bout.id}`} className="chip hover:text-ink">{t("Bout page")}</Link>
          <Link href={`/events/${event.id}`} className="chip hover:text-ink">{t("Full card")}</Link>
          <Link href={`/boxers/${red.slug}`} className="chip hover:text-ink">{name(red)}</Link>
          <Link href={`/boxers/${blue.slug}`} className="chip hover:text-ink">{name(blue)}</Link>
        </div>
      </section>
    </div>
  );
}
