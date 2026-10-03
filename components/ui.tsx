import Link from "@/components/L";
import type { BoxerFull, BoutRow } from "@/lib/types";
import { Headshot } from "./Portrait";
import { archetype, ARCH_COLOR } from "@/lib/style";
import { countryName, flag, fmtDate, methodLabel } from "@/lib/format";
import { divisionLabel } from "@/lib/divisions";
import { recordStr } from "@/lib/world";
import { getT } from "@/lib/i18n/server";
import { msg } from "@/lib/i18n/t";

const RES = { W: msg("W"), L: msg("L"), D: msg("D"), NC: msg("NC") };

export async function SectionTitle({ eyebrow, title, href, cta }: { eyebrow?: string; title: string; href?: string; cta?: string }) {
  const t = await getT();
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div>
        {eyebrow && <div className="eyebrow mb-1">{eyebrow}</div>}
        <h2 className="font-display text-3xl font-bold uppercase leading-none">{title}</h2>
      </div>
      {href && <Link href={href} className="inline-block py-1 text-sm text-muted transition hover:text-ink">{cta ?? t("View all")} <span className="inline-block rtl:rotate-180">→</span></Link>}
    </div>
  );
}

export async function ArchBadge({ b }: { b: BoxerFull }) {
  const t = await getT();
  const a = archetype(b);
  return <span className="chip" style={{ borderColor: ARCH_COLOR[a] + "55", color: ARCH_COLOR[a] }}>{t(a)}</span>;
}

export async function Streak({ b }: { b: BoxerFull }) {
  if (b.streak.type === "-") return null;
  const t = await getT();
  const c = b.streak.type === "W" ? "text-win" : b.streak.type === "L" ? "text-red-ink" : "text-muted";
  return <span className={`tabular text-xs font-semibold ${c}`}>{t(RES[b.streak.type])}{b.streak.count}</span>;
}

export async function BoxerCard({ b, rank, badge }: { b: BoxerFull; rank?: number; /** A chip beside the name (the name gives way to it); not laid over the card, which covered the name. */ badge?: string }) {
  const t = await getT();
  return (
    <Link href={`/boxers/${b.slug}`} className="card card-hover group flex gap-3 p-3">
      <Headshot boxer={b} size={64} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="truncate font-display text-xl font-bold leading-tight">{rank ? <span className="me-1.5 text-gold">{rank}</span> : null}{t.name(b.name)}</div>
          {badge && <span className="chip shrink-0 whitespace-nowrap !border-gold/40 !text-gold">{badge}</span>}
        </div>
        <div className="truncate text-xs text-muted">{flag(b.country)} {countryName(b.country, t.locale)} · {divisionLabel(b.weightClass, b.sex, t)}</div>
        <div className="mt-1.5 flex items-center gap-2">
          <span className="tabular text-sm font-semibold">{recordStr(b)}</span>
          <span className="tabular text-xs text-muted">{t("{n} KO", { n: b.kos })}</span>
          <Streak b={b} />
          <span className="ms-auto tabular text-xs text-gold">{Math.round(b.rating)}</span>
        </div>
      </div>
    </Link>
  );
}

export async function ResultPill({ r }: { r: "W" | "L" | "D" | "NC" }) {
  const t = await getT();
  const c = r === "W" ? "bg-win/15 text-win" : r === "L" ? "bg-red/15 text-red-ink" : "bg-white/10 text-muted";
  return <span className={`grid h-6 min-w-6 place-items-center rounded-md px-1 text-xs font-bold ${c}`}>{t(RES[r])}</span>;
}

export async function BoutLine({ bout, focusId }: { bout: BoutRow; focusId?: number }) {
  const t = await getT();
  const opp = focusId === bout.redId ? { n: bout.blueName, s: bout.blueSlug } : { n: bout.redName, s: bout.redSlug };
  const r = bout.method === "NC" ? "NC" : bout.winnerId === null ? "D" : bout.winnerId === focusId ? "W" : "L";
  return (
    <tr className="border-t border-line/60 text-sm">
      <td className="py-2.5 pe-3 tabular text-muted">{fmtDate(bout.date, { month: "short", year: "numeric", day: "numeric" }, t.locale)}</td>
      <td className="pe-3">{bout.method ? <Link href={`/bouts/${bout.id}`} title={t("Full bout details")}><ResultPill r={r} /></Link> : <Link href={`/bouts/${bout.id}`} className={`chip ${bout.status === "cancelled" ? "!border-red/40 !text-red-ink" : ""}`}>{bout.status === "cancelled" ? t("Cancelled") : t("TBA")}</Link>}</td>
      <td className="pe-3"><Link href={`/boxers/${opp.s}`} className="hover:text-gold">{t.name(opp.n)}</Link></td>
      <td className="pe-3 tabular text-muted">{methodLabel(bout.method, bout.endRound, t)}</td>
      <td className="hidden pe-3 text-muted sm:table-cell"><Link href={`/events/${bout.eventId}`} className="hover:text-ink">{t.name(bout.eventName)}</Link></td>
      <td className="hidden text-end text-xs text-gold md:table-cell">{bout.title ? t.name(bout.title) : ""}</td>
    </tr>
  );
}

export function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs uppercase tracking-widest text-muted">{label}</div>
      <div className="font-display text-4xl font-bold leading-tight tabular">{value}</div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </div>
  );
}

export async function Delta({ d }: { d: number | null }) {
  const t = await getT();
  if (d === null) return <span className="chip !border-gold/40 !text-gold">{t("NEW")}</span>;
  if (d === 0) return <span className="text-muted">–</span>;
  return <span className={`tabular text-xs font-semibold ${d > 0 ? "text-win" : "text-red-ink"}`}>{d > 0 ? "▲" : "▼"}{Math.abs(d)}</span>;
}

/** Previous / next links for a paged list. `href(n)` builds the link to page n, so each page keeps the rest of its filters. */
export async function Pager({ page, pages, href }: { page: number; pages: number; href: (n: number) => string }) {
  const t = await getT();
  if (pages <= 1) return null;
  return (
    <nav aria-label={t("Pages")} className="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm">
      {page > 1 ? <Link href={href(page - 1)} rel="prev" className="chip hover:text-ink"><span className="inline-block rtl:rotate-180">←</span> {t("Previous page")}</Link> : <span />}
      <span className="text-muted tabular">{t("Page {page} of {pages}", { page, pages })}</span>
      {page < pages ? <Link href={href(page + 1)} rel="next" className="chip hover:text-ink">{t("Next page")} <span className="inline-block rtl:rotate-180">→</span></Link> : <span />}
    </nav>
  );
}
