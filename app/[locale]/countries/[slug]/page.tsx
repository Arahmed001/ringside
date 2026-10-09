import Link from "@/components/L";
import { notFound } from "next/navigation";
import { getWorld } from "@/lib/world";
import { countryView } from "@/lib/countries";
import { beltLabel } from "@/lib/lineage";
import { Headshot } from "@/components/Portrait";
import { BoxerCard, SectionTitle, Stat } from "@/components/ui";
import { countryName, flag, fmtDate } from "@/lib/format";
import { getT } from "@/lib/i18n/server";
import { ShareButton } from "@/components/ShareButton";
import { metaFor } from "@/lib/seo-server";
import { BreadcrumbLd } from "@/components/JsonLd";
import { WorldMap, viewFor, type Dot } from "@/components/WorldMap";
import { VenueTable } from "@/components/VenueTable";
import { project } from "@/lib/geo/project";
import { venuesOfCountry } from "@/lib/venues";
import { countryCode } from "@/lib/format";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string; slug: string }> }) =>
  metaFor(params, async ({ slug }, t) => {
    const v = countryView(await getWorld(), slug, { top: 0, next: 0, events: 0 });
    if (!v) return { path: `/countries/${slug}`, title: t("Boxing by country"), description: t("Every country with a boxer in the Ringside database: its best fighters, current champions, coming fights and the events held there.") };
    const name = countryName(v.name, t.locale);
    return {
      path: `/countries/${v.slug}`, title: t("Boxers from {country}", { country: name }),
      description: t("The best-rated boxers from {country}: current champions, coming fights and events held there. {n} fighters in the Ringside database.", { country: name, n: v.fighters }),
    };
  });

export default async function Country({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const t = await getT();
  const w = await getWorld();
  const v = countryView(w, slug);
  if (!v) notFound();
  const name = countryName(v.name, t.locale);
  const venues = venuesOfCountry(w, slug), iso = countryCode(v.name);
  const placed = venues.filter((x) => x.lat !== null && x.lon !== null);
  const dots: Dot[] = placed.slice(0, 120).map((x) => { const [px, py] = project(x.lat!, x.lon!); return { x: px, y: py, r: 3, label: `${x.name}, ${x.city}`, href: `#venue-${venues.indexOf(x)}` }; });
  return (
    <div className="space-y-12">
      <BreadcrumbLd locale={t.locale} trail={[{ name: t("Boxing by country"), path: "/countries" }, { name, path: `/countries/${v.slug}` }]} />
      <div className="rise">
        <div className="eyebrow mb-2"><Link href="/countries" className="-my-1.5 inline-block py-1.5 hover:text-ink">{t("Boxing by country")}</Link></div>
        <h1 className="font-display text-6xl font-extrabold uppercase leading-[.95] sm:text-7xl">{flag(v.name)} {name}</h1>
        <div className="mt-3"><ShareButton title={t("Boxers from {country}", { country: name })} /></div>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label={t("Fighters")} value={v.fighters.toLocaleString("en-US")} sub={t("who have fought")} />
          <Stat label={t("Active")} value={v.active.toLocaleString("en-US")} sub={t("still fighting")} />
          <Stat label={t("Champions")} value={v.champions.length} sub={t("belts held now")} />
          <Stat label={t("Events held here")} value={v.eventCount.toLocaleString("en-US")} sub={t("on record")} />
        </div>
      </div>

      {venues.length > 0 && (
        <section>
          <SectionTitle eyebrow={t("Where fights are held")} title={t("Venues in {country}", { country: name })} />
          {dots.length > 0 && (
            <>
              <WorldMap view={viewFor(iso, dots)} dots={dots} shades={{}} current={iso} label={t("Map of the venues in {country}", { country: name })} className="mb-2 max-w-4xl" />
              <p className="mb-3 text-xs text-muted">{t("{placed} of {all} venues are placed on the map so far; the rest are listed by name and city.", { placed: placed.length.toLocaleString("en-US"), all: venues.length.toLocaleString("en-US") })} {t("Country outlines: Natural Earth (public domain).")}{venues.some((x) => x.osm) ? <> {t("Some venue places and addresses: © OpenStreetMap contributors (ODbL).")}</> : null}</p>
            </>
          )}
          <VenueTable venues={venues.slice(0, 50)} t={t} />
          {venues.length > 50 && <p className="mt-2 text-xs text-muted">{t("The 50 busiest of {n} venues.", { n: venues.length.toLocaleString("en-US") })}</p>}
        </section>
      )}

      {v.nations.length > 0 && (
        <section>
          <SectionTitle eyebrow={t("Inside {country}", { country: name })} title={t("The nations")} />
          <div className="flex flex-wrap gap-2">
            {v.nations.map((n) => <Link key={n.slug} href={`/countries/${n.slug}`} className="chip hover:text-ink">{flag(n.name)} {countryName(n.name, t.locale)} · {n.fighters.toLocaleString("en-US")}</Link>)}
          </div>
        </section>
      )}

      {v.champions.length > 0 && (
        <section>
          <SectionTitle eyebrow={t("Champions")} title={t("Belts held by a fighter from {country}", { country: name })} href="/titles" cta={t("All belts")} />
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {v.champions.map(({ belt, boxerId }) => {
              const champ = w.byId.get(boxerId)!;
              return (
                <Link key={belt.slug} href={`/titles/${belt.slug}`} className="card card-hover flex items-center gap-3 p-4">
                  <Headshot boxer={champ} size={44} />
                  <div className="min-w-0">
                    <div className="text-xs uppercase tracking-widest text-gold">{beltLabel(belt, t)}</div>
                    <div className="truncate font-display text-xl font-bold leading-tight">{t.name(champ.name)}</div>
                    {belt.current && <div className="text-xs text-muted">{t("since {date}", { date: fmtDate(belt.current.start, { month: "short", year: "numeric" }, t.locale) })}</div>}
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      <section>
        <SectionTitle eyebrow={t("Top rated")} title={t("Top fighters")} href={`/boxers?country=${encodeURIComponent(v.name)}`} cta={t("All {n} fighters", { n: v.fighters })} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {v.top.map((b, i) => <BoxerCard key={b.id} b={b} rank={i + 1} />)}
        </div>
      </section>

      {v.next.length > 0 && (
        <section>
          <SectionTitle eyebrow={t("Fight calendar")} title={t("Upcoming fights")} href="/events" cta={t("All events")} />
          <ul className="grid gap-3 md:grid-cols-2">
            {v.next.map((b) => (
              <li key={b.id}>
                <Link href={`/bouts/${b.id}`} className="card card-hover block p-4">
                  <div className="text-xs text-muted">{fmtDate(b.date, undefined, t.locale)} · {t.name(b.eventName)}</div>
                  <div className="font-display text-xl font-bold leading-tight">{t("{a} vs {b}", { a: t.name(b.redName), b: t.name(b.blueName) })}</div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {v.events.length > 0 && (
        <section>
          <SectionTitle eyebrow={t("Events held here")} title={t("Recent cards in {country}", { country: name })} href="/events" cta={t("All events")} />
          <ul className="grid gap-3 md:grid-cols-2">
            {v.events.map((e) => (
              <li key={e.id}>
                <Link href={`/events/${e.id}`} className="card card-hover block p-4">
                  <div className="text-xs text-muted">{fmtDate(e.date, undefined, t.locale)} · {t.name(e.city)}</div>
                  <div className="font-display text-xl font-bold leading-tight">{t.name(e.name)}</div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
