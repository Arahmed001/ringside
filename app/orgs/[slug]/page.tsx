import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getWorld } from "@/lib/world";
import { orgStable } from "@/lib/team";
import { TenureTable } from "@/components/TenureTable";
import { Headshot } from "@/components/Portrait";
import { SectionTitle, Stat } from "@/components/ui";
import { flag, fmtDate } from "@/lib/format";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const o = (await getWorld()).orgsBySlug.get((await params).slug);
  return { title: o ? o.name : "Organisation" };
}

const KIND: Record<string, string> = { gym: "Gym", promotion: "Promotion", sanctioning_body: "Sanctioning body", broadcaster: "Broadcaster" };

export default async function OrgPage({ params }: { params: Promise<{ slug: string }> }) {
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
        <div><div className="eyebrow mb-2">{KIND[o.kind]}</div><h1 className="font-display text-5xl font-extrabold uppercase leading-none">{o.name}</h1><p className="mt-2 text-muted">{title.length} title bouts on record</p></div>
        <section>
          <SectionTitle eyebrow="Winner of the most recent title fight" title="Current titleholders" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[...latest.entries()].map(([division, b]) => {
            const champ = w.byId.get(b.winnerId!)!;
            return <Link key={division} href={`/boxers/${champ.slug}`} className="card card-hover flex items-center gap-3 p-3"><Headshot boxer={champ} size={48} /><div><div className="text-[11px] uppercase tracking-widest text-gold">{division}</div><div className="font-display text-xl font-bold leading-tight">{champ.name}</div><div className="text-xs text-muted">won {fmtDate(b.date, { month: "short", year: "numeric" })}</div></div></Link>;
          })}</div>
        </section>
        <section>
          <SectionTitle title="Recent title fights" />
          <div className="card divide-y divide-line/60">{title.slice(0, 15).map((b) => (
            <Link key={b.id} href={`/bouts/${b.id}`} className="flex items-center gap-3 p-3 text-sm transition hover:bg-panel2/50"><span className="w-24 text-muted tabular">{fmtDate(b.date, { month: "short", year: "numeric" })}</span><span className="flex-1"><b>{b.winnerId ? w.byId.get(b.winnerId)?.name : "Draw"}</b> <span className="text-muted">{b.title}{b.titleVacant ? " (vacant)" : ""} · {b.weightClass}</span></span><span className="text-xs text-muted">{b.redName} vs {b.blueName}</span></Link>
          ))}</div>
        </section>
      </div>
    );
  }

  const stable = orgStable(w, o.id, o.kind === "gym" ? ["gym"] : ["promoter"]);
  const events = o.kind === "promotion" ? w.events.filter((e) => e.promoterOrgId === o.id).sort((a, b) => b.date.localeCompare(a.date)) : [];
  const current = stable.tenures.filter((t) => t.current);
  return (
    <div className="space-y-10">
      <div><div className="eyebrow mb-2">{KIND[o.kind]}</div><h1 className="font-display text-5xl font-extrabold uppercase leading-none">{o.name}</h1>{(o.city || o.country) && <p className="mt-2 text-muted">{o.country && flag(o.country)} {[o.city, o.country].filter(Boolean).join(", ")}</p>}</div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={o.kind === "gym" ? "Training now" : "Signed now"} value={stable.currentFighters} sub={`${stable.fighters} fighters ever`} />
        <Stat label="Combined record" value={`${stable.record.wins}-${stable.record.losses}-${stable.record.draws}`} sub={`${Math.round(stable.record.winRate * 100)}% wins`} />
        <Stat label="Title wins" value={stable.titleWins} />
        {o.kind === "promotion" && <Stat label="Events" value={events.filter((e) => !e.upcoming).length} sub={`${events.filter((e) => e.upcoming).length} upcoming`} />}
      </div>
      {current.length > 0 && (
        <section>
          <SectionTitle title="Current roster" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{current.sort((a, b) => b.boxer.rating - a.boxer.rating).slice(0, 12).map((t) => (
            <Link key={t.stint.id} href={`/boxers/${t.boxer.slug}`} className="card card-hover flex items-center gap-3 p-3"><Headshot boxer={t.boxer} size={44} /><div className="min-w-0"><div className="truncate font-display text-lg font-bold">{t.boxer.name}</div><div className="text-xs text-muted">{t.boxer.weightClass} · {t.boxer.wins}-{t.boxer.losses}-{t.boxer.draws}</div></div></Link>
          ))}</div>
        </section>
      )}
      <section><SectionTitle title="All fighters" /><div className="card p-5"><TenureTable tenures={stable.tenures} limit={50} /></div></section>
      {events.length > 0 && (
        <section><SectionTitle title="Events promoted" /><div className="card divide-y divide-line/60">{events.slice(0, 12).map((e) => <Link key={e.id} href={`/events/${e.id}`} className="flex items-center justify-between p-3 text-sm hover:bg-panel2/50"><span><b>{e.name}</b> <span className="text-muted">{e.city}</span></span><span className="text-muted tabular">{fmtDate(e.date)}</span></Link>)}</div></section>
      )}
    </div>
  );
}
