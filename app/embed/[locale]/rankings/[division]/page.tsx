import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EmbedFrame, parseTheme } from "@/components/EmbedFrame";
import { divisionFromSlug } from "@/lib/divisions";
import { isLocale, localePath } from "@/lib/i18n/config";
import { getTFor } from "@/lib/i18n/dicts";
import { apiRankings, dataOf, publicApiGate } from "@/lib/public-api";
import { abs } from "@/lib/seo";
import { getWorld } from "@/lib/world";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "origin" };

type Row = { rank: number; slug: string; name: string; country: string; rating: number; record: { wins: number; losses: number; draws: number } };

/** A division's top fighters to put in a frame: /embed/{locale}/rankings/{division}?limit=5&sex=male&theme=dark|light (the limit is 1 to 10). */
export default async function EmbedRankings({ params, searchParams }: { params: Promise<{ locale: string; division: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { locale, division } = await params;
  const d = divisionFromSlug(division);
  if (!isLocale(locale) || !d || !publicApiGate().open) notFound();
  const sp = await searchParams, one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const limit = Math.min(10, Math.max(1, Number(one("limit")) || 5)), sex = one("sex") === "female" ? "female" : "male";
  const t = await getTFor(locale);
  const r = apiRankings({ w: await getWorld(), t, url: (p) => abs(localePath(locale, p)) }, division, new URLSearchParams({ limit: String(limit), sex }));
  const data = dataOf(r);
  if (!data) notFound();
  const rows = data as Row[];
  return (
    <EmbedFrame theme={parseTheme(sp.theme)} locale={locale} t={t} path={`/rankings/${division}`}>
      <div className="eyebrow">{t("Rankings")}</div>
      <h1 className="font-display text-3xl font-extrabold uppercase leading-none">{t("{division} rankings", { division: t(d.name) })}</h1>
      {rows.length ? (
        <ol className="mt-3 divide-y divide-line/60">
          {rows.map((x) => (
            <li key={x.slug} className="flex items-baseline gap-3 py-2">
              <span className="tabular w-6 shrink-0 text-end text-sm font-bold text-gold">{x.rank}</span>
              <a href={abs(localePath(locale, `/boxers/${x.slug}`))} target="_blank" rel="noopener" className="min-w-0 flex-1 truncate font-semibold hover:text-gold">{x.name}</a>
              <span className="tabular text-xs text-muted" dir="ltr">{x.record.wins}-{x.record.losses}-{x.record.draws}</span>
              <span className="tabular w-12 text-end text-sm font-bold">{Math.round(x.rating)}</span>
            </li>
          ))}
        </ol>
      ) : <p className="mt-3 text-sm text-muted">{t("Nobody is ranked there.")}</p>}
    </EmbedFrame>
  );
}
