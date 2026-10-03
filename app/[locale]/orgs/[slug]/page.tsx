import Link from "@/components/L";
import { localePath } from "@/lib/i18n/config";
import { abs } from "@/lib/seo";
import { JsonLd } from "@/components/JsonLd";
import { notFound } from "next/navigation";
import { getWorld } from "@/lib/world";
import { orgStable } from "@/lib/team";
import { TenureTable } from "@/components/TenureTable";
import { Headshot } from "@/components/Portrait";
import { SectionTitle, Stat } from "@/components/ui";
import { countryName, flag, fmtDate } from "@/lib/format";
import { getT } from "@/lib/i18n/server";
import { msg } from "@/lib/i18n/t";
import { metaFor } from "@/lib/seo-server";

const KIND: Record<string, string> = { gym: msg("Gym"), promotion: msg("Promotion"), sanctioning_body: msg("Sanctioning body"), broadcaster: msg("Broadcaster") };

export const generateMetadata = ({ params }: { params: Promise<{ locale: string; slug: string }> }) => metaFor(params, async (q, t) => {
  const w = await getWorld();
  const o = w.orgsBySlug.get(q.slug);
  if (!o) notFound();
  const name = t.name(o.name);
  let description: string;
  if (o.kind === "sanctioning_body") description = t("{name} on Ringside: current titleholders by division and recent title fights, drawn from {n} title bouts on record.", { name, n: w.bouts.filter((b) => b.titleOrgId === o.id && !b.upcoming && b.method).length });
  else {
    const s = orgStable(w, o.id, o.kind === "gym" ? ["gym"] : ["promoter"]);
    description = t("{name} ({kind}) on Ringside: {now} fighters now, {ever} ever, a {record} combined record and {titles} title wins.", { name, kind: t(KIND[o.kind] ?? "Organisation"), now: s.currentFighters, ever: s.fighters, record: `${s.record.wins}-${s.record.losses}-${s.record.draws}`, titles: s.titleWins });
  }
  return { path: `/orgs/${q.slug}`, title: name, description };
});

