import { notFound } from "next/navigation";
import Link from "@/components/L";
import { getWorld } from "@/lib/world";
import { fightsOfYear, fightYears, resultLine } from "@/lib/fight-score";
import { FightHero, FightList } from "@/components/Awards";
import { JsonLd } from "@/components/JsonLd";
import { currentYear } from "@/lib/clock";
import { abs } from "@/lib/seo";
import { localePath } from "@/lib/i18n/config";
import { getT } from "@/lib/i18n/server";
import { metaFor } from "@/lib/seo-server";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string; year: string }> }) => metaFor(params, async ({ year }, t) => {
  const w = await getWorld();
  const top = fightsOfYear(w, Number(year))[0];
  if (!top) notFound();
  return {
    path: `/fight-of-the-year/${year}`, title: t("Fight of the year {year}: {a} vs {b}", { year, a: t.name(top.bout.redName), b: t.name(top.bout.blueName) }),
    description: t("{result}. Fight score {score} out of 100. The top ten fights of {year} and why each scored as it did.", { result: resultLine(w, top.bout, t), score: top.score, year }),
  };
});

export default async function FightOfTheYearPage({ params }: { params: Promise<{ year: string }> }) {
  const { year: y } = await params;
  const year = Number(y);
  const t = await getT();
  const w = await getWorld();
  const years = fightYears(w);
  if (!/^\d{4}$/.test(y) || !years.includes(year)) notFound();
  const list = fightsOfYear(w, year);
  const [top, ...rest] = list;
  const live = year === currentYear();
  const newer = years[years.indexOf(year) - 1], older = years[years.indexOf(year) + 1];

  return (
    <div className="space-y-10">
      <JsonLd data={{
        "@type": "ItemList", name: t("Fight of the year {year}", { year }), url: abs(localePath(t.locale, `/fight-of-the-year/${year}`)),
        itemListElement: list.slice(0, 10).map((s, i) => ({ "@type": "ListItem", position: i + 1, url: abs(localePath(t.locale, `/bouts/${s.bout.id}`)), name: `${t.name(s.bout.redName)} vs ${t.name(s.bout.blueName)}` })),
      }} />
      <div>
        <div className="eyebrow mb-2"><Link href="/fight-of-the-year" className="hover:text-ink">{t("Fight of the year")}</Link></div>
        <h1 className="font-display text-5xl font-extrabold uppercase">{year}</h1>
        <p className="mt-2 max-w-3xl text-muted">{live ? t("The year so far: {n} fights of six rounds or more scored. This can still change.", { n: list.length }) : t("{n} fights of six rounds or more were scored.", { n: list.length })}</p>
        <nav className="mt-3 flex flex-wrap gap-2" aria-label={t("Other years")}>
          {newer && <Link href={`/fight-of-the-year/${newer}`} className="chip hover:!text-ink"><span className="rtl:rotate-180" aria-hidden>←</span> {newer}</Link>}
          {older && <Link href={`/fight-of-the-year/${older}`} className="chip hover:!text-ink">{older} <span className="rtl:rotate-180" aria-hidden>→</span></Link>}
        </nav>
      </div>
      <FightHero w={w} s={top} label={live ? t("Leading the year {year}", { year }) : t("Fight of the year {year}", { year })} />
      {rest.length > 0 && (
        <section className="card p-5">
          <h2 className="mb-1 font-display text-3xl font-bold uppercase">{t("Runners-up")}</h2>
          <FightList w={w} list={rest.slice(0, 9)} start={2} />
        </section>
      )}
    </div>
  );
}
