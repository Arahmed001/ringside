import Link from "@/components/L";
import { getWorld } from "@/lib/world";
import { eventViews, upcomingEvents, recentEvents } from "@/lib/events";
import { Poster } from "@/components/Poster";
import { Pager, SectionTitle } from "@/components/ui";
import { paginate } from "@/lib/paging";
import { fmtDate, methodLabel } from "@/lib/format";
import { getT } from "@/lib/i18n/server";
import { metaFor } from "@/lib/seo-server";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => metaFor(params, (p, t) => ({
  path: "/events", title: t("Events"),
  description: t("The fight calendar: upcoming cards with their main events and win probabilities, plus recent results and how each main event ended."),
}));

/** Upcoming cards shown before "show all": each poster is about 25 KB of markup, so a long calendar adds up. */
const UPCOMING_SHOWN = 24;
/** Cards per page when browsing the results of one year. */
const ARCHIVE_PAGE = 24;

export default async function Events({ searchParams }: { searchParams: Promise<{ upcoming?: string; year?: string; page?: string }> }) {
  const t = await getT();
  const sp = await searchParams;
  const showAll = sp.upcoming === "all";
  const w = await getWorld();
  const upcoming = upcomingEvents(w);
  const capped = !showAll && upcoming.length > UPCOMING_SHOWN;
  const ups = eventViews(w, capped ? upcoming.slice(0, UPCOMING_SHOWN) : upcoming);
  const years = [...new Set(w.events.filter((e) => !e.upcoming && e.status !== "cancelled").map((e) => e.date.slice(0, 4)))].sort().reverse();
  const year = sp.year && years.includes(sp.year) ? sp.year : null;
  // a year is browsed in full, a page at a time; without one, the latest cards
  const archive = year ? w.events.filter((e) => !e.upcoming && e.status !== "cancelled" && e.date.startsWith(year)).sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id) : [];
  const { page, pages, first } = paginate(archive.length, sp.page, ARCHIVE_PAGE);
  const recent = eventViews(w, year ? archive.slice(first, first + ARCHIVE_PAGE) : recentEvents(w, 24));
  return (
    <div className="space-y-12">
      <h1 className="sr-only">{t("Events")}</h1>
      <section>
        <p className="mb-4 text-sm"><Link href="/previews" className="chip !border-gold/40 hover:!text-gold">{t("Fight previews")}: {t("what is at stake in each upcoming fight")}</Link></p>
        <SectionTitle eyebrow={t("Fight calendar")} title={t("Upcoming")} {...(capped ? { href: "/events?upcoming=all", cta: t("Show all {n}", { n: upcoming.length }) } : showAll && upcoming.length > UPCOMING_SHOWN ? { href: "/events", cta: t("Show the next {n}", { n: UPCOMING_SHOWN }) } : {})} />
        <div className="grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-4">
          {ups.map((e) => (
            <Link key={e.event.id} href={`/events/${e.event.id}`} className="card-hover block">
              <Poster event={e.event} main={e.main} red={e.red} blue={e.blue} />
            </Link>
          ))}
        </div>
      </section>
      <section>
        <SectionTitle eyebrow={t("Results")} title={year ? t("Events in {year}", { year }) : t("Recent events")} />
        <nav aria-label={t("Browse by year")} className="mb-4 flex flex-wrap gap-1.5">
          <Link href="/events" aria-current={!year ? "page" : undefined} className={`chip ${!year ? "!border-gold/50 !text-gold" : ""}`}>{t("Recent events")}</Link>
          {years.map((y) => <Link key={y} href={`/events?year=${y}`} aria-current={y === year ? "page" : undefined} className={`chip tabular ${y === year ? "!border-gold/50 !text-gold" : ""}`}>{y}</Link>)}
        </nav>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {recent.map((e) => (
            <Link key={e.event.id} href={`/events/${e.event.id}`} className="card-hover">
              <Poster event={e.event} main={e.main} red={e.red} blue={e.blue} />
              <div className="mt-2 flex justify-between text-xs text-muted"><span>{fmtDate(e.event.date, undefined, t.locale)}</span><span>{methodLabel(e.main.method, e.main.endRound, t)}</span></div>
            </Link>
          ))}
        </div>
        {year && <Pager page={page} pages={pages} href={(n) => `/events?year=${year}&page=${n}`} />}
      </section>
    </div>
  );
}