export default async function OrgPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const t = await getT();
  const { slug } = await params;
  const w = await getWorld();
  const o = w.orgsBySlug.get(slug);
  if (!o) notFound();

  if (o.kind === "sanctioning_body") {
    const title = w.bouts.filter((b) => b.titleOrgId === o.id && !b.upcoming && b.method).reverse();
    const latest = new Map<string, (typeof title)[0]>();
    for (const b of title) if (b.winnerId && !latest.has(b.weightClass)) latest.set(b.weightClass, b);
    return (
      <div className="space-y-10">
        <div><div className="eyebrow mb-2">{t(KIND[o.kind])}</div><h1 className="font-display text-5xl font-extrabold uppercase leading-none">{t.name(o.name)}</h1><p className="mt-2 text-muted">{t.n(title.length, "{n} title bout on record", "{n} title bouts on record")}</p></div>
        <section>
          <SectionTitle eyebrow={t("Winner of the most recent title fight")} title={t("Current titleholders")} />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[...latest.entries()].map(([division, b]) => {
            const champ = w.byId.get(b.winnerId!)!;
            return <Link key={division} href={`/boxers/${champ.slug}`} className="card card-hover flex items-center gap-3 p-3"><Headshot boxer={champ} size={48} /><div><div className="text-[11px] uppercase tracking-widest text-gold">{t(division)}</div><div className="font-display text-xl font-bold leading-tight">{t.name(champ.name)}</div><div className="text-xs text-muted">{t("won {date}", { date: fmtDate(b.date, { month: "short", year: "numeric" }, t.locale) })}</div></div></Link>;
          })}</div>
        </section>
        <section>
          <SectionTitle title={t("Recent title fights")} />
          <div className="card divide-y divide-line/60">{title.slice(0, 15).map((b) => (
            <Link key={b.id} href={`/bouts/${b.id}`} className="flex items-center gap-3 p-3 text-sm transition hover:bg-panel2/50"><span className="w-24 text-muted tabular">{fmtDate(b.date, { month: "short", year: "numeric" }, t.locale)}</span><span className="flex-1"><b>{b.winnerId ? t.name(w.byId.get(b.winnerId)?.name ?? "") : t("Draw")}</b> <span className="text-muted">{b.titleVacant ? t("{title} (vacant) · {division}", { title: b.title ? t.name(b.title) : "", division: t(b.weightClass) }) : t("{title} · {division}", { title: b.title ? t.name(b.title) : "", division: t(b.weightClass) })}</span></span><span className="text-xs text-muted">{t("{red} vs {blue}", { red: t.name(b.redName), blue: t.name(b.blueName) })}</span></Link>
          ))}</div>
        </section>
      </div>
    );
  }

  const stable = orgStable(w, o.id, o.kind === "gym" ? ["gym"] : ["promoter"]);
  const events = o.kind === "promotion" ? w.events.filter((e) => e.promoterOrgId === o.id).sort((a, b) => b.date.localeCompare(a.date)) : [];
  const current = stable.tenures.filter((x) => x.current);
  return (
    <div className="space-y-10">
      <JsonLd data={{ "@type": "Organization", name: t.name(o.name), url: abs(localePath(t.locale, `/orgs/${o.slug}`)), inLanguage: t.locale, ...(o.city || o.country ? { address: { "@type": "PostalAddress", ...(o.city ? { addressLocality: t.name(o.city) } : {}), ...(o.country ? { addressCountry: o.country } : {}) } } : {}) }} />
      <div><div className="eyebrow mb-2">{t(KIND[o.kind])}</div><h1 className="font-display text-5xl font-extrabold uppercase leading-none">{t.name(o.name)}</h1>{(o.city || o.country) && <p className="mt-2 text-muted">{o.country && flag(o.country)} {o.city && o.country ? t("{city}, {country}", { city: t.name(o.city), country: countryName(o.country, t.locale) }) : o.city ? t.name(o.city) : countryName(o.country!, t.locale)}</p>}</div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={o.kind === "gym" ? t("Training now") : t("Signed now")} value={stable.currentFighters} sub={t("{n} fighters ever", { n: stable.fighters })} />
        <Stat label={t("Combined record")} value={`${stable.record.wins}-${stable.record.losses}-${stable.record.draws}`} sub={t("{n}% wins", { n: Math.round(stable.record.winRate * 100) })} />
        <Stat label={t("Title wins")} value={stable.titleWins} />
        {o.kind === "promotion" && <Stat label={t("Events")} value={events.filter((e) => !e.upcoming).length} sub={t("{n} upcoming", { n: events.filter((e) => e.upcoming).length })} />}
      </div>
      {current.length > 0 && (
        <section>
          <SectionTitle title={t("Current roster")} />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{current.sort((a, b) => b.boxer.rating - a.boxer.rating).slice(0, 12).map((x) => (
            <Link key={x.stint.id} href={`/boxers/${x.boxer.slug}`} className="card card-hover flex items-center gap-3 p-3"><Headshot boxer={x.boxer} size={44} /><div className="min-w-0"><div className="truncate font-display text-lg font-bold">{t.name(x.boxer.name)}</div><div className="text-xs text-muted">{t(x.boxer.weightClass)} · {x.boxer.wins}-{x.boxer.losses}-{x.boxer.draws}</div></div></Link>
          ))}</div>
        </section>
      )}
      <section><SectionTitle title={t("All fighters")} /><div className="card p-5"><TenureTable tenures={stable.tenures} limit={50} /></div></section>
      {events.length > 0 && (
        <section><SectionTitle title={t("Events promoted")} /><div className="card divide-y divide-line/60">{events.slice(0, 12).map((e) => <Link key={e.id} href={`/events/${e.id}`} className="flex items-center justify-between p-3 text-sm hover:bg-panel2/50"><span><b>{t.name(e.name)}</b> <span className="text-muted">{t.name(e.city)}</span></span><span className="text-muted tabular">{fmtDate(e.date, undefined, t.locale)}</span></Link>)}</div></section>
      )}
    </div>
  );
}
