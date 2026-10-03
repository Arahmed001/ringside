import type { Metadata } from "next";
import Link from "next/link";
import { getWorld } from "@/lib/world";
import { orgStable } from "@/lib/team";
import { SectionTitle } from "@/components/ui";
import { flag } from "@/lib/format";
import type { Org } from "@/lib/types";

export const metadata: Metadata = { title: "Gyms, promotions & bodies" };

export default async function Orgs() {
  const w = await getWorld();
  const group = (kind: Org["kind"]) => [...w.orgs.values()].filter((o) => o.kind === kind);
  const gyms = group("gym").map((o) => ({ o, s: orgStable(w, o.id, ["gym"]) })).sort((a, b) => b.s.currentFighters - a.s.currentFighters);
  const promos = group("promotion").map((o) => ({ o, s: orgStable(w, o.id, ["promoter"]), events: w.events.filter((e) => e.promoterOrgId === o.id && !e.upcoming).length })).sort((a, b) => b.events - a.events);
  const bodies = group("sanctioning_body");
  return (
    <div className="space-y-12">
      <div><div className="eyebrow mb-2">Where fighters train, sign and win belts</div><h1 className="font-display text-5xl font-extrabold uppercase">Gyms, promotions &amp; bodies</h1></div>
      <section>
        <SectionTitle eyebrow="Sanctioning bodies" title="Belts" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{bodies.map((o) => <Link key={o.id} href={`/orgs/${o.slug}`} className="card card-hover p-4"><div className="font-display text-xl font-bold">{o.name}</div></Link>)}</div>
      </section>
      <section>
        <SectionTitle eyebrow="By events promoted" title="Promotions" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{promos.map(({ o, s, events }) => (
          <Link key={o.id} href={`/orgs/${o.slug}`} className="card card-hover p-4"><div className="font-display text-xl font-bold">{o.name}</div><div className="text-xs text-muted">{o.country && flag(o.country)} {events} events · {s.currentFighters} fighters signed · {s.record.wins}-{s.record.losses} combined</div></Link>
        ))}</div>
      </section>
      <section>
        <SectionTitle eyebrow="By current fighters" title="Gyms" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{gyms.slice(0, 36).map(({ o, s }) => (
          <Link key={o.id} href={`/orgs/${o.slug}`} className="card card-hover p-4"><div className="font-display text-xl font-bold">{o.name}</div><div className="text-xs text-muted">{o.country && flag(o.country)} {o.city} · {s.currentFighters} training now · {s.fighters} ever · {Math.round(s.record.winRate * 100)}% wins</div></Link>
        ))}</div>
      </section>
    </div>
  );
}
