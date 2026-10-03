import Link from "@/components/L";
import { getWorld } from "@/lib/world";
import { PARTS, PART_LABEL, WEIGHTS, MIN_ROUNDS, featuredYear, fightOfTheYear, fightsOfYear, resultLine } from "@/lib/fight-score";
import { FightHero, ScoreBadge } from "@/components/Awards";
import { SectionTitle } from "@/components/ui";
import { currentYear } from "@/lib/clock";
import { fmtDate, methodLabel } from "@/lib/format";
import { getT } from "@/lib/i18n/server";
import { metaFor } from "@/lib/seo-server";
import { msg } from "@/lib/i18n/t";
import { hasWinner } from "@/lib/methods";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => metaFor(params, (p, t) => ({
  path: "/fight-of-the-year", title: t("Fight of the year"),
  description: t("The best fight of every year, picked by a published score: knockdowns, a close or late finish, action, evenly matched fighters, upsets, stakes and comebacks. See why each fight won."),
}));

export default async function FightOfTheYear() {
  const t = await getT();
  const w = await getWorld();
  const winners = fightOfTheYear(w);
  const fy = featuredYear(w);
  const featured = winners.find((x) => x.year === fy);

  return (
    <div className="space-y-12">
      <div>
        <div className="eyebrow mb-2">{t("Awards")}</div>
        <h1 className="font-display text-5xl font-extrabold uppercase">{t("Fight of the year")}</h1>
        <p className="mt-2 max-w-3xl text-muted">{t("Every fight of {n} rounds or more gets a score from 0 to 100 worked out from what is on record, and the highest score each year wins. There is no panel and no fan vote: the score is the whole argument, and every fight shows how it earned it.", { n: MIN_ROUNDS })}</p>
        <p className="mt-3 flex flex-wrap gap-2 text-sm"><Link href="/all-time/fights" className="chip !border-gold/40 hover:!text-gold">{t("Greatest fights of all time")}</Link><Link href="/all-time" className="chip hover:!text-ink">{t("All-time lists")}</Link></p>
      </div>

      {featured && (
        <section>
          <SectionTitle eyebrow={t("Latest completed year")} title={`${featured.year}`} href={`/fight-of-the-year/${featured.year}`} cta={t("The full top ten")} />
          <FightHero w={w} s={featured.top} label={t("Fight of the year {year}", { year: featured.year })} />
        </section>
      )}

      <section>
        <SectionTitle eyebrow={t("Every year")} title={t("Winners")} />
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">{t("Fight of the year winners")}</caption>
            <thead><tr className="text-start text-xs uppercase tracking-widest text-muted"><th scope="col" className="p-3 text-start font-normal">{t("Year")}</th><th scope="col" className="text-start font-normal">{t("Fight")}</th><th scope="col" className="hidden text-start font-normal md:table-cell">{t("Result")}</th><th scope="col" className="pe-3 text-end font-normal">{t("Score")}</th></tr></thead>
            <tbody>
              {winners.map(({ year, top }) => (
                <tr key={year} className="border-t border-line/60">
                  <th scope="row" className="whitespace-nowrap p-3 text-start font-display text-lg font-bold tabular"><Link href={`/fight-of-the-year/${year}`} className="hover:text-gold">{year}</Link>{year === currentYear() && <div className="text-xs font-normal text-muted">{t("so far")}</div>}</th>
                  <td><Link href={`/bouts/${top.bout.id}`} className="font-semibold hover:text-gold">{t.name(top.bout.redName)} <span className="text-muted">{t("vs")}</span> {t.name(top.bout.blueName)}</Link><div className="text-xs text-muted">{fmtDate(top.bout.date, { month: "short", day: "numeric" }, t.locale)} · {t.name(top.bout.eventName)}</div></td>
                  <td className="hidden text-muted md:table-cell">{resultLine(w, top.bout, t)}{hasWinner(top.bout.method) && ` · ${methodLabel(top.bout.method, top.bout.endRound, t)}`}</td>
                  <td className="pe-3 text-end"><ScoreBadge score={top.score} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted">{t("The current year can still change until its last fight. The numbers of fights considered: {counts}.", { counts: winners.slice(0, 3).map((x) => `${x.year}: ${fightsOfYear(w, x.year).length}`).join(", ") })}</p>
      </section>

      <section className="card p-6" aria-labelledby="how">
        <h2 id="how" className="font-display text-3xl font-bold uppercase">{t("How the score works")}</h2>
        <p className="mt-2 max-w-3xl text-sm text-muted">{t("Seven parts, each from 0 to 1, added up with these weights. A part that cannot be worked out for a fight (no scorecards, no punch statistics) is left out and the rest scaled up, so missing data never counts against a fight. The weights are our judgment of what makes a great fight; nothing was fitted to votes.")}</p>
        <dl className="mt-4 grid gap-x-8 gap-y-3 text-sm md:grid-cols-2">
          {PARTS.map((k) => (
            <div key={k}><dt className="font-semibold">{t(PART_LABEL[k])} <span className="tabular text-muted">· {Math.round(WEIGHTS[k] * 100)}%</span></dt><dd className="text-muted">{t(EXPLAIN[k])}</dd></div>
          ))}
        </dl>
        <p className="mt-4 text-xs text-muted">{t("Few fights score high: a typical fight scores about 25, a good one above 40, a great one above 55 and a classic above 70.")}</p>
      </section>
    </div>
  );
}

const EXPLAIN = {
  knockdowns: msg("How often either fighter went down. Both going down counts for more."),
  finish: msg("A decision as close as the cards allow (a split decision or a draw is the closest), or a stoppage late in the scheduled distance."),
  action: msg("Punches landed per round by both fighters compared with every other fight that has statistics, and how evenly they traded."),
  matchup: msg("Two evenly matched fighters, both highly rated going in."),
  upset: msg("The fighter the ratings did not favour won."),
  stakes: msg("A title on the line. A world title, and a vacant one, count for most."),
  comeback: msg("The winner was knocked down along the way."),
};
