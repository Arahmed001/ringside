import Link from "@/components/L";
import { getWorld } from "@/lib/world";
import { countryList } from "@/lib/countries";
import { countryName, flag, countryCode } from "@/lib/format";
import { getT } from "@/lib/i18n/server";
import { metaFor } from "@/lib/seo-server";
import { localePath } from "@/lib/i18n/config";
import { WorldMap, MapKey, type Shade, type Dot } from "@/components/WorldMap";
import { VenueTable } from "@/components/VenueTable";
import { project } from "@/lib/geo/project";
import { topVenues, venueCounts } from "@/lib/venues";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => metaFor(params, (p, t) => ({
  path: "/countries", title: t("Boxing by country"),
  description: t("Every country with a boxer in the Ringside database: its best fighters, current champions, coming fights and the events held there."),
}));

/** The shade of a country on the map, by its number of fighters (the ranges are printed in the key). */
/** Proper names that stay in English inside an Arabic sentence, marked so a screen reader and the line breaker treat them as English. */
const EN = { o: (c: React.ReactNode) => <span lang="en" dir="ltr">{c}</span> };
const levelOf = (n: number): 1 | 2 | 3 | 4 | 5 => (n >= 1000 ? 5 : n >= 200 ? 4 : n >= 50 ? 3 : n >= 10 ? 2 : 1);

export default async function Countries() {
  const t = await getT();
  const w = await getWorld();
  const list = countryList(w);
  const shades: Record<string, Shade> = {};
  for (const c of list) {
    const iso = countryCode(c.name);
    if (iso && !shades[iso]) shades[iso] = { level: levelOf(c.fighters), href: localePath(t.locale, `/countries/${c.slug}`), label: `${countryName(c.name, t.locale)}: ${t.n(c.fighters, "{n} fighter", "{n} fighters")}` };
  }
  const venues = topVenues(w, 400), counts = venueCounts(w);
  const dots: Dot[] = venues.filter((v) => v.lat !== null && v.lon !== null).slice(0, 300).map((v) => { const [x, y] = project(v.lat!, v.lon!); return { x, y, r: 2.2, label: `${v.name}, ${v.city}` }; });
  const anyOsm = venues.some((v) => v.osm);
  return (
    <div className="space-y-10">
      <div>
        <div className="eyebrow mb-2">{t("Where the fighters are from")}</div>
        <h1 className="font-display text-5xl font-extrabold uppercase">{t("Boxing by country")}</h1>
        <p className="mt-2 max-w-3xl text-muted">{t("{n} countries, shaded by the number of fighters. Press a country for its best fighters, its champions, its coming fights and the venues where fights are held.", { n: list.length })}</p>
      </div>
      {list.length ? (
        <section>
          <WorldMap shades={shades} dots={dots} label={t("World map of boxing by country")} />
          <MapKey none={t("No fighters")} steps={[{ level: 1, text: t("1-9") }, { level: 2, text: t("10-49") }, { level: 3, text: t("50-199") }, { level: 4, text: t("200-999") }, { level: 5, text: t("1,000 or more") }]} />
          <p className="mt-2 text-xs text-muted">{dots.length > 0 ? t.rich("White dots are venues that have held fights. Country outlines: <o>Natural Earth</o> (public domain).", EN) : t.rich("Country outlines: <o>Natural Earth</o> (public domain).", EN)}{anyOsm ? <> {t.rich("Some venue places and addresses: <o>© OpenStreetMap contributors (ODbL)</o>.", EN)}</> : null}</p>
        </section>
      ) : <div className="card p-8 text-center text-muted">{t("No fighters yet.")}</div>}

      {venues.length > 0 && (
        <section>
          <div className="eyebrow mb-1">{t("Where fights are held")}</div>
          <h2 className="mb-1 font-display text-3xl font-bold uppercase">{t("The busiest venues")}</h2>
          <p className="mb-3 text-sm text-muted">{t("{placed} of {all} venues are placed on the map so far; the rest are listed by name and city.", { placed: counts.placed.toLocaleString("en-US"), all: counts.all.toLocaleString("en-US") })}</p>
          <VenueTable venues={venues.slice(0, 30)} t={t} showCountry />
        </section>
      )}

      {list.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer select-none py-2 font-display text-xl font-bold uppercase text-muted hover:text-ink">{t("All countries as a list")}</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {list.map((c) => (
              <Link key={c.slug} href={`/countries/${c.slug}`} className="card card-hover p-4">
                <div className="font-display text-xl font-bold leading-tight">{flag(c.name)} {countryName(c.name, t.locale)}</div>
                <div className="mt-1 text-xs text-muted">{t("{fighters} · {active} active", { fighters: t.n(c.fighters, "{n} fighter", "{n} fighters"), active: c.active })}</div>
              </Link>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
