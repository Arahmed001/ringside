import type { Metadata } from "next";
import Link from "next/link";
import { getWorld } from "@/lib/world";
import { eventViews, upcomingEvents, recentEvents } from "@/lib/events";
import { Poster } from "@/components/Poster";
import { SectionTitle } from "@/components/ui";
import { fmtDate, methodLabel } from "@/lib/format";

export const metadata: Metadata = { title: "Events" };

export default async function Events() {
  const w = await getWorld();
  const ups = eventViews(w, upcomingEvents(w));
  const recent = eventViews(w, recentEvents(w, 24));
  return (
    <div className="space-y-12">
      <section>
        <SectionTitle eyebrow="Fight calendar" title="Upcoming" />
        <div className="grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-4">
          {ups.map((e) => (
            <Link key={e.event.id} href={`/events/${e.event.id}`} className="card-hover block">
              <Poster event={e.event} main={e.main} red={e.red} blue={e.blue} />
            </Link>
          ))}
        </div>
      </section>
      <section>
        <SectionTitle eyebrow="Results" title="Recent events" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {recent.map((e) => (
            <Link key={e.event.id} href={`/events/${e.event.id}`} className="card-hover">
              <Poster event={e.event} main={e.main} red={e.red} blue={e.blue} />
              <div className="mt-2 flex justify-between text-xs text-muted"><span>{fmtDate(e.event.date)}</span><span>{methodLabel(e.main.method, e.main.endRound)}</span></div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
