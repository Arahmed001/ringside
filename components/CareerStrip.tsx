import { getT } from "@/lib/i18n/server";
import type { CareerStrip as Strip } from "@/lib/career-strip";
import { stripLabels } from "@/lib/career-strip";

/** The fights held, year by year, on a strip that runs left to right like the belt timelines: gold for years with fights (taller for more), a dotted outline for the years before the first fight held. */
export async function CareerStrip({ strip }: { strip: Strip }) {
  const t = await getT();
  const peak = Math.max(1, ...strip.years.map((y) => y.held)), labels = new Set(stripLabels(strip.years.map((y) => y.year)));
  const sentence = strip.fromYear === strip.toYear || strip.firstHeldYear === strip.toYear
    ? t("{held} of the {total} fights in this record are held, all in {year}.", { held: strip.held, total: strip.total, year: strip.toYear })
    : t("{held} of the {total} fights in this record are held, from {from} to {to}.", { held: strip.held, total: strip.total, from: strip.firstHeldYear, to: strip.toYear });
  const before = strip.debutYear !== null ? t("Nothing is held before {year}; the career began in {debut}.", { year: strip.firstHeldYear, debut: strip.debutYear }) : null;
  return (
    <div className="mt-4 max-w-2xl" data-career-strip>
      <div className="eyebrow mb-1.5">{t("Fights held by year")}</div>
      <div className="ltr-fixed" dir="ltr" role="img" aria-label={[sentence, before].filter(Boolean).join(" ")}>
        <div className="flex h-12 items-end gap-[3px]" aria-hidden="true">
          {strip.years.map((y) => (
            <div key={y.year} title={`${y.year}: ${y.held}`} className="flex h-full min-w-[5px] max-w-7 flex-1 items-end">
              {y.missing ? <div className="h-full w-full rounded-sm border border-dashed border-line/80" />
                : y.held ? <div className="w-full rounded-sm bg-gold" style={{ height: `${Math.max(14, (y.held / peak) * 100)}%` }} />
                : <div className="h-[3px] w-full rounded-sm bg-line" />}
            </div>
          ))}
        </div>
        <div className="mt-1 flex gap-[3px] text-xs leading-none text-muted" aria-hidden="true">
          {strip.years.map((y) => <div key={y.year} className="relative h-4 min-w-[5px] max-w-7 flex-1"><span className="absolute start-1/2 -translate-x-1/2 whitespace-nowrap">{labels.has(y.year) ? y.year : ""}</span></div>)}
        </div>
      </div>
      <p className="mt-1.5 text-xs leading-snug text-muted">{sentence}{before ? ` ${before}` : ""}</p>
    </div>
  );
}
