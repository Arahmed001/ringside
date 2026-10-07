import Link from "@/components/L";
import { getT } from "@/lib/i18n/server";

export interface TimelineSegment {
  from: string | null; // ISO date; null = unknown start (drawn from the left edge)
  to: string | null; // null = current
  label: string;
  sub?: string;
  href?: string;
  current?: boolean;
}
export interface TimelineRow { label: string; color: string; segments: TimelineSegment[] }

const ms = (d: string) => Date.parse(d + "T12:00:00Z");

/** Horizontal career timeline: one lane per role, one block per tenure. Hover a block for the record. */
export async function TeamTimeline({ rows, today }: { rows: TimelineRow[]; today: string }) {
  const t = await getT();
  const all = rows.flatMap((r) => r.segments);
  if (!all.length) return null;
  const starts = all.map((s) => (s.from ? ms(s.from) : Infinity));
  const min = Math.min(...starts.filter((x) => x !== Infinity), ms(today));
  const max = Math.max(ms(today), ...all.map((s) => (s.to ? ms(s.to) : ms(today))));
  const span = Math.max(1, max - min);
  const pos = (d: string | null, fallback: number) => ((d ? ms(d) : fallback) - min) / span;
  const years: number[] = [];
  for (let y = new Date(min).getUTCFullYear() + 1; y <= new Date(max).getUTCFullYear(); y++) years.push(y);
  const step = years.length > 14 ? 3 : years.length > 7 ? 2 : 1;

  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={row.label} className="grid grid-cols-[86px_1fr] items-center gap-3 sm:grid-cols-[120px_1fr]">
          <div className="line-clamp-2 break-words text-xs uppercase leading-snug tracking-widest text-muted" title={row.label}>{row.label}</div>
          <div className="ltr-fixed relative h-10 rounded-lg bg-panel2/60">
            {row.segments.map((s, i) => {
              const left = pos(s.from, min) * 100, right = pos(s.to, ms(today)) * 100;
              const width = Math.max(1.5, right - left);
              const inner = (
                <div dir={t.locale === "ar" ? "rtl" : undefined} className="flex h-full flex-col justify-center overflow-hidden px-2 leading-tight">
                  <span className="truncate text-xs font-semibold">{s.label}</span>
                  {s.sub && <span className="truncate text-xs opacity-75">{s.sub}</span>}
                </div>
              );
              const style = { left: `${left}%`, width: `${width}%`, background: row.color + (s.current ? "55" : "30"), borderLeft: `3px solid ${row.color}` };
              const cls = "absolute inset-y-0 rounded-md transition hover:brightness-125";
              const title = `${s.label}${s.sub ? ` · ${s.sub}` : ""} · ${t("{from} → {to}", { from: s.from ?? "?", to: s.to ?? t("present") })}`;
              return s.href ? <Link key={i} href={s.href} title={title} className={cls} style={style}>{inner}</Link> : <div key={i} title={title} className={cls} style={style}>{inner}</div>;
            })}
          </div>
        </div>
      ))}
      <div className="grid grid-cols-[86px_1fr] gap-3 sm:grid-cols-[120px_1fr]">
        <span />
        <div className="ltr-fixed relative h-4 text-xs text-muted">
          {years.filter((_, i) => i % step === 0).map((y, j) => (
            // on a phone the strip is under 200 px wide, so every other year is dropped (seven labels of 28 px do not fit; four do)
            <span key={y} className={`absolute -translate-x-1/2 ${j % 2 ? "hidden sm:block" : ""}`} style={{ left: `${((Date.UTC(y, 0, 1) - min) / span) * 100}%` }}>{y}</span>
          ))}
        </div>
      </div>
      {/* Under 768 px the bars are too short for a name, so the same stints are listed in words (the bars stay as the overview) */}
      <div className="space-y-4 pt-3 md:hidden">
        {rows.map((row) => (
          <section key={row.label} aria-label={row.label}>
            <div className="mb-1 text-xs uppercase tracking-widest text-muted">{row.label}</div>
            <ul className="divide-y divide-line rounded-xl bg-panel2/60">
              {row.segments.map((s, i) => (
                <li key={i} className="flex items-baseline justify-between gap-3 px-3 py-2 text-sm" style={{ borderInlineStart: `3px solid ${row.color}` }}>
                  <span className="min-w-0">
                    {s.href ? <Link href={s.href} className="break-words font-semibold underline-offset-2 hover:underline">{s.label}</Link> : <span className="break-words font-semibold">{s.label}</span>}
                    <span className="tabular mt-0.5 block text-xs text-muted">
                      <bdi dir="ltr">{s.from ?? "?"}</bdi> → {s.to ? <bdi dir="ltr">{s.to}</bdi> : t("present")}
                    </span>
                  </span>
                  {s.sub && <bdi dir="ltr" className="tabular shrink-0 text-xs text-muted">{s.sub}</bdi>}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
