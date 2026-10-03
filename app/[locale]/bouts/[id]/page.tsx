import Link from "@/components/L";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { getWorld, recordStr } from "@/lib/world";
import { Headshot } from "@/components/Portrait";
import { ScoreCards } from "@/components/ScoreCards";
import { PunchStats } from "@/components/PunchStats";
import { SectionTitle } from "@/components/ui";
import { flag, fmtDate, methodLabel } from "@/lib/format";
import { getT } from "@/lib/i18n/server";
import { metaFor } from "@/lib/seo-server";
import type { T } from "@/lib/i18n/t";
import { METHOD_NAME, endsEarly } from "@/lib/methods";
import { divisionLabel } from "@/lib/divisions";
import type { PunchLine } from "@/lib/types";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string; id: string }> }) => metaFor(params, async ({ id }, t) => {
  const w = await getWorld();
  const b = w.boutById.get(Number(id));
  if (!b) notFound();
  const red = w.byId.get(b.redId)!, blue = w.byId.get(b.blueId)!, ev = w.eventById.get(b.eventId)!;
  const v = { red: t.name(red.name), blue: t.name(blue.name), division: divisionLabel(b.weightClass, red.sex, t), event: t.name(ev.name), city: t.name(ev.city), date: fmtDate(ev.date, undefined, t.locale), rounds: b.rounds };
  return {
    path: `/bouts/${id}`, title: t("{red} vs {blue}", v),
    description: b.method
      ? t("{red} vs {blue}, a {rounds}-round {division} bout at {event} in {city} on {date}. Result: {result}, with scorecards, weigh-ins and punch stats.", { ...v, result: methodLabel(b.method, b.endRound, t) })
      : t("{red} vs {blue}, a {rounds}-round {division} bout at {event} in {city} on {date}. Win probability, weigh-ins and head-to-head on Ringside.", v),
  };
});

type Fighter = NonNullable<Awaited<ReturnType<typeof getWorld>>["byId"] extends Map<number, infer V> ? V : never>;

