import Link from "@/components/L";
import type { World } from "@/lib/world";
import { Headshot } from "./Portrait";
import { PARTS, PART_LABEL, TIER_LABEL, WEIGHTS, fightOfTheYear, fightRank, fightReasons, resultLine, tier, type FightScore } from "@/lib/fight-score";
import { listDef, recordsOf } from "@/lib/records";
import { fmtDate, methodLabel } from "@/lib/format";
import { getT } from "@/lib/i18n/server";

export async function ScoreBadge({ score, className = "" }: { score: number; className?: string }) {
  const t = await getT();
  return <span className={`chip whitespace-nowrap !border-gold/40 !text-gold ${className}`} title={t("Fight score out of 100: knockdowns, finish, action, matchup, upset, stakes and comebacks")}>{t(TIER_LABEL[tier(score)])} · {score}</span>;
}

/** One fight's score taken apart: seven bars, each with its weight, and the sentences that explain the strongest ones. */
export async function ScoreBreakdown({ w, s }: { w: World; s: FightScore }) {
  const t = await getT();
  const reasons = fightReasons(w, s, t, 5);
  return (
    <div className="grid gap-6 md:grid-cols-[1.1fr_1fr]">
      <div>
        <div className="eyebrow mb-3">{t("Why it scored this way")}</div>
        {reasons.length ? <ul className="space-y-2 text-sm">{reasons.map((r) => <li key={r.kind} className="flex gap-2"><span className="text-gold" aria-hidden>●</span><span>{r.text}</span></li>)}</ul>
          : <p className="text-sm text-muted">{t("No single thing stood out; the score is a little of everything.")}</p>}
      </div>
      <div>
        <div className="eyebrow mb-3">{t("The score, part by part")}</div>
        <ul className="space-y-1.5 text-xs">
          {PARTS.map((k) => {
            const v = s.parts[k];
            return (
              <li key={k} className="grid grid-cols-[6.5rem_1fr_2.2rem] items-center gap-2">
                <span className="text-muted">{t(PART_LABEL[k])} <span className="tabular opacity-70">{Math.round(WEIGHTS[k] * 100)}%</span></span>
                <span className="ltr-fixed h-1.5 overflow-hidden rounded-full bg-panel2" role="presentation"><span className="block h-full rounded-full bg-gold" style={{ width: `${(v ?? 0) * 100}%` }} /></span>
                <span className="tabular text-end">{v === null ? "–" : Math.round(v * 100)}</span>
              </li>
            );
          })}
        </ul>
        {s.coverage < 0.999 && <p className="mt-2 text-xs text-muted">{t("A dash means that part could not be worked out for this fight (no statistics or scorecards); the others were scaled up to cover it.")}</p>}
      </div>
    </div>
  );
}

/** The two fighters, the result and the score: the head of a fight-of-the-year entry. */
export async function FightHero({ w, s, label }: { w: World; s: FightScore; label?: string }) {
  const t = await getT();
  const b = s.bout;
  const red = w.byId.get(b.redId)!, blue = w.byId.get(b.blueId)!;
  const winner = b.winnerId;
  return (
    <section className="card p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="eyebrow">{label}</div>
        <ScoreBadge score={s.score} />
      </div>
      <div className="ltr-fixed grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4">
        {[red, blue].map((f, i) => (
          <Link key={f.id} href={`/boxers/${f.slug}`} className={`flex min-w-0 flex-col items-center gap-2 text-center ${i === 1 ? "order-3" : ""}`}>
            <Headshot boxer={f} size={96} />
            <div className="w-full text-balance break-words font-display text-xl font-bold leading-tight sm:text-3xl" dir="auto" style={{ color: i === 0 ? "#e5322d" : "#4a8cff" }}>{winner === f.id && <span aria-label={t("Winner")}>✓ </span>}{t.name(f.name)}</div>
          </Link>
        ))}
        <div className="order-2 text-center">
          <div className="font-display text-2xl font-extrabold text-gold">{t("VS")}</div>
          <div className="mt-1 text-xs tabular text-muted">{methodLabel(b.method, b.endRound, t)}</div>
        </div>
      </div>
      <p className="mt-4 text-center text-sm text-muted">{resultLine(w, b, t)} · <Link href={`/events/${b.eventId}`} className="hover:text-ink">{t.name(b.eventName)}</Link> · {fmtDate(b.date, undefined, t.locale)} · <Link href={`/bouts/${b.id}`} className="text-ink hover:text-gold">{t("Full bout details")}</Link></p>
      <div className="mt-6 border-t border-line pt-5"><ScoreBreakdown w={w} s={s} /></div>
    </section>
  );
}

/** A ranked list of fights, compact. */
export async function FightList({ w, list, start = 1 }: { w: World; list: FightScore[]; start?: number }) {
  const t = await getT();
  return (
    <ol className="divide-y divide-line/60">
      {list.map((s, i) => {
        const b = s.bout;
        const reasons = fightReasons(w, s, t, 2);
        return (
          <li key={b.id} className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-start gap-3 py-3">
            <span className="font-display text-xl font-bold text-muted tabular">{start + i}</span>
            <div className="min-w-0">
              <Link href={`/bouts/${b.id}`} className="font-semibold hover:text-gold">{t.name(b.redName)} <span className="text-muted">{t("vs")}</span> {t.name(b.blueName)}</Link>
              <div className="text-xs text-muted">{resultLine(w, b, t)} · {methodLabel(b.method, b.endRound, t)} · {fmtDate(b.date, { month: "short", day: "numeric", year: "numeric" }, t.locale)}</div>
              {reasons.length > 0 && <div className="mt-1 text-xs text-muted">{reasons.map((r) => r.text).join(" · ")}</div>}
            </div>
            <ScoreBadge score={s.score} />
          </li>
        );
      })}
    </ol>
  );
}

/** On a finished fight's page: its score, and where it stands among its year's fights when that is in the top ten. */
export async function BoutScore({ w, boutId }: { w: World; boutId: number }) {
  const t = await getT();
  const r = fightRank(w, boutId);
  if (!r) return null;
  return (
    <>
      <ScoreBadge score={r.score} />
      {r.rank <= 10 && <Link href={`/fight-of-the-year/${r.year}`} className="chip !border-gold/40 !text-gold hover:!text-ink">{r.rank === 1 ? t("Fight of the year {year}", { year: r.year }) : t("#{rank} fight of {year}", { rank: r.rank, year: r.year })}</Link>}
    </>
  );
}

/** On a fighter's page: fights of the year they won, and the all-time lists they are in the top ten of. */
export async function BoxerRecords({ w, boxerId }: { w: World; boxerId: number }) {
  const t = await getT();
  const awards = fightOfTheYear(w).filter((x) => x.top.bout.redId === boxerId || x.top.bout.blueId === boxerId);
  const lists = recordsOf(w, boxerId, 10);
  if (!awards.length && !lists.length) return null;
  return (
    <div className="mt-4 border-t border-line/60 pt-3">
      <div className="eyebrow mb-2">{t("Records and awards")}</div>
      <ul className="flex flex-wrap gap-1.5">
        {awards.map((a) => <li key={a.year}><Link href={`/fight-of-the-year/${a.year}`} className="chip !border-gold/50 !text-gold hover:!text-ink">{t("Fight of the year {year}", { year: a.year })}</Link></li>)}
        {lists.map((l) => <li key={l.id}><Link href={`/all-time/${l.id}`} className="chip hover:!text-ink"><span className="tabular text-gold">#{l.rank}</span> {t(listDef(l.id)!.title)}</Link></li>)}
      </ul>
    </div>
  );
}
