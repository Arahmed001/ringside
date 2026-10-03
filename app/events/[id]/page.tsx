import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getWorld, recordStr } from "@/lib/world";
import { eventWithMain } from "@/lib/events";
import { predict } from "@/lib/predict";
import { Poster } from "@/components/Poster";
import { Headshot } from "@/components/Portrait";
import { ProbBar } from "@/components/charts";
import { fmtDate, flag, methodLabel, daysUntil } from "@/lib/format";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const w = await getWorld();
  const e = w.events.find((x) => x.id === Number(id));
  return { title: e ? e.name : "Event" };
}

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const w = await getWorld();
  const e = w.events.find((x) => x.id === Number(id));
  if (!e) notFound();
  const { bouts, main, red, blue } = eventWithMain(w, e);
  return (
    <div className="grid gap-8 lg:grid-cols-[360px_1fr]">
      <div className="lg:sticky lg:top-24 lg:self-start"><Poster event={e} main={main} red={red} blue={blue} /></div>
      <div>
        <div className="eyebrow mb-2">{e.upcoming ? `In ${daysUntil(e.date)} days` : "Final results"}</div>
        <h1 className="font-display text-5xl font-extrabold uppercase leading-none">{e.name}</h1>
        <div className="mt-2 text-muted">{fmtDate(e.date, { weekday: "long", month: "long", day: "numeric", year: "numeric" })} · {e.venue}, {e.city} {flag(e.country)}</div>
        <div className="mt-8 space-y-3">
          {bouts.map((b, i) => {
            const r = w.byId.get(b.redId)!, u = w.byId.get(b.blueId)!;
            const p = predict(r, u);
            return (
              <div key={b.id} className="card p-4">
                <div className="mb-3 flex items-center justify-between text-xs text-muted">
                  <span className="uppercase tracking-widest">{i === 0 ? "Main event" : i === 1 ? "Co-main" : "Undercard"} · {b.weightClass} · {b.rounds} rds</span>
                  {b.title && <span className="chip !border-gold/40 !text-gold">{b.title}</span>}
                </div>
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                  {[r, u].map((f, k) => (
                    <Link key={f.id} href={`/boxers/${f.slug}`} className={`flex items-center gap-3 ${k === 1 ? "order-3 flex-row-reverse text-right" : ""}`}>
                      <Headshot boxer={f} size={52} />
                      <div className="min-w-0">
                        <div className={`font-display text-xl font-bold leading-tight ${b.winnerId === f.id ? "text-win" : ""}`}>{b.winnerId === f.id && "✓ "}{f.name}</div>
                        <div className="text-xs text-muted">{recordStr(f)} · {Math.round(f.rating)}</div>
                      </div>
                    </Link>
                  ))}
                  <Link href={`/bouts/${b.id}`} className="order-2 text-center transition hover:opacity-80" title="Full bout details"><div className="font-display text-xl font-bold text-gold">VS</div>{b.method && <div className="text-[11px] tabular text-muted">{methodLabel(b.method, b.endRound)}</div>}</Link>
                </div>
                {b.upcoming && <div className="mt-4"><ProbBar a={r.name} b={u.name} pA={p.pA} pB={p.pB} pDraw={p.pDraw} /></div>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
