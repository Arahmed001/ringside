import Link from "@/components/L";
import type { BoxerFull, BoutRow, EventRow } from "@/lib/types";
import { Headshot } from "./Portrait";
import { FightRow } from "./FightRow";
import { CountUp } from "./CountUp";
import { archetype, ARCH_COLOR } from "@/lib/style";
import { countryName, flag, fmtDate, methodLabel } from "@/lib/format";
import { divisionLabel } from "@/lib/divisions";
import { koView, recordStr } from "@/lib/world";
import { getT } from "@/lib/i18n/server";
import { msg } from "@/lib/i18n/t";

const RES = { W: msg("W"), L: msg("L"), D: msg("D"), NC: msg("NC") };

export async function SectionTitle({ eyebrow, title, href, cta }: { eyebrow?: string; title: string; href?: string; cta?: string }) {
  const t = await getT();
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow mb-1">{eyebrow}</div>}
        <h2 className="font-display text-3xl font-bold uppercase leading-none">{title}</h2>
      </div>
      {/* a short link ("View all", "Full card") stays on one line and the title wraps instead; a long one may wrap */}
      {href && <Link href={href} className={`inline-block py-1 text-sm text-muted transition hover:text-ink ${(cta ?? t("View all")).length <= 18 ? "shrink-0 whitespace-nowrap" : ""}`}>{cta ?? t("View all")} <span className="inline-block rtl:rotate-180">→</span></Link>}
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

export async function BoxerCard({ b, rank, badge, featured }: { b: BoxerFull; rank?: number; /** a larger card for a podium place: bigger portrait, name and rank */ featured?: boolean; /** A chip beside the name (the name gives way to it); not laid over the card, which covered the name. */ badge?: string }) {
  const t = await getT();
  return (
    <Link href={`/boxers/${b.slug}`} className={`card card-hover group flex ${featured ? "gap-4 p-4" : "gap-3 p-3"}`}>
      <Headshot boxer={b} size={featured ? 88 : 64} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className={`min-w-0 break-words font-display font-bold leading-tight ${featured ? "text-2xl" : "text-xl"}`}>{rank ? <span className={`me-1.5 text-gold ${featured ? "text-3xl" : ""}`}>{rank}</span> : null}{t.name(b.name)}</div>
          {badge && <span className="chip shrink-0 whitespace-nowrap !border-gold/40 !text-gold">{badge}</span>}
        </div>
        <div className="text-xs text-muted">{flag(b.country)} {countryName(b.country, t.locale)} · {divisionLabel(b.weightClass, b.sex, t)}</div>
        <div className="mt-1.5 flex items-center gap-2">
          <span className="tabular text-sm font-semibold">{recordStr(b)}</span>
          <span className="tabular text-xs text-muted">{t("{n} KO", { n: koView(b).kos })}</span>
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

export async function BoutLine({ bout, focusId, context, event }: { bout: BoutRow; focusId?: number; /** a line under the opponent: what they were going into this fight */ context?: React.ReactNode; /** the card the fight was on, for the details that open under the line */ event?: Pick<EventRow, "venue" | "city" | "country"> }) {
  const t = await getT();
  const opp = focusId === bout.redId ? { n: bout.blueName, s: bout.blueSlug } : { n: bout.redName, s: bout.redSlug };
  const r = bout.method === "NC" ? "NC" : bout.winnerId === null ? "D" : bout.winnerId === focusId ? "W" : "L";
  const mine = focusId === bout.redId ? bout.kdRed : bout.kdBlue, theirs = focusId === bout.redId ? bout.kdBlue : bout.kdRed;
  const facts: [string, React.ReactNode][] = [
    [t("Event"), <Link key="e" href={`/events/${bout.eventId}`} className="hover:text-ink">{t.name(bout.eventName)}</Link>],
    ...(event?.venue ? [[t("Venue"), [t.name(event.venue), event.city ? t.name(event.city) : null, event.country ? countryName(event.country, t.locale) : null].filter(Boolean).join(t.locale === "ar" ? "، " : ", ")] as [string, React.ReactNode]] : []),
    ...(bout.title ? [[t("Title"), t.name(bout.title)] as [string, React.ReactNode]] : []),
    ...(bout.rounds > 0 ? [[t("Scheduled distance"), t.n(bout.rounds, "{n} round", "{n} rounds")] as [string, React.ReactNode]] : []),
    ...(bout.method && bout.endRound ? [[t("Ended"), bout.roundTime ? t("Round {r}, {time}", { r: bout.endRound, time: bout.roundTime }) : t("Round {r}", { r: bout.endRound })] as [string, React.ReactNode]] : []),
    ...(bout.method && (mine || theirs) ? [[t("Knockdowns"), t("{a} scored · {b} suffered", { a: mine, b: theirs })] as [string, React.ReactNode]] : []),
  ];
  return (
    <FightRow
      label={t("Details of the fight against {name}", { name: t.name(opp.n) })}
      columns={7}
      cells={<>
        <td className="py-2.5 pe-3 tabular text-muted max-sm:w-[4.5rem] sm:whitespace-nowrap">{fmtDate(bout.date, { month: "short", year: "numeric", day: "numeric" }, t.locale)}</td>
        <td className="pe-3">{bout.method ? <Link href={`/bouts/${bout.id}`} title={t("Full bout details")}><ResultPill r={r} /></Link> : <Link href={`/bouts/${bout.id}`} className={`chip ${bout.status === "cancelled" ? "!border-red/40 !text-red-ink" : ""}`}>{bout.status === "cancelled" ? t("Cancelled") : t("TBA")}</Link>}</td>
        <td className="pe-3"><Link href={`/boxers/${opp.s}`} className="hover:text-gold">{t.name(opp.n)}</Link>{context && <div className="tabular text-xs text-muted">{context}</div>}<div className="text-xs text-muted sm:hidden">{t.name(bout.eventName)}{bout.title ? ` · ${t.name(bout.title)}` : ""}</div></td>
        <td className="whitespace-nowrap pe-3 tabular text-muted">{methodLabel(bout.method, bout.endRound, t)}</td>
        <td className="hidden pe-3 text-muted sm:table-cell"><Link href={`/events/${bout.eventId}`} className="hover:text-ink">{t.name(bout.eventName)}</Link></td>
        <td className="hidden pe-3 text-end text-xs text-gold md:table-cell">{bout.title ? t.name(bout.title) : ""}</td>
      </>}
      details={
        <div className="rounded-lg bg-panel2/60 p-3">
          <dl className="grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
            {facts.map(([k, v]) => <div key={k} className="flex justify-between gap-3"><dt className="text-muted">{k}</dt><dd className="text-end">{v}</dd></div>)}
          </dl>
          <Link href={`/bouts/${bout.id}`} className="mt-2 inline-block py-1 text-xs text-gold hover:text-ink">{t("Full bout details")} <span className="inline-block rtl:rotate-180">→</span></Link>
        </div>
      }
    />
  );
}

export function Stat({ label, value, sub, countUp }: { label: string; value: string | number; sub?: string; /** a whole-number figure that counts up once on load (components/CountUp.tsx) */ countUp?: boolean }) {
  return (
    <div className="card p-4">
      <div className="text-xs uppercase tracking-widest text-muted">{label}</div>
      {/* a long figure (a combined record, "660-575-59") is set smaller on phones and never broken at its hyphens; a value with spaces ("56% vs 40%") may wrap at them */}
      <div className={`${/\s/.test(String(value)) ? "text-balance" : "whitespace-nowrap"} font-display font-bold leading-tight tabular sm:text-4xl ${String(value).length >= 9 ? "text-2xl" : String(value).length >= 7 ? "text-3xl" : "text-4xl"}`}>{countUp && typeof value === "number" ? <CountUp value={value} /> : value}</div>
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
export async function Pager({ page, pages, href, label }: { page: number; pages: number; href: (n: number) => string; /** the name of this list of pages, when a page has more than one (two landmarks may not share a name) */ label?: string }) {
  const t = await getT();
  if (pages <= 1) return null;
  return (
    <nav aria-label={label ?? t("Pages")} className="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm">
      {page > 1 ? <Link href={href(page - 1)} rel="prev" className="chip hover:text-ink"><span className="inline-block rtl:rotate-180">←</span> {t("Previous page")}</Link> : <span />}
      <span className="text-muted tabular">{t("Page {page} of {pages}", { page, pages })}</span>
      {page < pages ? <Link href={href(page + 1)} rel="next" className="chip hover:text-ink">{t("Next page")} <span className="inline-block rtl:rotate-180">→</span></Link> : <span />}
    </nav>
  );
}
