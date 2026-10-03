import type { Metadata } from "next";
import Link from "next/link";
import { getWorld } from "@/lib/world";
import { DIVISIONS, slugifyDivision, limitLabel } from "@/lib/divisions";
import { rankDivision, pound4pound } from "@/lib/rankings";
import { Headshot } from "@/components/Portrait";
import { BoxerCard, SectionTitle } from "@/components/ui";
import { recordStr } from "@/lib/world";

export const metadata: Metadata = { title: "Rankings" };

export default async function Rankings() {
  const w = await getWorld();
  const p4p = pound4pound(w, 10);
  return (
    <div className="space-y-12">
      <div>
        <div className="eyebrow mb-2">Updated after every fight</div>
        <h1 className="font-display text-5xl font-extrabold uppercase">Current rankings</h1>
        <p className="mt-2 max-w-2xl text-muted">Every division ranked by Elo-style rating. Active fighters with five or more bouts, a winning record and a fight in the last 24 months qualify. Arrows show movement over the last 90 days.</p>
      </div>
      <section>
        <SectionTitle eyebrow="Across all weights" title="Pound for pound" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{p4p.map((b, i) => <BoxerCard key={b.id} b={b} rank={i + 1} />)}</div>
      </section>
      <section>
        <SectionTitle eyebrow="17 divisions" title="By weight class" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {DIVISIONS.map((d) => {
            const top = rankDivision(w, d.name, 5);
            return (
              <Link key={d.name} href={`/rankings/${slugifyDivision(d.name)}`} className="card card-hover block p-4">
                <div className="mb-3 flex items-baseline justify-between"><div className="font-display text-2xl font-bold uppercase">{d.name}</div><div className="text-xs text-muted">{limitLabel(d)}</div></div>
                <ol className="space-y-2">
                  {top.map((r) => (
                    <li key={r.boxer.id} className="flex items-center gap-2.5 text-sm">
                      <span className={`w-5 text-center font-display text-lg font-bold ${r.rank === 1 ? "text-gold" : "text-muted"}`}>{r.rank === 1 ? "C" : r.rank}</span>
                      <Headshot boxer={r.boxer} size={26} rounded={false} className="rounded-full object-cover" />
                      <span className="min-w-0 flex-1 truncate">{r.boxer.name}</span>
                      <span className="tabular text-xs text-muted">{recordStr(r.boxer)}</span>
                    </li>
                  ))}
                  {!top.length && <li className="text-sm text-muted">Not enough qualifying fighters.</li>}
                </ol>
              </Link>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-muted">“C” marks the top-rated fighter in the division — not an official sanctioning-body champion.</p>
      </section>
    </div>
  );
}
