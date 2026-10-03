import Link from "@/components/L";
import { getWorld } from "@/lib/world";
import { dreamFight, fightsToMake, suggestOpponents } from "@/lib/matchmaking";
import { resolveFighter } from "@/lib/fighter-search";
import { getNames } from "@/lib/i18n/names";
import { getT } from "@/lib/i18n/server";
import { metaFor } from "@/lib/seo-server";
import { FighterPicker } from "@/components/FighterPicker";
import { PairingCard } from "@/components/Matchmaking";
import { Headshot } from "@/components/Portrait";
import { SectionTitle } from "@/components/ui";
import { divisionLabel } from "@/lib/divisions";
import { fmtDate, methodLabel } from "@/lib/format";
import { recordStr } from "@/lib/world";
import type { BoxerFull } from "@/lib/types";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => metaFor(params, (p, t) => ({
  path: "/matchmaking", title: t("Matchmaking"),
  description: t("The fights worth making right now, who any fighter should face next, and a dream-fight builder. Every pairing is scored on how close, relevant, entertaining, bookable, fresh and meaningful it would be."),
}));

type SP = { a?: string; aq?: string; x?: string; xq?: string; y?: string; yq?: string };

export default async function Matchmaking({ searchParams }: { searchParams: Promise<SP> }) {
  const t = await getT();
  const sp = await searchParams;
  const w = await getWorld();
  const names = await getNames(t.locale);
  const subject = resolveFighter(w, sp.a, sp.aq, 4, names);
  const X = resolveFighter(w, sp.x, sp.xq, 1, names), Y = resolveFighter(w, sp.y, sp.yq, 1, names);
  const now = fightsToMake(w, 8, t);
  const next = subject ? suggestOpponents(w, subject, 6, t) : [];
  const dream = X && Y && X.id !== Y.id ? dreamFight(w, X, Y, t) : null;
  const init = (f: BoxerFull | undefined, typed?: string) => (f ? { slug: f.slug, name: t.name(f.name) } : typed ? { slug: "", name: typed } : undefined);

  return (
    <div className="space-y-12">
      <div>
        <div className="eyebrow mb-2">{t("Make the fight")}</div>
        <h1 className="font-display text-5xl font-extrabold uppercase">{t("Matchmaking")}</h1>
        <p className="mt-2 max-w-3xl text-muted">{t("Who should fight whom. Each pairing gets a fight score from six things: how close the model thinks it is, how relevant the two are to each other, whether their styles make a show, whether both can be booked now, whether they have met, and what is at stake (a unification or a title fight).")}</p>
        <div className="mt-4 flex flex-wrap gap-2 text-sm">
          <Link href="/compare" className="chip hover:text-ink">{t("Predict any fight")}</Link>
          <span className="chip !border-gold/50 !text-gold">{t("Matchmaking")}</span>
          <Link href="/titles" className="chip hover:text-ink">{t("Title lineages")}</Link>
        </div>
      </div>

      <section>
        <SectionTitle eyebrow={t("Across every division")} title={t("Fights to make right now")} />
        {now.length ? (
          <div className="grid gap-5 md:grid-cols-2">{now.map((p, i) => <PairingCard key={`${p.a.id}-${p.b.id}`} p={p} rank={i + 1} division={p.division} />)}</div>
        ) : <p className="card p-6 text-muted">{t("Not enough available top fighters to suggest a fight.")}</p>}
        <p className="mt-3 max-w-3xl text-xs text-muted">{t("From the top eight available fighters in each division (active, not already booked, not training partners). One best fight per division; the strongest eight overall are shown. It is a model's view, not a promoter's.")}</p>
      </section>

      <section id="next">
        <SectionTitle eyebrow={t("Pick a fighter")} title={t("Who should he fight next?")} />
        <form className="card grid gap-3 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
          <FighterPicker key={`a:${subject?.slug ?? sp.aq ?? ""}`} name="a" label="" placeholder={t("Search for a fighter…")} minBouts={4} initial={init(subject, sp.aq)} />
          <button className="rounded-xl bg-red-btn px-6 text-white py-2.5 font-display text-lg font-bold uppercase transition hover:brightness-90">{t("Suggest opponents")}</button>
        </form>
        {(sp.a || sp.aq) && !subject && <p className="mt-3 text-sm text-muted">{t("No fighter with 4+ bouts matches that.")}</p>}
        {subject && (
          <div className="mt-5">
            <div className="mb-3 flex items-center gap-3">
              <Headshot boxer={subject} size={48} />
              <div>
                <div className="font-display text-2xl font-bold leading-tight">{t.name(subject.name)}</div>
                <div className="text-xs text-muted"><span className="tabular">{recordStr(subject)}</span> · {divisionLabel(subject.weightClass, subject.sex, t)} · Elo {Math.round(subject.rating)}</div>
              </div>
            </div>
            {next.length ? (
              <div className="grid gap-5 md:grid-cols-2">{next.map((p, i) => <PairingCard key={p.b.id} p={p} rank={i + 1} />)}</div>
            ) : <p className="card p-6 text-muted">{t("Nobody suitable is available: everyone nearby is booked, retired, a training partner or too far away in rating.")}</p>}
          </div>
        )}
      </section>

      <section id="dream">
        <SectionTitle eyebrow={t("Any two fighters, any era")} title={t("Dream-fight builder")} />
        <form className="card grid gap-3 p-4 sm:grid-cols-[1fr_auto_1fr_auto] sm:items-center">
          <FighterPicker key={`x:${X?.slug ?? sp.xq ?? ""}`} name="x" label="" placeholder={t("Fighter in the red corner…")} minBouts={1} initial={init(X, sp.xq)} />
          <span className="hidden font-display text-xl font-bold text-gold sm:block">{t("VS")}</span>
          <FighterPicker key={`y:${Y?.slug ?? sp.yq ?? ""}`} name="y" label="" placeholder={t("Fighter in the blue corner…")} minBouts={1} initial={init(Y, sp.yq)} />
          <button className="rounded-xl bg-red-btn px-6 text-white py-2.5 font-display text-lg font-bold uppercase transition hover:brightness-90">{t("Build it")}</button>
        </form>
        {dream && (
          <div className="mt-5 grid gap-5 lg:grid-cols-[1.2fr_1fr]">
            <div className="space-y-5">
              <PairingCard p={dream.p} />
              <div className="card p-5">
                <div className="eyebrow mb-3">{t("Why it might never happen")}</div>
                {dream.flags.length || dream.catchweight ? (
                  <ul className="flex flex-wrap gap-2 text-xs">
                    {dream.flags.map((f) => <li key={f} className="chip !border-red/40 !text-red-ink">{f}</li>)}
                    {dream.catchweight && <li className="chip !border-gold/40 !text-gold">{dream.catchweight}</li>}
                  </ul>
                ) : <p className="text-sm text-muted">{t("Nothing stands in the way: same division, both active, free to be booked.")}</p>}
              </div>
            </div>
            <div className="space-y-5">
              <div className="card p-5">
                <div className="eyebrow mb-3">{t("Have they met?")}</div>
                {dream.p.meetings.length ? (
                  <ul className="space-y-2 text-sm">
                    {dream.p.meetings.map((m) => (
                      <li key={m.id}><Link href={`/bouts/${m.id}`} className="hover:text-gold">
                        {fmtDate(m.date, undefined, t.locale)}: <b>{m.winnerId ? t.name(m.winnerId === m.redId ? m.redName : m.blueName) : t("Draw")}</b> {m.winnerId ? t("won by {method}", { method: methodLabel(m.method, m.endRound, t) }) : ""}
                      </Link></li>
                    ))}
                  </ul>
                ) : <p className="text-sm text-muted">{t("They have never fought each other.")}</p>}
              </div>
              <div className="card p-5">
                <div className="eyebrow mb-3">{t("Common opponents")}</div>
                {dream.common.length ? (
                  <table className="w-full text-sm" aria-label={t("Common opponents")}>
                    <thead><tr className="text-xs font-normal uppercase tracking-widest text-muted"><th className="py-1 text-start font-normal">{t("Opponent")}</th><th className="text-start font-normal">{t.name(dream.p.a.name)}</th><th className="text-start font-normal">{t.name(dream.p.b.name)}</th></tr></thead>
                    <tbody>
                      {dream.common.map((c) => {
                        const res = (f: BoxerFull, m: typeof c.a) => (m.winnerId === null ? t("Draw") : m.winnerId === f.id ? `${t("W")} ${methodLabel(m.method, m.endRound, t)}` : `${t("L")} ${methodLabel(m.method, m.endRound, t)}`);
                        return (
                          <tr key={c.opponent.id} className="border-t border-line/60">
                            <td className="py-2"><Link href={`/boxers/${c.opponent.slug}`} className="hover:text-gold">{t.name(c.opponent.name)}</Link></td>
                            <td className={c.a.winnerId === dream.p.a.id ? "text-win" : c.a.winnerId === null ? "text-muted" : "text-red-ink"}>{res(dream.p.a, c.a)}</td>
                            <td className={c.b.winnerId === dream.p.b.id ? "text-win" : c.b.winnerId === null ? "text-muted" : "text-red-ink"}>{res(dream.p.b, c.b)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : <p className="text-sm text-muted">{t("No opponent in common.")}</p>}
              </div>
            </div>
          </div>
        )}
        {(sp.x || sp.xq || sp.y || sp.yq) && !dream && <p className="mt-3 text-sm text-muted">{t("Pick two different fighters to build the fight.")}</p>}
      </section>
    </div>
  );
}