async function Side({ f, color, win }: { f: Fighter; color: string; win: boolean }) {
  const t = await getT();
  return (
    <Link href={`/boxers/${f.slug}`} className="flex flex-col items-center gap-2 text-center">
      <div className="relative"><Headshot boxer={f} size={110} />{win && <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-win px-2 py-0.5 text-xs font-bold text-bg">{t("WINNER")}</span>}</div>
      <div className="font-display text-3xl font-bold leading-tight" style={{ color }}>{t.name(f.name)}</div>
      <div className="text-xs text-muted">{flag(f.country)} {recordStr(f)} · {t(f.stance)}</div>
    </Link>
  );
}

const lb = (t: T, n: number | null) => (n === null ? "–" : t("{n} lb", { n: n.toFixed(1) }));
const implied = (a: number | null, b: number | null) => (a && b ? (1 / a) / (1 / a + 1 / b) : null);

export default async function BoutPage({ params }: { params: Promise<{ id: string }> }) {
  const t = await getT();
  const { id } = await params;
  const w = await getWorld();
  const b = w.boutById.get(Number(id));
  if (!b) notFound();
  const red = w.byId.get(b.redId)!, blue = w.byId.get(b.blueId)!;
  const ev = w.eventById.get(b.eventId)!;
  const body = b.titleOrgId ? w.orgs.get(b.titleOrgId) : null;
  const wins = w.weighInsByBout.get(b.id) ?? [];
  const wr = wins.find((x) => x.boxerId === red.id), wb = wins.find((x) => x.boxerId === blue.id);
  const offs = w.officialsByBout.get(b.id) ?? [];
  const ref = offs.find((o) => o.role === "referee");
  const cards = (w.scorecardsByBout.get(b.id) ?? []).map((c) => ({ seat: c.seat, judge: w.people.get(c.judgeId)?.name ?? "?", judgeSlug: w.people.get(c.judgeId)?.slug ?? "", red: c.red, blue: c.blue }));
  const corners = w.cornersByBout.get(b.id) ?? [];
  const pre = w.boutPre.get(b.id);
  const eloP = pre ? 1 / (1 + Math.pow(10, (pre.blue - pre.red) / 400)) : null;
  const mkt = implied(b.oddsRed, b.oddsBlue);
  const db = await getDb();
  const punches = (db.prepare("SELECT bout_id AS boutId, boxer_id AS boxerId, round, thrown, landed, power_thrown AS powerThrown, power_landed AS powerLanded, jab_thrown AS jabThrown, jab_landed AS jabLanded FROM punch_stats WHERE bout_id = ? ORDER BY round").all(b.id)) as unknown as PunchLine[];
  const winner = b.winnerId ? (b.winnerId === red.id ? red : blue) : null;
  const surname = (n: string) => t.name(n).split(" ").slice(-1)[0];
  const missed = (name: string, x: { officialLb: number | null; limitLb: number | null }) => t("{name} (+{n} lb)", { name: t.name(name), n: ((x.officialLb ?? 0) - (x.limitLb ?? 0)).toFixed(1) });
  const trainerOf = (boxerId: number) => { const c = corners.find((x) => x.boxerId === boxerId && x.role === "head_trainer"); return c ? w.people.get(c.personId) : null; };

  return (
    <div className="space-y-10">
      <section className="rise">
        <h1 className="sr-only">{t("{a} vs {b}", { a: t.name(red.name), b: t.name(blue.name) })}</h1>
        <div className="eyebrow mb-2">
          <Link href={`/events/${ev.id}`} className="hover:text-ink">{t.name(ev.name)}</Link> · {fmtDate(ev.date, undefined, t.locale)} · {t.name(ev.venue)}, {t.name(ev.city)}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/rankings/${b.weightClass.toLowerCase().replace(/\s+/g, "-")}${red.sex === "female" ? "?sex=female" : ""}`} className="chip">{divisionLabel(b.weightClass, red.sex, t)}</Link>
          <span className="chip">{t.n(b.rounds, "{n} round", "{n} rounds")}</span>
          {b.contractLb && <span className="chip !border-gold/40 !text-gold">{t("Catchweight {n} lb", { n: b.contractLb })}</span>}
          {b.title && <span className="chip !border-gold/50 !text-gold">{body ? <Link href={`/orgs/${body.slug}`}>{body.name.match(/\(([^)]+)\)/)?.[1] ?? body.name}</Link> : null} {b.titleVacant ? t("{title} (vacant)", { title: b.title }) : b.title}</span>}
          {ev.broadcaster && <span className="chip">{t.name(ev.broadcaster)}</span>}
          {ev.attendance && <span className="chip">{t("{n} attended", { n: ev.attendance.toLocaleString("en-US") })}</span>}
        </div>

        {b.upcoming && b.status !== "cancelled" && <p className="mt-4 text-sm"><Link href={`/previews/${b.id}`} className="chip !border-gold/40 hover:!text-gold">{t("Read the preview")}</Link></p>}
        <div className="card mt-5 p-6">
          <div className="ltr-fixed grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4">
            <Side f={red} color="#e5322d" win={winner?.id === red.id} />
            <div className="text-center">
              <div className="font-display text-3xl font-extrabold text-gold">{t("VS")}</div>
              {b.method && (
                <div className="mt-3">
                  <div className="font-display text-2xl font-bold">{methodLabel(b.method, b.endRound, t)}</div>
                  {t(METHOD_NAME[b.method]) !== methodLabel(b.method, b.endRound, t) && <div className="text-xs text-muted">{t(METHOD_NAME[b.method])}</div>}
                  {b.endRound && <div className="text-xs text-muted">{b.method === "RTD" ? t("Retired after round {r}", { r: b.endRound }) : endsEarly(b.method) ? (b.roundTime ? t("Round {r}, {time}", { r: b.endRound, time: b.roundTime }) : t("Round {r}", { r: b.endRound })) : t.n(b.rounds, "{n} round", "{n} rounds")}</div>}
                </div>
              )}
            </div>
            <Side f={blue} color="#4a8cff" win={winner?.id === blue.id} />
          </div>
          {(b.kdRed > 0 || b.kdBlue > 0) && (
            <div className="mt-5 flex justify-center gap-2 text-xs">
              {b.kdRed > 0 && <span className="chip !border-red/50 !text-red-ink">{t("{name} down {n}×", { name: surname(red.name), n: b.kdRed })}</span>}
              {b.kdBlue > 0 && <span className="chip !border-blue/50 !text-blue">{t("{name} down {n}×", { name: surname(blue.name), n: b.kdBlue })}</span>}
            </div>
          )}
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <div className="card p-5">
          <div className="eyebrow mb-3">{t("Weigh-in")}</div>
          {wr && wb ? (
            <div className="overflow-hidden rounded-xl border border-line/60 text-sm">
              {([
                [t("Official weight"), lb(t, wr.officialLb), lb(t, wb.officialLb)],
                [t("Limit"), lb(t, wr.limitLb), lb(t, wb.limitLb)],
                [t("Fight night"), lb(t, wr.fightNightLb), lb(t, wb.fightNightLb)],
                [t("Rehydration"), wr.fightNightLb && wr.officialLb ? t("+{n} lb", { n: (wr.fightNightLb - wr.officialLb).toFixed(1) }) : "–", wb.fightNightLb && wb.officialLb ? t("+{n} lb", { n: (wb.fightNightLb - wb.officialLb).toFixed(1) }) : "–"],
              ] as [string, string, string][]).map(([k, x, y]) => (
                <div key={k} className="ltr-fixed grid grid-cols-3 items-center border-t border-line/60 px-4 py-2 first:border-0"><span className="tabular font-semibold">{x}</span><span className="text-center text-xs uppercase tracking-widest text-muted">{k}</span><span className="text-end tabular font-semibold">{y}</span></div>
              ))}
              {(wr.madeWeight === false || wb.madeWeight === false) && (
                <div className="border-t border-line/60 bg-red/10 px-4 py-2 text-xs text-red-ink">
                  {wr.madeWeight === false && wb.madeWeight === false
                    ? t("Missed weight: {a} and {b}", { a: missed(red.name, wr), b: missed(blue.name, wb) })
                    : t("Missed weight: {a}", { a: wr.madeWeight === false ? missed(red.name, wr) : missed(blue.name, wb) })}
                </div>
              )}
              {wr.fightNightLb && wb.fightNightLb && Math.abs(wr.fightNightLb - wb.fightNightLb) >= 4 && (
                <div className="border-t border-line/60 px-4 py-2 text-xs text-muted">{t("{name} weighed {n} lb more on fight night.", { name: t.name((wr.fightNightLb > wb.fightNightLb ? red : blue).name), n: Math.abs(wr.fightNightLb - wb.fightNightLb).toFixed(1) })}</div>
              )}
            </div>
          ) : <p className="text-sm text-muted">{t("No weigh-in data recorded for this bout yet.")}</p>}
        </div>

        <div className="card p-5">
          <div className="eyebrow mb-3">{t("Corners & officials")}</div>
          <dl className="space-y-2 text-sm">
            {[[red, "#e5322d"], [blue, "#4a8cff"]].map(([f, c]) => {
              const fr = f as typeof red; const tr = trainerOf(fr.id);
              return <div key={fr.id} className="flex justify-between gap-3"><dt className="text-muted">{t.rich("<c>{name}</c> head trainer", { name: t.name(fr.name), c: (ch) => <span style={{ color: c as string }}>{ch}</span> })}</dt><dd>{tr ? <Link href={`/people/${tr.slug}`} className="hover:text-gold">{t.name(tr.name)}</Link> : "–"}</dd></div>;
            })}
            <div className="flex justify-between gap-3 border-t border-line/60 pt-2"><dt className="text-muted">{t("Referee")}</dt><dd>{ref ? <Link href={`/people/${w.people.get(ref.personId)?.slug}`} className="hover:text-gold">{t.name(w.people.get(ref.personId)?.name ?? "")}</Link> : "–"}</dd></div>
            {cards.length === 0 && offs.filter((o) => o.role === "judge").map((o) => <div key={o.personId} className="flex justify-between gap-3"><dt className="text-muted">{t("Judge {n}", { n: o.seat ?? "" })}</dt><dd>{t.name(w.people.get(o.personId)?.name ?? "")}</dd></div>)}
          </dl>
          {oddsBlock(t, b.oddsRed, b.oddsBlue, mkt, eloP)}
        </div>
      </section>

      {cards.length > 0 && (
        <section><SectionTitle eyebrow={t("Official result")} title={t("Scorecards")} /><div className="card p-5"><ScoreCards cards={cards} redName={t.name(red.name)} blueName={t.name(blue.name)} /></div></section>
      )}

      {punches.length > 0 && (
        <section><SectionTitle eyebrow={t("Fight stats")} title={t("Punch statistics")} /><div className="card p-5"><PunchStats lines={punches} redId={red.id} blueId={blue.id} redName={t.name(red.name)} blueName={t.name(blue.name)} /></div></section>
      )}
    </div>
  );
}

function oddsBlock(t: T, oddsRed: number | null, oddsBlue: number | null, mkt: number | null, elo: number | null) {
  if (!oddsRed || !oddsBlue) return null;
  return (
    <div className="mt-4 border-t border-line/60 pt-3 text-sm">
      <div className="mb-1 flex justify-between"><span className="text-muted">{t("Closing odds")}</span><span className="tabular"><b className="text-red-ink">{oddsRed.toFixed(2)}</b> / <b className="text-blue">{oddsBlue.toFixed(2)}</b></span></div>
      {mkt !== null && <div className="flex justify-between text-xs text-muted"><span>{t("Market implied (red)")}</span><span className="tabular">{Math.round(mkt * 100)}%{elo !== null ? ` · ${t("Elo says {n}%", { n: Math.round(elo * 100) })}` : ""}</span></div>}
    </div>
  );
}
