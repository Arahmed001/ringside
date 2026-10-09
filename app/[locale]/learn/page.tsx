import Link from "@/components/L";
import { getT } from "@/lib/i18n/server";
import { metaFor } from "@/lib/seo-server";
import { DIVISIONS } from "@/lib/divisions";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => metaFor(params, (p, t) => ({
  path: "/learn", title: t("Boxing, explained"),
  description: t("How a fight is won and scored, how to read a record, what the weight classes and belts mean, and where Ringside’s ratings come from, in plain words."),
}));

/**
 * The page a newcomer needs before the rest of the site makes sense. Every term on the site (KO, TKO, RTD, a split decision, a unified champion) is explained
 * here in the words the site uses, and every section links to the page where the thing can be seen.
 */
export default async function Learn() {
  const t = await getT();
  const h2 = "font-display text-3xl font-extrabold uppercase";
  const endings: [string, string][] = [
    [t("Knockout (KO)"), t("A fighter is knocked down and cannot get up before the referee counts ten.")],
    [t("Technical knockout (TKO)"), t("The referee, or the ringside doctor, stops the fight because a fighter can no longer defend themselves or is too badly hurt to go on.")],
    [t("Corner retirement (RTD)"), t("A fighter’s corner pulls them out between rounds. Ringside counts it as a stoppage (a technical knockout), as most record keepers do.")],
    [t("Disqualification (DQ)"), t("A fighter breaks the rules badly or repeatedly, for example with low blows, and loses on the spot.")],
    [t("Decision"), t("If nobody is stopped, three judges score every round and the fight is decided on their cards.")],
    [t("Technical decision"), t("A fight stopped early by an accident, usually a cut from a clash of heads, goes to the scorecards once enough rounds have been fought (usually four, depending on the commission). A technical draw is the same with level cards.")],
    [t("No contest"), t("The fight is declared void, for example after an accidental foul early on. Ringside’s win-loss-draw figure leaves it out.")],
  ];
  const decisions: [string, string][] = [
    [t("Unanimous decision (UD)"), t("All three judges pick the same fighter.")],
    [t("Split decision (SD)"), t("Two judges pick one fighter and the third picks the other.")],
    [t("Majority decision (MD)"), t("Two judges pick one fighter and the third scores it a draw.")],
    [t("Draw"), t("Either every judge scores it level, or the cards split so that neither fighter has a majority.")],
  ];
  const toc: [string, string][] = [["won", t("How a fight is won")], ["scored", t("How the judges score")], ["record", t("How to read a record")], ["weights", t("Weight classes")], ["belts", t("Belts and champions")], ["ratings", t("Where Ringside’s ratings come from")]];
  return (
    <div className="mx-auto max-w-3xl space-y-12">
      <div>
        <div className="eyebrow mb-2">{t("New to boxing?")}</div>
        <h1 className="font-display text-5xl font-extrabold uppercase">{t("Boxing, explained")}</h1>
        <p className="mt-3 text-lg text-muted">{t("The few things this site’s numbers take for granted: how a fight is won, how to read a record and what a belt means.")}</p>
        <p className="mt-3"><Link href="/tour" className="chip !border-gold/50 !px-3.5 !py-1.5 !text-sm !text-gold hover:!bg-gold/10"><span aria-hidden="true">▶</span>{t("New to Ringside? Watch the 70-second tour")}</Link></p>
        <nav aria-label={t("On this page")} className="mt-5 flex flex-wrap gap-2">
          {toc.map(([id, label]) => <a key={id} href={`#${id}`} className="chip transition hover:text-ink">{label}</a>)}
        </nav>
      </div>

      <section id="won" className="space-y-4">
        <h2 className={h2}>{t("How a fight is won")}</h2>
        <dl className="card divide-y divide-line/60">
          {endings.map(([k, v]) => <div key={k} className="grid gap-1 p-4 sm:grid-cols-[14rem_1fr] sm:gap-4"><dt className="font-semibold">{k}</dt><dd className="text-muted">{v}</dd></div>)}
        </dl>
      </section>

      <section id="scored" className="space-y-4">
        <h2 className={h2}>{t("How the judges score")}</h2>
        <p className="text-muted">{t("Each judge scores every round with the 10-point must system: the fighter who won the round gets 10 points and the other gets 9 or fewer. A knockdown usually costs the fighter who went down an extra point, and the referee can take a point for a foul. A round that is exactly level is scored {level}, which is rare.", { level: "10–10" })}</p>
        <p className="text-muted">{t("The three cards are added up, and how they agree gives the result:")}</p>
        <dl className="card divide-y divide-line/60">
          {decisions.map(([k, v]) => <div key={k} className="grid gap-1 p-4 sm:grid-cols-[14rem_1fr] sm:gap-4"><dt className="font-semibold">{k}</dt><dd className="text-muted">{v}</dd></div>)}
        </dl>
      </section>

      <section id="record" className="space-y-4">
        <h2 className={h2}>{t("How to read a record")}</h2>
        <p className="text-muted">{t("A record is wins, losses and draws, in that order: {example} is 25 wins, 3 losses and 1 draw. Knockouts are the wins that ended early; Ringside shows them as a count and as a share of wins. Ringside leaves a no contest out of that figure.", { example: "25-3-1" })}</p>
        <p className="text-muted">{t("When Ringside does not hold a fighter’s early fights, the record on the page is the career total from the data supplier and the page says so; the fight list and the rates are then built only from the fights we hold.")}</p>
      </section>

      <section id="weights" className="space-y-4">
        <h2 className={h2}>{t("Weight classes")}</h2>
        <p className="text-muted">{t("Boxers fight in {n} divisions, from minimumweight (105 lb) to heavyweight (over 200 lb). Fighters step on the scale, usually the day before the fight, and coming in over the limit is called missing weight.", { n: DIVISIONS.length })}</p>
        <p><Link href="/rankings" className="underline decoration-dotted hover:text-gold">{t("See the rankings in every division")}</Link></p>
      </section>

      <section id="belts" className="space-y-4">
        <h2 className={h2}>{t("Belts and champions")}</h2>
        <p className="text-muted">{t("Four organisations, the WBA, WBC, IBF and WBO, each normally name a world champion in every division, so one division can have four champions at once. A fighter who holds more than one of those belts is a unified champion, and one who holds all four is called undisputed.")}</p>
        <p className="text-muted">{t("An organisation may also name an interim champion while the champion is out, or a super champion for its best fighter. Ringside rebuilds each belt’s line of champions from the title fights in the data.")}</p>
        <p><Link href="/titles" className="underline decoration-dotted hover:text-gold">{t("See every belt and its champions")}</Link></p>
      </section>

      <section id="ratings" className="space-y-4">
        <h2 className={h2}>{t("Where Ringside’s ratings come from")}</h2>
        <p className="text-muted">{t("Ratings are Elo-style: Ringside’s own calculation from results, not an official ranking. Everyone starts at 1,500 and gains or loses points after each fight, more for beating a higher-rated opponent, and a stoppage counts for a little more than a decision.")}</p>
        <p className="text-muted">{t("A fighter needs five fights on record to be ranked. The win probabilities on fight previews come from these ratings, and the track record page shows how they have done.")}</p>
        <p><Link href="/accountability" className="underline decoration-dotted hover:text-gold">{t("See the track record")}</Link></p>
      </section>
    </div>
  );
}
