import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EmbedFrame, parseTheme } from "@/components/EmbedFrame";
import { countryName, flag } from "@/lib/format";
import { isLocale } from "@/lib/i18n/config";
import { getTFor } from "@/lib/i18n/dicts";
import { apiFighter, dataOf, publicApiGate } from "@/lib/public-api";
import { localePath } from "@/lib/i18n/config";
import { abs } from "@/lib/seo";
import { getWorld } from "@/lib/world";

export const dynamic = "force-dynamic";
// a widget is not a page to find in search, but a frame needs a title (screen readers announce it): the fighter's name
export async function generateMetadata({ params }: { params: Promise<{ locale: string; slug: string }> }): Promise<Metadata> {
  const { locale, slug } = await params;
  const b = isLocale(locale) ? (await getWorld()).bySlug.get(slug) : undefined;
  return { title: b ? `${(await getTFor(locale as "en" | "ar")).name(b.name)} · Ringside` : "Ringside", robots: { index: false, follow: false }, referrer: "origin" };
}

type Fighter = { name: string; nickname: string | null; country: string; division: string; active: boolean; record: { wins: number; losses: number; draws: number; source: string; held: number; total: number };
  knockouts: { wins: number }; rating: number; divisionRank: number | null; lastFights: { id: number; result: { forFighter: string } }[]; nextFight: { id: number; date: string; red: { slug: string; name: string }; blue: { slug: string; name: string } } | null };
const TONE: Record<string, string> = { W: "bg-win/15 text-win", L: "bg-red/15 text-red-ink", D: "bg-white/10 text-muted", NC: "bg-white/10 text-muted" };

/** A fighter card to put in a frame: /embed/{locale}/fighter/{slug}?theme=dark|light. Built from the public API's own fields, so it can show nothing the API does not. */
export default async function EmbedFighter({ params, searchParams }: { params: Promise<{ locale: string; slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { locale, slug } = await params;
  if (!isLocale(locale) || !publicApiGate().open) notFound();
  const t = await getTFor(locale);
  const w = await getWorld();
  const r = apiFighter({ w, t, url: (p) => abs(localePath(locale, p)) }, slug);
  const data = dataOf(r);
  if (!data) notFound();
  const f = data as Fighter, theme = parseTheme((await searchParams).theme);
  const rec = `${f.record.wins}-${f.record.losses}-${f.record.draws}`;
  const res = { W: t("W"), L: t("L"), D: t("D"), NC: t("NC") } as Record<string, string>;
  const next = f.nextFight, other = next ? (next.red.slug === slug ? next.blue.name : next.red.name) : null;
  return (
    <EmbedFrame theme={theme} locale={locale} t={t} path={`/boxers/${slug}`}>
      <h1 className="font-display text-3xl font-extrabold uppercase leading-none">{f.name}</h1>
      <p className="mt-1.5 text-sm text-muted"><span aria-hidden="true">{flag(f.country)} </span>{countryName(f.country, locale)} · {t(f.division)}{f.active ? "" : ` · ${t("Retired")}`}</p>
      <dl className="mt-4 grid grid-cols-3 gap-3">
        <div><dt className="eyebrow">{t("Record")}</dt><dd className="tabular mt-0.5 text-2xl font-bold" dir="ltr">{rec}</dd></div>
        <div><dt className="eyebrow">{t("Knockouts")}</dt><dd className="tabular mt-0.5 text-2xl font-bold">{f.knockouts.wins}</dd></div>
        <div><dt className="eyebrow">{t("Rating")}</dt><dd className="tabular mt-0.5 text-2xl font-bold text-gold">{Math.round(f.rating)}</dd>{f.divisionRank ? <dd className="text-xs text-muted">{t("Rank #{n}", { n: f.divisionRank })}</dd> : null}</div>
      </dl>
      {f.record.source !== "loaded" ? <p className="mt-2 text-xs text-muted">{t("Worked out from the {held} fights Ringside holds, not the whole career.", { held: f.record.held })}</p> : null}
      {f.lastFights.length ? (
        <p className="mt-4 flex flex-wrap items-center gap-1.5 text-sm">
          <span className="me-1 text-muted">{t.n(f.lastFights.length, "Last fight", "Last {n} fights")}</span>
          {f.lastFights.map((x) => <span key={x.id} className={`grid h-6 min-w-6 place-items-center rounded-md px-1 text-xs font-bold ${TONE[x.result.forFighter] ?? TONE.NC}`}>{res[x.result.forFighter] ?? x.result.forFighter}</span>)}
        </p>
      ) : null}
      {next && other ? <p className="mt-3 text-sm"><span className="text-muted">{t("Next fight")}: </span><span className="text-gold">{t("{date} vs {name}", { date: next.date, name: other })}</span></p> : null}
    </EmbedFrame>
  );
}
