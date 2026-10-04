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
  return (
    <div className="space-y-12">
      <div className="rise">
        <div className="eyebrow mb-2"><Link href="/countries" className="hover:text-ink">{t("Boxing by country")}</Link></div>
        <h1 className="font-display text-6xl font-extrabold uppercase leading-[.95] sm:text-7xl">{flag(v.name)} {name}</h1>
        <div className="mt-3"><ShareButton title={t("Boxers from {country}", { country: name })} /></div>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label={t("Fighters")} value={v.fighters.toLocaleString("en-US")} sub={t("who have fought")} />
          <Stat label={t("Active")} value={v.active.toLocaleString("en-US")} sub={t("still fighting")} />
          <Stat label={t("Champions")} value={v.champions.length} sub={t("belts held now")} />
          <Stat label={t("Events held here")} value={v.eventCount.toLocaleString("en-US")} sub={t("on record")} />
        </div>
      </div>

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
        <SectionTitle eyebrow={t("Best rated")} title={t("Top fighters")} href={`/boxers?country=${encodeURIComponent(v.name)}`} cta={t("All {n} fighters", { n: v.fighters })} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {v.top.map((b, i) => <BoxerCard key={b.id} b={b} rank={i + 1} />)}
        </div>
      </section>

      {v.next.length > 0 && (
        <section>
          <SectionTitle eyebrow={t("Fight calendar")} title={t("Coming fights")} href="/events" cta={t("All events")} />
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
