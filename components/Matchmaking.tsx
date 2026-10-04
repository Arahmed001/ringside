import Link from "@/components/L";
import { getT } from "@/lib/i18n/server";
import { Headshot } from "@/components/Portrait";
import { ProbBar } from "@/components/charts";
import { divisionLabel } from "@/lib/divisions";
import { recordStr } from "@/lib/world";
import type { Pairing } from "@/lib/matchmaking";

/** A possible fight: both fighters (red left, blue right), the model's odds, the fight score and the reasons behind it. */
export async function PairingCard({ p, rank, division }: { p: Pairing; rank?: number; division?: string }) {
  const t = await getT();
  const { a, b } = p;
  return (
    <article className="card min-w-0 p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0 text-xs uppercase tracking-widest text-muted">{rank ? <span className="me-2 font-display text-lg font-bold text-gold">{rank}</span> : null}{division ? t(division) : divisionLabel(a.weightClass, a.sex, t)}</div>
        <div className="shrink-0 text-center" title={t("Fight score out of 100: how close, relevant, entertaining, bookable, fresh and meaningful the fight is")}>
          <div className="font-display text-3xl font-extrabold leading-none text-gold tabular">{p.score}</div>
          <div className="text-xs uppercase tracking-widest text-muted">{t("fight score")}</div>
        </div>
      </div>
      <div className="ltr-fixed grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
        {[a, b].map((f, i) => (
          <Link key={f.id} href={`/boxers/${f.slug}`} className={`flex min-w-0 flex-col items-center gap-1 text-center ${i === 1 ? "order-3" : ""}`}>
            <Headshot boxer={f} size={64} />
            <div className="w-full text-balance break-words font-display text-lg font-bold leading-tight" dir="auto">{t.name(f.name)}</div>
            <div className="text-xs text-muted"><span className="tabular">{recordStr(f)}</span> · Elo {Math.round(f.rating)}</div>
          </Link>
        ))}
        <div className="order-2 font-display text-xl font-extrabold text-gold">{t("VS")}</div>
      </div>
      <div className="mt-4"><ProbBar a={t.name(a.name)} b={t.name(b.name)} pA={p.pA} pB={p.pB} pDraw={p.pDraw} /></div>
      <ul className="mt-3 flex flex-wrap gap-1.5 text-xs">
        {p.reasons.slice(0, 4).map((r) => <li key={r} className="chip">{r}</li>)}
      </ul>
      <div className="mt-4 flex flex-wrap gap-4 text-sm">
        <Link href={`/compare?a=${a.slug}&b=${b.slug}`} className="inline-block py-1 text-ink hover:text-gold">{t("Full matchup breakdown")} <span className="inline-block rtl:rotate-180">→</span></Link>
        <Link href={`/matchmaking?x=${a.slug}&y=${b.slug}#dream`} className="text-muted hover:text-ink">{t("Open in the dream-fight builder")}</Link>
      </div>
    </article>
  );
}
