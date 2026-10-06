"use client";
import type { Digest } from "@/lib/watch-digest";
import { fmtDate } from "@/lib/format";
import { useLocale, useT } from "@/components/i18n";
import { useHref } from "@/components/L";

const TONE = { W: "bg-win/15 text-win", L: "bg-red/15 text-red-ink", D: "bg-white/10 text-muted", NC: "bg-white/10 text-muted" } as const;

/** What changed for the fighters on the list since the day this browser last looked: new results, how each rating moved, the fights coming up this fortnight. */
export function WatchDigest({ digest, onSeen }: { digest: Digest; onSeen: () => void }) {
  const t = useT();
  const locale = useLocale();
  const href = useHref();
  const since = fmtDate(digest.since, { month: "long", day: "numeric", year: "numeric" }, locale);
  const res = { W: t("W"), L: t("L"), D: t("D"), NC: t("NC") };
  if (!digest.items.length) return <p className="text-sm text-muted">{t("Nothing new since {date}.", { date: since })}</p>;
  return (
    <section className="card space-y-4 p-4 sm:p-5" aria-labelledby="digest-title">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div>
          <h2 id="digest-title" className="font-display text-2xl font-bold uppercase">{t("Since you last looked")}</h2>
          <p className="text-xs text-muted">{t("After {date}", { date: since })}</p>
        </div>
        <button type="button" onClick={onSeen} className="chip cursor-pointer transition hover:text-ink">{t("Mark as seen")}</button>
      </div>
      <ul className="divide-y divide-line/60">
        {digest.items.map((f) => (
          <li key={f.slug} className="space-y-1.5 py-3 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <a href={href(`/boxers/${f.slug}`)} className="inline-block py-0.5 font-display text-lg font-bold uppercase leading-tight hover:text-gold">{f.name}</a>
              {f.rating ? (
                <span className="tabular text-sm text-muted">
                  <span className="sr-only">{t("Rating {from} to {to}", { from: f.rating.from, to: f.rating.to })}</span>
                  <span aria-hidden="true">{t("Rating")} <bdi dir="ltr" className="text-ink">{f.rating.from}</bdi> → <bdi dir="ltr" className={f.rating.to > f.rating.from ? "text-win" : "text-red-ink"}>{f.rating.to}</bdi></span>
                </span>
              ) : null}
            </div>
            {f.results.map((r) => (
              <a key={r.boutId} href={href(`/bouts/${r.boutId}`)} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-0.5 text-sm hover:underline">
                <span className={`grid h-6 min-w-6 place-items-center rounded-md px-1 text-xs font-bold ${TONE[r.result]}`}>{res[r.result]}</span>
                <span>{t("{opponent}, {how}", { opponent: r.opponent, how: r.how })}</span>
                <span className="text-xs text-muted">{r.dateLabel}</span>
                {r.ratingDelta ? <bdi dir="ltr" className={`tabular text-xs ${r.ratingDelta > 0 ? "text-win" : "text-red-ink"}`}>{r.ratingDelta > 0 ? "+" : ""}{r.ratingDelta}</bdi> : null}
              </a>
            ))}
            {f.moreResults > 0 ? <p className="text-xs text-muted">{t("+{n} more", { n: f.moreResults })}</p> : null}
            {f.next ? (
              <a href={href(`/bouts/${f.next.boutId}`)} className="block py-0.5 text-sm text-gold hover:underline">
                {t("Next fight")}: {t("{date} vs {name}", { date: f.next.dateLabel, name: f.next.opponent })} · {t.n(f.next.days, "In {n} day", "In {n} days")}
              </a>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
