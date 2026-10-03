import { ScrollRegion } from "@/components/ScrollRegion";
import Link from "@/components/L";
import { getWorld } from "@/lib/world";
import { PENALTY, LOGIT_TO_ELO, VERDICT_LABEL, moves, switchStudy, trainerImpact, underdogLifters, type Impact } from "@/lib/trainer-impact";
import { recentTrainerChanges } from "@/lib/team";
import { ImpactRange } from "@/components/ImpactRange";
import { SectionTitle, Stat } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { getT } from "@/lib/i18n/server";
import { metaFor } from "@/lib/seo-server";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => metaFor(params, (p, t) => ({
  path: "/trainers", title: t("Trainer impact"),
  description: t("How much head trainers change their fighters' results, estimated with a model that separates a trainer's effect from their fighters' own ability, with honest error bars, plus what happens when fighters change trainer."),
}));

const sign = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(Math.round(v))}`;

async function Row({ x, rank }: { x: Impact; rank: number }) {
  const t = await getT();
  return (
    <li className="grid grid-cols-[2rem_minmax(0,1fr)] items-center gap-3 py-3 sm:grid-cols-[2rem_minmax(0,1fr)_minmax(0,14rem)_5rem]">
      <span className="font-display text-xl font-bold tabular text-muted">{rank}</span>
      <div className="min-w-0">
        <Link href={`/people/${x.person.slug}`} className="block truncate font-semibold hover:text-gold">{t.name(x.person.name)}</Link>
        <div className="text-xs text-muted">{t(VERDICT_LABEL[x.verdict])} · {t.n(x.fighters, "{n} fighter", "{n} fighters")} · {t.n(x.fights, "{n} fight", "{n} fights")}</div>
      </div>
      <div className="col-span-2 sm:col-span-1"><ImpactRange impact={x} /></div>
      <div className="hidden text-end sm:block"><div className="font-display text-xl font-bold tabular text-gold">{sign(x.effect)}</div><div className="text-xs text-muted">Elo</div></div>
    </li>
  );
}

export default async function Trainers() {
  const t = await getT();
  const w = await getWorld();
  const T = trainerImpact(w);
  const study = switchStudy(w);
  const mv = moves(w);
  const lifters = underdogLifters(w).slice(0, 8);
  const top = T.ranked.slice(0, 10);
  const bottom = T.ranked.filter((x) => x.effect < 0).slice(-6).reverse();
  const changes = recentTrainerChanges(w, 9).slice(0, 10);
  const clear = T.all.filter((x) => x.verdict === "above" || x.verdict === "below").length;
  const leaning = T.all.filter((x) => x.verdict.startsWith("leaning")).length;

  return (
    <div className="space-y-12">
      <div>
        <div className="eyebrow mb-2">{t("Camps")}</div>
        <h1 className="font-display text-5xl font-extrabold uppercase">{t("Trainer impact")}</h1>
        <p className="mt-2 max-w-3xl text-muted">{t("Does the head trainer change how a fighter performs? Fighters' ratings rising under a trainer proves little: young fighters rise whoever trains them. So each trainer's effect is estimated together with every fighter's own ability, using fighters who have worked with more than one trainer, and every estimate comes with its error bars.")}</p>
        <p className="mt-3 flex flex-wrap gap-2 text-sm"><Link href="/people?role=trainer" className="chip hover:!text-ink">{t("All corner people")}</Link><Link href="/upset-watch" className="chip hover:!text-ink">{t("Upset watch")}</Link></p>
      </div>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t("Fights modelled")} value={T.fights.toLocaleString("en-US")} sub={t("with a known head trainer")} />
        <Stat label={t("Head trainers")} value={T.all.length} sub={t("with at least one fight")} />
        <Stat label={t("Fighters who switched")} value={T.switchers} sub={t("had two or more head trainers")} />
        <Stat label={t("Trainers the data can separate")} value={clear + leaning} sub={t("{clear} clearly, {leaning} leaning", { clear, leaning })} />
      </section>

      <section className="card p-6" aria-labelledby="honest">
        <h2 id="honest" className="font-display text-3xl font-bold uppercase">{t("What the data can and cannot say")}</h2>
        <ul className="mt-3 max-w-3xl space-y-2 text-sm">
          <li className="flex gap-2"><span className="text-gold" aria-hidden>●</span><span>{t("A trainer's effect is in Elo points against the average trainer (zero). A fighter with a +30 trainer is about 30 Elo points better than the same fighter would be with an average one: roughly 4 percentage points of win chance against an equal opponent.")}</span></li>
          <li className="flex gap-2"><span className="text-gold" aria-hidden>●</span><span>{t("The ranges are wide. Only {clear} of {n} trainers are clearly above or below average, and {leaning} more lean one way. For everyone else the honest answer is that the data cannot tell them from average.", { clear, n: T.all.length, leaning })}</span></li>
          <li className="flex gap-2"><span className="text-gold" aria-hidden>●</span><span>{t("Only fighters who changed trainer tell a trainer's effect apart from their fighters' ability. A trainer whose fighters never left is pulled toward zero, however good the results.")}</span></li>
          <li className="flex gap-2"><span className="text-gold" aria-hidden>●</span><span>{t("Fighters do not change trainer at random: they often move after a bad run. And each fighter's ability is treated as fixed through a career. Both can bias the estimates, and the penalty that pulls estimates toward zero (a typical trainer within about {n} Elo) is a judgment.", { n: Math.round(LOGIT_TO_ELO / Math.sqrt(PENALTY.trainer)) })}</span></li>
        </ul>
      </section>

      {study && (
        <section className="card p-6" aria-labelledby="switch">
          <h2 id="switch" className="font-display text-3xl font-bold uppercase">{t("Does changing trainer matter?")}</h2>
          <p className="mt-2 max-w-3xl text-sm text-muted">{t("A plain comparison. Rating change over the next six fights for fighters who changed head trainer, against the same measure for fighters who stayed put.")}</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Stat label={t("Changed trainer")} value={sign(study.switched.mean)} sub={t("{n} moves, Elo over six fights", { n: study.switched.n.toLocaleString("en-US") })} />
            <Stat label={t("Stayed")} value={sign(study.stayed.mean)} sub={t("{n} stretches, Elo over six fights", { n: study.stayed.n.toLocaleString("en-US") })} />
            <Stat label={t("Difference")} value={sign(study.difference)} sub={t("± {n} (one standard error)", { n: study.se.toFixed(1) })} />
          </div>
          <p className="mt-3 max-w-3xl text-sm">{Math.abs(study.difference) >= 2 * study.se
            ? t("Fighters who changed head trainer moved {d} Elo points {dir} than those who did not over the next six fights: a real gap, small next to a typical fight swing of 15 to 25 points, and it does not show the new trainer caused it.", { d: Math.abs(Math.round(study.difference * 10) / 10), dir: study.difference > 0 ? t("further up") : t("further down") })
            : t("The difference ({d} Elo points) is within its margin of error: there is no clear sign that changing trainer moves results either way.", { d: sign(study.difference) })}</p>
        </section>
      )}

      <section>
        <SectionTitle eyebrow={t("Estimated effect, best first")} title={t("Who adds the most")} />
        <ol className="card divide-y divide-line/60 px-4">{top.map((x, i) => <Row key={x.person.id} x={x} rank={i + 1} />)}</ol>
        <p className="mt-3 text-xs text-muted">{t("The dot is the estimate and the line its 95% range; the centre mark is the average trainer. A line that crosses the centre cannot be told from average.")}</p>
      </section>

      {bottom.length > 0 && (
        <section>
          <SectionTitle eyebrow={t("Estimated effect, lowest first")} title={t("Who may be holding fighters back")} />
          <ol className="card divide-y divide-line/60 px-4">{bottom.map((x, i) => <Row key={x.person.id} x={x} rank={T.ranked.length - i} />)}</ol>
        </section>
      )}

      {lifters.length > 0 && (
        <section>
          <SectionTitle eyebrow={t("A different measure")} title={t("Who gets underdogs over the line")} />
          <ScrollRegion className="card" label={t("Head trainers whose fighters beat the odds as underdogs")}>
            <table className="w-full text-sm">
              <caption className="sr-only">{t("Head trainers whose fighters beat the odds as underdogs")}</caption>
              <thead><tr className="text-start text-xs uppercase tracking-widest text-muted"><th scope="col" className="p-3 text-start font-normal">{t("Trainer")}</th><th scope="col" className="text-end font-normal">{t("Underdog fights")}</th><th scope="col" className="text-end font-normal">{t("Wins")}</th><th scope="col" className="text-end font-normal">{t("Expected")}</th><th scope="col" className="pe-3 text-end font-normal">{t("Over")}</th></tr></thead>
              <tbody>{lifters.map((l) => (
                <tr key={l.person.id} className="border-t border-line/60 tabular">
                  <th scope="row" className="p-3 text-start font-semibold"><Link href={`/people/${l.person.slug}`} className="hover:text-gold">{t.name(l.person.name)}</Link></th>
                  <td className="text-end">{l.underdogFights}</td><td className="text-end">{l.wins}</td><td className="text-end text-muted">{l.expected.toFixed(1)}</td><td className="pe-3 text-end text-gold">{l.over >= 0 ? "+" : "−"}{Math.abs(l.over).toFixed(1)}</td>
                </tr>
              ))}</tbody>
            </table>
          </ScrollRegion>
          <p className="mt-3 max-w-3xl text-xs text-muted">{t("Fights where the fighter was the underdog going in (under 40% by their ratings): wins against the wins the ratings expected. At these sample sizes a few lucky nights explain most of the gaps; read it as a list to watch, not a verdict.")}</p>
        </section>
      )}

      {changes.length > 0 && (
        <section>
          <SectionTitle eyebrow={t("Last nine months")} title={t("Fighters with a new head trainer")} />
          <ul className="card divide-y divide-line/60 px-4">
            {changes.map((c) => {
              const from = c.from ? T.byPerson.get(c.from.id) : null, to = c.to ? T.byPerson.get(c.to.id) : null;
              const shift = from && to && from.evidence !== "thin" && to.evidence !== "thin" ? to.effect - from.effect : null;
              return (
                <li key={`${c.boxer.id}-${c.date}`} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                  <span><Link href={`/boxers/${c.boxer.slug}`} className="font-semibold hover:text-gold">{t.name(c.boxer.name)}</Link> <span className="text-muted">· {fmtDate(c.date, { month: "short", day: "numeric", year: "numeric" }, t.locale)} · {c.from ? t.name(c.from.name) : t("none on record")} → {c.to ? t.name(c.to.name) : t("none on record")}</span></span>
                  {shift !== null && <span className="chip whitespace-nowrap">{t("estimated shift {n} Elo", { n: sign(shift) })}</span>}
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-xs text-muted">{t("The shift is the new trainer's estimated effect minus the old one's, shown only when both have enough evidence. It is about as uncertain as the two estimates behind it. {n} moves are on record in all.", { n: mv.length.toLocaleString("en-US") })}</p>
        </section>
      )}
    </div>
  );
}
