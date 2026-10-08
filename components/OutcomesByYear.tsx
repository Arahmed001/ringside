import { getT } from "@/lib/i18n/server";
import type { YearOutcomes } from "@/lib/outcomes-by-year";
import { stripLabels } from "@/lib/career-strip";
import { msg } from "@/lib/i18n/t";

const SEGMENTS = [
  { key: "ko", label: msg("Won by stoppage"), cls: "bg-red" },
  { key: "decision", label: msg("Won on the scorecards"), cls: "bg-gold" },
  { key: "otherWin", label: msg("Won otherwise"), cls: "bg-muted" },
  { key: "draw", label: msg("Drew"), cls: "bg-muted/60" },
  { key: "loss", label: msg("Lost"), cls: "border border-red-ink/70" },
] as const;

/** How each year's fights ended, as stacked columns drawn in plain CSS: one column a year, one block a fight. The same figures are in the words under the chart for a reader who cannot see it. */
export async function OutcomesByYear({ years }: { years: YearOutcomes[] }) {
  const t = await getT();
  const peak = Math.max(1, ...years.map((y) => y.total)), labels = new Set(stripLabels(years.map((y) => y.year)));
  const summary = years.filter((y) => y.total).map((y) => `${y.year}: ${y.total}`).join(", ");
  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="text-xs uppercase tracking-widest text-muted">{t("How each year's fights ended")}</div>
        <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
          {SEGMENTS.map((s) => <li key={s.key} className="flex items-center gap-1.5"><span className={`h-2.5 w-2.5 rounded-sm ${s.cls}`} aria-hidden />{t(s.label)}</li>)}
        </ul>
      </div>
      <div className="ltr-fixed mt-3" dir="ltr" role="img" aria-label={t("Fights by year: {list}", { list: summary })}>
        <div className="flex h-28 items-end gap-[3px]" aria-hidden="true">
          {years.map((y) => (
            <div key={y.year} title={`${y.year}: ${y.total}`} className="flex h-full min-w-[5px] max-w-8 flex-1 flex-col justify-end gap-[2px]">
              {y.total === 0 ? <div className="h-[3px] w-full rounded-sm bg-line/60" /> : [...SEGMENTS].reverse().map((s) => y[s.key] ? (
                <div key={s.key} className={`w-full rounded-sm ${s.cls}`} style={{ height: `${(y[s.key] / peak) * 100}%`, minHeight: 4 }} />
              ) : null)}
            </div>
          ))}
        </div>
        <div className="mt-1 flex gap-[3px] text-xs tabular text-muted" aria-hidden="true">
          {years.map((y) => <div key={y.year} className="relative h-4 min-w-[5px] max-w-8 flex-1">{labels.has(y.year) && <span className="absolute left-1/2 -translate-x-1/2">{y.year}</span>}</div>)}
        </div>
      </div>
    </div>
  );
}
