import Link from "@/components/L";
import { notFound } from "next/navigation";
import { getWorld, recordStr } from "@/lib/world";
import { DIVISIONS, divisionFromSlug, divisionLabel, limitLabel, slugifyDivision } from "@/lib/divisions";
import { rankDivision } from "@/lib/rankings";
import { archetype } from "@/lib/style";
import { Headshot } from "@/components/Portrait";
import { Delta, ArchBadge } from "@/components/ui";
import { countryName, flag, fmtDate } from "@/lib/format";
import { getT } from "@/lib/i18n/server";
import { metaFor } from "@/lib/seo-server";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string; division: string }> }) => metaFor(params, async (p, t) => {
  const d = divisionFromSlug(p.division);
  if (!d) notFound();
  const champ = rankDivision(await getWorld(), d.name, 1, "male")[0];
  return {
    path: `/rankings/${p.division}`,
    title: t("{division} rankings", { division: t(d.name) }),
    description: champ
      ? t("Current {division} boxing rankings by Elo rating, with record, style, KO rate and recent form. {name} ({record}) is the top-rated fighter.", { division: t(d.name), name: t.name(champ.boxer.name), record: recordStr(champ.boxer) })
      : t("Current {division} boxing rankings by Elo rating, with record, style, KO rate and recent form for every qualifying fighter.", { division: t(d.name) }),
  };
});

export default async function DivisionRankings({ params, searchParams }: { params: Promise<{ locale: string; division: string }>; searchParams: Promise<{ sex?: string }> }) {
  const t = await getT();
  const { division } = await params;
  const sex = (await searchParams).sex === "female" ? "female" : "male";
  const q = sex === "female" ? "?sex=female" : "";
  const d = divisionFromSlug(division);
  if (!d) notFound();
  const w = await getWorld();
  const rows = rankDivision(w, d.name, 15, sex);
  const champ = rows[0];
  void archetype;

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {DIVISIONS.map((x) => <Link key={x.name} href={`/rankings/${slugifyDivision(x.name)}${q}`} className={`chip transition hover:text-ink ${x.name === d.name ? "!border-gold/50 !text-gold" : ""}`}>{t(x.short)}</Link>)}
      </div>
      <div className="eyebrow mb-2 mt-8">{limitLabel(d, t)}</div>
      <h1 className="font-display text-6xl font-extrabold uppercase leading-none">{divisionLabel(d.name, sex, t)}</h1>
      <div className="mt-4 flex gap-2"><Link href={`/rankings/${slugifyDivision(d.name)}`} className={`chip ${sex === "male" ? "!border-gold/50 !text-gold" : ""}`}>{t("Men")}</Link><Link href={`/rankings/${slugifyDivision(d.name)}?sex=female`} className={`chip ${sex === "female" ? "!border-gold/50 !text-gold" : ""}`}>{t("Women")}</Link></div>

      {champ && (
        <Link href={`/boxers/${champ.boxer.slug}`} className="card card-hover mt-6 flex flex-wrap items-center gap-6 p-5">
          <Headshot boxer={champ.boxer} size={110} />
          <div>
            <div className="eyebrow">{t("Top rated")}</div>
            <div className="font-display text-4xl font-extrabold uppercase leading-tight">{t.name(champ.boxer.name)}</div>
            <div className="text-sm text-muted">{flag(champ.boxer.country)} {countryName(champ.boxer.country, t.locale)} · {recordStr(champ.boxer)} · {t("{n} KO", { n: champ.boxer.kos })}</div>
          </div>
          <div className="ms-auto text-end"><div className="font-display text-5xl font-bold text-gold tabular">{Math.round(champ.boxer.rating)}</div><div className="text-xs text-muted">{t("Elo rating")}</div></div>
        </Link>
      )}

      <div className="card mt-6 overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-start text-[11px] uppercase tracking-widest text-muted">
            <th className="p-3">#</th><th>{t("Fighter")}</th><th className="hidden sm:table-cell">{t("Style")}</th><th>{t("Record")}</th><th className="hidden md:table-cell">{t("KO%")}</th><th className="hidden md:table-cell">{t("Last fight")}</th><th className="text-end">{t("Rating")}</th><th className="p-3 text-end">{t("90d")}</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.boxer.id} className="border-t border-line/60 transition hover:bg-panel2/50">
                <td className={`p-3 font-display text-xl font-bold ${r.rank === 1 ? "text-gold" : ""}`}>{r.rank}</td>
                <td><Link href={`/boxers/${r.boxer.slug}`} className="flex items-center gap-3 py-2"><Headshot boxer={r.boxer} size={36} /><span><b>{t.name(r.boxer.name)}</b><span className="block text-xs text-muted">{flag(r.boxer.country)} {countryName(r.boxer.country, t.locale)} · {r.boxer.age}</span></span></Link></td>
                <td className="hidden sm:table-cell"><ArchBadge b={r.boxer} /></td>
                <td className="tabular">{recordStr(r.boxer)}</td>
                <td className="hidden tabular text-muted md:table-cell">{Math.round(r.boxer.koRate * 100)}%</td>
                <td className="hidden text-muted md:table-cell">{r.boxer.lastFight ? fmtDate(r.boxer.lastFight, { month: "short", year: "numeric" }, t.locale) : "—"}</td>
                <td className="text-end font-semibold tabular">{Math.round(r.boxer.rating)}</td>
                <td className="p-3 text-end"><div className="flex items-center justify-end gap-2"><span className={`tabular text-xs ${r.ratingChange >= 0 ? "text-win" : "text-red"}`}>{r.ratingChange >= 0 ? "+" : ""}{Math.round(r.ratingChange)}</span><Delta d={r.delta} /></div></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <div className="p-8 text-center text-muted">{t("No qualifying fighters in this division yet.")}</div>}
      </div>
    </div>
  );
}
