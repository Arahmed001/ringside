import Link from "@/components/L";
import { ProbBar } from "@/components/charts";
import { TIER_LABEL, type Watch } from "@/lib/upsets";
import { divisionLabel } from "@/lib/divisions";
import { fmtDate } from "@/lib/format";
import { getT } from "@/lib/i18n/server";
import { recordStr } from "@/lib/world";

/** One upcoming fight with its underdog: the chance, the bar, and the reasons the underdog could win. */
export async function WatchCard({ x }: { x: Watch }) {
  const t = await getT();
  const { bout: b, underdog: u, favourite: f } = x;
  const red = u.id === b.redId ? u : f, blue = u.id === b.redId ? f : u;
  return (
    <article className="card min-w-0 p-4" aria-labelledby={`w-${b.id}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span>{fmtDate(x.event.date, { month: "short", day: "numeric" }, t.locale)} · <Link href={`/events/${x.event.id}`} className="hover:text-ink">{t.name(x.event.name)}</Link> · {divisionLabel(b.weightClass, red.sex, t)}</span>
        <span className={`chip whitespace-nowrap ${x.tier === "live" ? "!border-gold/50 !text-gold" : ""}`}>{t(TIER_LABEL[x.tier])}</span>
      </div>
      <h3 id={`w-${b.id}`} className="font-display text-2xl font-bold leading-tight">
        <Link href={`/boxers/${u.slug}`} className="hover:text-gold">{t.name(u.name)}</Link>
        <span className="text-muted"> {t("vs")} </span>
        <Link href={`/boxers/${f.slug}`} className="text-ink/80 hover:text-gold">{t.name(f.name)}</Link>
      </h3>
      <p className="mt-1 text-sm text-muted">{t("{name} ({record}) is the underdog: a {pct}% chance to win", { name: t.name(u.name), record: recordStr(u), pct: Math.round(x.chance * 100) })}</p>
      <div className="mt-3"><ProbBar a={t.name(red.name)} b={t.name(blue.name)} pA={x.pRed} pB={x.pBlue} pDraw={x.pDraw} /></div>
      {x.signals.length > 0 ? (
        <ul className="mt-3 space-y-1.5 text-sm">{x.signals.map((s) => <li key={`${s.kind}-${s.text}`} className="flex gap-2"><span className="text-gold" aria-hidden>●</span><span>{s.text}</span></li>)}</ul>
      ) : <p className="mt-3 text-sm text-muted">{t("Nothing beyond the ratings: the model sees no extra reason for an upset.")}</p>}
      <p className="mt-3 flex flex-wrap gap-3 text-sm"><Link href={`/previews/${b.id}`} className="inline-block py-1 text-muted hover:text-gold">{t("Read the preview")} <span className="inline-block rtl:rotate-180" aria-hidden>→</span></Link></p>
    </article>
  );
}
