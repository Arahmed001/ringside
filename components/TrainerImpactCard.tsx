import Link from "@/components/L";
import { ImpactRange } from "@/components/ImpactRange";
import { MIN_INFORMATIVE_FIGHTS, VERDICT_LABEL, movesOf, trainerImpact, underdogRecordOf, type Move } from "@/lib/trainer-impact";
import type { World } from "@/lib/world";
import { fmtDate } from "@/lib/format";
import { getT } from "@/lib/i18n/server";

const sign = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(Math.round(v))}`;

async function MoveTable({ rows, kind }: { rows: Move[]; kind: "arrived" | "left" }) {
  const t = await getT();
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">{kind === "arrived" ? t("Fighters who joined, and their rating over the next fights") : t("Fighters who left, and their rating over the next fights")}</caption>
        <thead><tr className="text-start text-xs uppercase tracking-widest text-muted"><th scope="col" className="py-2 text-start font-normal">{t("Fighter")}</th><th scope="col" className="text-start font-normal">{kind === "arrived" ? t("From") : t("To")}</th><th scope="col" className="text-end font-normal">{t("Rating")}</th><th scope="col" className="text-end font-normal">{t("Change")}</th></tr></thead>
        <tbody>
          {rows.slice(0, 8).map((m) => {
            const delta = m.after === null ? null : m.after - m.before;
            // for someone who left, the change that matters is how they did without this trainer, so the sign is read the other way round
            const good = delta === null ? null : kind === "arrived" ? delta > 0 : delta < 0;
            const other = kind === "arrived" ? m.from : m.to;
            return (
              <tr key={`${m.boxer.id}-${m.date}`} className="border-t border-line/60 tabular">
                <th scope="row" className="py-2 text-start font-semibold"><Link href={`/boxers/${m.boxer.slug}`} className="hover:text-gold">{t.name(m.boxer.name)}</Link><div className="text-xs font-normal text-muted">{fmtDate(m.date, { month: "short", year: "numeric" }, t.locale)}</div></th>
                <td className="text-muted">{other ? <Link href={`/people/${other.slug}`} className="hover:text-ink">{t.name(other.name)}</Link> : t("none on record")}</td>
                <td className="text-end text-muted">{Math.round(m.before)} → {m.after === null ? "–" : Math.round(m.after)}</td>
                <td className={`text-end ${good === null ? "" : good ? "text-win" : "text-red-ink"}`}>{delta === null ? "–" : sign(delta)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** A head trainer's estimated effect with its range, the fighters who joined and left, and their fighters' record as underdogs. */
export async function TrainerImpactCard({ w, personId }: { w: World; personId: number }) {
  const t = await getT();
  const imp = trainerImpact(w).byPerson.get(personId);
  if (!imp) return null;
  const { arrived, left } = movesOf(w, personId);
  const ud = underdogRecordOf(w, personId);
  return (
    <section className="space-y-5" aria-labelledby="impact">
      <div>
        <div className="eyebrow mb-1">{t("As head trainer")}</div>
        <h2 id="impact" className="font-display text-3xl font-bold uppercase leading-none">{t("Impact on results")}</h2>
      </div>
      <div className="card p-5">
        {imp.evidence === "thin" ? (
          <p className="text-sm text-muted">{t("Too few of {name}’s fighters have worked with anyone else to tell the trainer’s effect apart from the fighters’ own ability: {n} fights qualify, {min} are needed. The estimate is held at about zero.", { name: t.name(imp.person.name), n: imp.informative, min: MIN_INFORMATIVE_FIGHTS })}</p>
        ) : (
          <div className="grid items-center gap-4 md:grid-cols-[minmax(0,1fr)_14rem]">
            <div>
              <div className="font-display text-4xl font-bold tabular text-gold">{sign(imp.effect)} <span className="text-lg text-muted">Elo</span></div>
              <div className="text-sm">{t(VERDICT_LABEL[imp.verdict])}</div>
              <p className="mt-2 text-sm text-muted">{t("Against an average head trainer, after allowing for each fighter’s own ability. The 95% range runs from {lo} to {hi}. Based on {fights} fights of {n} fighters, {informative} of them from fighters who have also worked with someone else.", { lo: sign(imp.effect - 1.96 * imp.se), hi: sign(imp.effect + 1.96 * imp.se), fights: imp.fights, n: imp.fighters, informative: imp.informative })}</p>
            </div>
            <ImpactRange impact={imp} height={40} />
          </div>
        )}
        <p className="mt-3 text-xs text-muted">{t("An estimate, not a verdict: fighters do not change trainer at random, and most trainers cannot be told from average. See how it is worked out.")} <Link href="/trainers" className="underline decoration-dotted hover:text-ink">{t("Trainer impact")}</Link></p>
      </div>
      {(arrived.length > 0 || left.length > 0) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {arrived.length > 0 && <div className="card p-5"><div className="eyebrow mb-2">{t("Fighters who joined")}</div><MoveTable rows={arrived} kind="arrived" /></div>}
          {left.length > 0 && <div className="card p-5"><div className="eyebrow mb-2">{t("Fighters who left")}</div><MoveTable rows={left} kind="left" /><p className="mt-2 text-xs text-muted">{t("For someone who left, a fall in rating afterwards counts in the trainer’s favour.")}</p></div>}
        </div>
      )}
      {ud && ud.underdogFights >= 5 && (
        <p className="card p-5 text-sm">{t("As underdogs (under 40% by their ratings) their fighters have won {wins} of {n} fights, where the ratings expected {expected}.", { wins: ud.wins, n: ud.underdogFights, expected: ud.expected.toFixed(1) })}</p>
      )}
    </section>
  );
}
