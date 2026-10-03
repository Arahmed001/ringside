import Link from "next/link";
import type { BoxerFull, BoutRow } from "@/lib/types";
import { Headshot } from "./Portrait";
import { archetype, ARCH_COLOR } from "@/lib/style";
import { flag, fmtDate, methodLabel } from "@/lib/format";
import { divisionLabel } from "@/lib/divisions";
import { recordStr } from "@/lib/world";

export function SectionTitle({ eyebrow, title, href, cta }: { eyebrow?: string; title: string; href?: string; cta?: string }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div>
        {eyebrow && <div className="eyebrow mb-1">{eyebrow}</div>}
        <h2 className="font-display text-3xl font-bold uppercase leading-none">{title}</h2>
      </div>
      {href && <Link href={href} className="text-sm text-muted transition hover:text-ink">{cta ?? "View all"} →</Link>}
    </div>
  );
}

export function ArchBadge({ b }: { b: BoxerFull }) {
  const a = archetype(b);
  return <span className="chip" style={{ borderColor: ARCH_COLOR[a] + "55", color: ARCH_COLOR[a] }}>{a}</span>;
}

export function Streak({ b }: { b: BoxerFull }) {
  if (b.streak.type === "-") return null;
  const c = b.streak.type === "W" ? "text-win" : b.streak.type === "L" ? "text-red" : "text-muted";
  return <span className={`tabular text-xs font-semibold ${c}`}>{b.streak.type}{b.streak.count}</span>;
}

export function BoxerCard({ b, rank }: { b: BoxerFull; rank?: number }) {
  return (
    <Link href={`/boxers/${b.slug}`} className="card card-hover group flex gap-3 p-3">
      <Headshot boxer={b} size={64} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="truncate font-display text-xl font-bold leading-tight">{rank ? <span className="mr-1.5 text-gold">{rank}</span> : null}{b.name}</div>
        </div>
        <div className="truncate text-xs text-muted">{flag(b.country)} {b.country} · {divisionLabel(b.weightClass, b.sex)}</div>
        <div className="mt-1.5 flex items-center gap-2">
          <span className="tabular text-sm font-semibold">{recordStr(b)}</span>
          <span className="tabular text-xs text-muted">{b.kos} KO</span>
          <Streak b={b} />
          <span className="ml-auto tabular text-xs text-gold">{Math.round(b.rating)}</span>
        </div>
      </div>
    </Link>
  );
}

export function ResultPill({ r }: { r: "W" | "L" | "D" | "NC" }) {
  const c = r === "W" ? "bg-win/15 text-win" : r === "L" ? "bg-red/15 text-red" : "bg-white/10 text-muted";
  return <span className={`grid h-6 min-w-6 place-items-center rounded-md px-1 text-xs font-bold ${c}`}>{r}</span>;
}

export function BoutLine({ bout, focusId }: { bout: BoutRow; focusId?: number }) {
  const opp = focusId === bout.redId ? { n: bout.blueName, s: bout.blueSlug } : { n: bout.redName, s: bout.redSlug };
  const r = bout.method === "NC" ? "NC" : bout.winnerId === null ? "D" : bout.winnerId === focusId ? "W" : "L";
  return (
    <tr className="border-t border-line/60 text-sm">
      <td className="py-2.5 pr-3 tabular text-muted">{fmtDate(bout.date, { month: "short", year: "numeric", day: "numeric" })}</td>
      <td className="pr-3">{bout.method ? <Link href={`/bouts/${bout.id}`} title="Full bout details"><ResultPill r={r} /></Link> : <Link href={`/bouts/${bout.id}`} className={`chip ${bout.status === "cancelled" ? "!border-red/40 !text-red" : ""}`}>{bout.status === "cancelled" ? "Cancelled" : "TBA"}</Link>}</td>
      <td className="pr-3"><Link href={`/boxers/${opp.s}`} className="hover:text-gold">{opp.n}</Link></td>
      <td className="pr-3 tabular text-muted">{methodLabel(bout.method, bout.endRound)}</td>
      <td className="hidden pr-3 text-muted sm:table-cell"><Link href={`/events/${bout.eventId}`} className="hover:text-ink">{bout.eventName}</Link></td>
      <td className="hidden text-right text-xs text-gold md:table-cell">{bout.title ?? ""}</td>
    </tr>
  );
}

export function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="card p-4">
      <div className="text-[11px] uppercase tracking-widest text-muted">{label}</div>
      <div className="font-display text-4xl font-bold leading-tight tabular">{value}</div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function Delta({ d }: { d: number | null }) {
  if (d === null) return <span className="chip !border-gold/40 !text-gold">NEW</span>;
  if (d === 0) return <span className="text-muted">–</span>;
  return <span className={`tabular text-xs font-semibold ${d > 0 ? "text-win" : "text-red"}`}>{d > 0 ? "▲" : "▼"}{Math.abs(d)}</span>;
}
