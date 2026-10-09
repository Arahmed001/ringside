import Link from "@/components/L";
import { localePath } from "@/lib/i18n/config";
import { abs } from "@/lib/seo";
import { BreadcrumbLd, JsonLd } from "@/components/JsonLd";
import { isListedEvent } from "@/lib/sitemap";
import { CreditedPicture } from "@/components/CreditedPicture";
import { EventMoney } from "@/components/Money";
import { notFound } from "next/navigation";
import { getWorld, recordStr } from "@/lib/world";
import { eventWithMain } from "@/lib/events";
import { buildNight, nightLines } from "@/lib/night";
import { predict } from "@/lib/predict";
import { Poster } from "@/components/Poster";
import { Headshot } from "@/components/Portrait";
import { ProbBar } from "@/components/charts";
import { fmtDate, flag, methodLabel, daysUntil } from "@/lib/format";
import { divisionLabel } from "@/lib/divisions";
import { getT } from "@/lib/i18n/server";
import { ShareButton } from "@/components/ShareButton";
import { AddToCalendar } from "@/components/AddToCalendar";
import { metaFor } from "@/lib/seo-server";
import { NewsList } from "@/components/NewsList";
import { newsForEvent, videosForEvent } from "@/lib/news/read";
import { Videos } from "@/components/Videos";
import { Social } from "@/components/Social";
import { postsFor } from "@/lib/social/store";
import { SectionTitle } from "@/components/ui";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string; id: string }> }) => metaFor(params, async ({ id }, t) => {
  const w = await getWorld();
  const e = w.eventById.get(Number(id));
  const view = e && eventWithMain(w, e);
  if (!e || !view) notFound();
  return {
    path: `/events/${id}`, title: t.name(e.name), noindex: !isListedEvent(e),
    description: t("Fight card for {event} on {date} at {venue}, {city}. {red} vs {blue} headlines, with predictions and results for every bout.", {
      event: t.name(e.name), date: fmtDate(e.date, undefined, t.locale), venue: t.name(e.venue), city: t.name(e.city), red: t.name(view.red.name), blue: t.name(view.blue.name),
    }),
  };
});

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const t = await getT();
  const { id } = await params;
  const w = await getWorld();
  const e = w.eventById.get(Number(id));
  if (!e) notFound();
  const view = eventWithMain(w, e);
  if (!view) notFound();
  const { bouts, main, red, blue } = view;
  const venue = w.venueOf(e);
  const night = buildNight(w, e.id);
  const nightText = night ? nightLines(night, w, t) : [];
  const news = await newsForEvent(w, e.id);
  const videos = await videosForEvent(w, e.id);
  const posts = postsFor("event", String(e.id));
  return (
    <div className="grid gap-8 lg:grid-cols-[360px_1fr]">
      <BreadcrumbLd locale={t.locale} trail={[{ name: t("Events"), path: "/events" }, { name: t.name(e.name), path: `/events/${e.id}` }]} />
      <JsonLd data={{
        "@type": "SportsEvent", name: t.name(e.name), sport: "Boxing", startDate: e.date, url: abs(localePath(t.locale, `/events/${e.id}`)), inLanguage: t.locale,
        eventStatus: e.status === "cancelled" ? "https://schema.org/EventCancelled" : e.status === "postponed" ? "https://schema.org/EventPostponed" : "https://schema.org/EventScheduled",
        location: {
          "@type": "Place", name: t.name(e.venue), address: { "@type": "PostalAddress", addressLocality: t.name(e.city), addressCountry: e.country },
          ...(venue ? { sameAs: [`https://www.wikidata.org/wiki/${venue.wikidataId}`], ...(venue.lat !== null && venue.lon !== null ? { geo: { "@type": "GeoCoordinates", latitude: venue.lat, longitude: venue.lon } } : {}), ...(venue.capacity ? { maximumAttendeeCapacity: venue.capacity } : {}) } : {}),
        },
        competitor: [red, blue].map((f) => ({ "@type": "Person", name: t.name(f.name), url: abs(localePath(t.locale, `/boxers/${f.slug}`)) })),
      }} />
      <div className="min-w-0 space-y-4 lg:sticky lg:top-24 lg:self-start"><Poster event={e} main={main} red={red} blue={blue} />{venue?.picture && <CreditedPicture picture={venue.picture} alt={t("Photo of {venue}", { venue: t.name(e.venue) })} imgClassName="max-h-52" />}</div>
      <div className="min-w-0">
        <div className="eyebrow mb-2">{e.status === "cancelled" ? t("Cancelled") : e.status === "postponed" ? t.n(daysUntil(e.date), "Postponed · now {n} day away", "Postponed · now {n} days away") : e.upcoming ? t.n(daysUntil(e.date), "In {n} day", "In {n} days") : t("Final results")}</div>
        <h1 className="font-display text-5xl font-extrabold uppercase leading-none">{t.name(e.name)}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-2"><ShareButton title={t.name(e.name)} />{e.upcoming && e.status !== "cancelled" && <AddToCalendar kind="event" id={e.id} />}</div>
        <div className="mt-2 text-muted">{fmtDate(e.date, { weekday: "long", month: "long", day: "numeric", year: "numeric" }, t.locale)} · {t.name(e.venue)}, {t.name(e.city)} {flag(e.country)}</div>
        {venue && (venue.capacity || venue.lat !== null) && (
          <div className="mt-1 text-xs text-muted">
            {venue.capacity ? t("Seats about {n} (general figure)", { n: venue.capacity.toLocaleString("en") }) : null}
            {venue.capacity && venue.lat !== null ? " · " : null}
            {venue.lat !== null && venue.lon !== null && <a href={`https://www.openstreetmap.org/?mlat=${venue.lat}&mlon=${venue.lon}#map=16/${venue.lat}/${venue.lon}`} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted hover:text-ink">{t("Map")}</a>}
            {" · "}<a href={`https://www.wikidata.org/wiki/${venue.wikidataId}`} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted hover:text-ink">{t("Venue data: Wikidata")}</a>
          </div>
        )}
        {nightText.length > 0 && (
          <section className="card mt-6 p-5">
            <div className="eyebrow mb-3">{t("Night in review")}</div>
            <p className="font-display text-2xl font-bold leading-snug">{nightText[0]}</p>
            <ul className="mt-3 list-disc space-y-1.5 ps-5 text-sm text-ink/90">
              {nightText.slice(1).map((line, i) => <li key={i}>{line}</li>)}
            </ul>
          </section>
        )}
        <EventMoney w={w} event={e} />
        <div className="mt-8 space-y-3">
          {bouts.map((b, i) => {
            const r = w.byId.get(b.redId)!, u = w.byId.get(b.blueId)!;
            const p = predict(r, u, t);
            const cancelled = b.status === "cancelled";
            return (
              <div key={b.id} className={`card ${i === 0 ? "p-5 sm:p-6" : i === 1 ? "p-4" : "p-3"}`} style={i === 0 ? { backgroundImage: "linear-gradient(90deg, rgb(229 50 45 / .12), transparent 38%, transparent 62%, rgb(74 140 255 / .12))" } : undefined}>
                <div className="mb-3 flex items-center justify-between text-xs text-muted">
                  <span className="uppercase tracking-widest">{i === 0 ? t("Main event") : i === 1 ? t("Co-main") : t("Undercard")} · {divisionLabel(b.weightClass, r.sex, t)} · {t.n(b.rounds, "{n} rd", "{n} rds")}</span>
                  {cancelled ? <span className="chip !border-red/40 !text-red-ink">{t("Cancelled")}</span> : b.title && <span className="chip !border-gold/40 !text-gold">{t.name(b.title)}</span>}
                </div>
                <div className="ltr-fixed grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
                  {[r, u].map((f, k) => (
                    <Link key={f.id} href={`/boxers/${f.slug}`} className={`flex min-w-0 flex-col items-center gap-2 text-center sm:flex-row sm:gap-3 sm:text-start ${k === 1 ? "order-3 sm:flex-row-reverse sm:text-end" : ""}`}>
                      <Headshot boxer={f} size={i === 0 ? 72 : i === 1 ? 52 : 40} className={cancelled ? "opacity-60" : ""} />
                      <div className="min-w-0">
                        <div className={`break-words font-display font-bold leading-tight ${i === 0 ? "text-2xl sm:text-4xl" : i === 1 ? "text-xl" : "text-base sm:text-lg"} ${b.winnerId === f.id ? "text-win" : ""}`}>{b.winnerId === f.id && "✓ "}{t.name(f.name)}</div>
                        <div className="text-xs text-muted">{recordStr(f)} · {Math.round(f.rating)}</div>
                      </div>
                    </Link>
                  ))}
                  <Link href={`/bouts/${b.id}`} className="order-2 min-w-6 py-1 text-center transition hover:opacity-80" title={t("Full bout details")}><div className={`font-display font-bold text-gold ${i === 0 ? "text-2xl sm:text-3xl" : "text-xl"}`}>{t("VS")}</div>{b.method && <div className="text-xs tabular text-muted">{methodLabel(b.method, b.endRound, t)}</div>}</Link>
                </div>
                {b.upcoming && !cancelled && <div className="mt-3 text-end"><Link href={`/previews/${b.id}`} className="inline-block py-1 text-sm text-muted hover:text-gold">{t("Read the preview")} <span className="inline-block rtl:rotate-180">→</span></Link></div>}
                {b.upcoming && !cancelled && <div className="mt-4"><ProbBar a={t.name(r.name)} b={t.name(u.name)} pA={p.pA} pB={p.pB} pDraw={p.pDraw} /></div>}
              </div>
            );
          })}
        </div>
        {posts.length > 0 && <section className="mt-8"><SectionTitle eyebrow={t("Posts")} title={t("Chosen from official accounts")} /><Social items={posts} t={t} /></section>}
        {videos.length > 0 && <section className="mt-8"><SectionTitle eyebrow={t("Official videos")} title={t("Videos about this card")} /><Videos items={videos} t={t} /></section>}
        {news.length > 0 && <section className="mt-8"><SectionTitle eyebrow={t("In the news")} title={t("Headlines about this card")} href="/news" cta={t("All headlines")} /><NewsList items={news} t={t} /></section>}
      </div>
    </div>
  );
}
