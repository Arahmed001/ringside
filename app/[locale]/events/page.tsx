import Link from "@/components/L";
import { getWorld } from "@/lib/world";
import { eventViews, upcomingEvents, recentEvents } from "@/lib/events";
import { Poster } from "@/components/Poster";
import { SectionTitle } from "@/components/ui";
import { fmtDate, methodLabel } from "@/lib/format";
import { getT } from "@/lib/i18n/server";
import { metaFor } from "@/lib/seo-server";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => metaFor(params, (p, t) => ({
  path: "/events", title: t("Events"),
  description: t("The fight calendar: upcoming cards with their main events and win probabilities, plus recent results and how each main event ended."),
}));

/** Upcoming cards shown before "show all": each poster is about 25 KB of markup, so a long calendar adds up. */
const UPCOMING_SHOWN = 24;

export default async function Events({ searchParams }: { searchParams: Promise<{ upcoming?: string }> }) {
  const t = await getT();
  const showAll = (await searchParams).upcoming === "all";
  const w = await getWorld();
  const upcoming = upcomingEvents(w);
  const capped = !showAll && upcoming.length > UPCOMING_SHOWN;
  const ups = eventViews(w, capped ? upcoming.slice(0, UPCOMING_SHOWN) : upcoming);
  const recent = eventViews(w, recentEvents(w, 24));
  return (
    <div className="space-y-12">
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
        <SectionTitle eyebrow={t("Results")} title={t("Recent events")} />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {recent.map((e) => (
            <Link key={e.event.id} href={`/events/${e.event.id}`} className="card-hover">
              <Poster event={e.event} main={e.main} red={e.red} blue={e.blue} />
              <div className="mt-2 flex justify-between text-xs text-muted"><span>{fmtDate(e.event.date, undefined, t.locale)}</span><span>{methodLabel(e.main.method, e.main.endRound, t)}</span></div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
