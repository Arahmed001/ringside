"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "@/components/L";
import { useLocale, useT } from "@/components/i18n";
import { api } from "@/lib/useAccount";
import type { MyStanding, Recap } from "@/lib/accounts/leaderboard";

/** A signed-in person's own place on the pick'em board, and what was graded since they last looked. Only they see this: it counts even if they are hidden from the board. */
export function PickStanding() {
  const t = useT();
  const locale = useLocale();
  const [data, setData] = useState<{ standing: MyStanding; recap: Recap | null } | null>(null);
  const load = useCallback(() => { void api<{ standing: MyStanding; recap: Recap | null }>(`/api/account/standing?lang=${locale}`, "GET").then((r) => { if (r.ok) setData({ standing: r.data.standing, recap: r.data.recap }); }); }, [locale]);
  useEffect(() => { load(); }, [load]);
  if (!data) return null;
  const { standing: s, recap } = data;
  const one = (x: number) => x.toFixed(1);
  async function seen() { if (!recap) return; await api("/api/account/standing", "POST", { through: recap.through }); setData({ standing: s, recap: null }); }

  return (
    <div className="space-y-4">
      {recap && (
        <section className="card border-gold/40 p-5" aria-labelledby="recap-h">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="eyebrow">{t("Since you last looked")}</div>
              <h2 id="recap-h" className="font-display text-2xl font-bold uppercase">{t("{right} right, {wrong} wrong", { right: recap.right, wrong: recap.wrong })}</h2>
            </div>
            <button onClick={() => void seen()} className="rounded-xl border border-line bg-panel2 px-4 py-2 text-sm transition hover:border-white/30">{t("Got it")}</button>
          </div>
          <ul className="mt-3 space-y-1.5 text-sm">
            {recap.items.map((i) => (
              <li key={i.boutId} className="flex flex-wrap items-baseline justify-between gap-x-3">
                <Link href={`/bouts/${i.boutId}`} className="underline decoration-dotted hover:text-gold">{i.fight}</Link>
                <span className="text-muted">{t("You: {name}", { name: i.pick })} · <span className={i.right ? "text-win" : "text-red-ink"}>{i.right ? t("Right") : t("Wrong")}</span></span>
              </li>
            ))}
          </ul>
          {recap.right + recap.wrong > recap.items.length && <p className="mt-2 text-xs text-muted">{t("And {n} more below.", { n: recap.right + recap.wrong - recap.items.length })}</p>}
        </section>
      )}
      {s.graded + s.pending > 0 && (
        <section className="card p-5" aria-labelledby="place-h">
          <div className="eyebrow">{t("Your place")}</div>
          <h2 id="place-h" className="font-display text-3xl font-bold uppercase">
            {s.rank !== null ? t("#{rank} of {n} players", { rank: s.rank, n: s.ranked }) : t.n(s.stillNeeded, "{n} more graded pick and you are ranked", "{n} more graded picks and you are ranked")}
          </h2>
          <p className="mt-1 text-sm text-ink/90">
            {s.graded ? t("{points} points from {graded} graded picks ({per} a pick).", { points: one(s.points), graded: s.graded, per: s.perPick.toFixed(2) }) : t("Nothing graded yet.")}
            {s.model && s.model.fights >= 3 && <> {t("The model scores {points} on the {n} of those fights it called.", { points: one(s.model.points), n: s.model.fights })}</>}
          </p>
          {!s.public && <p className="mt-2 text-xs text-muted">{t("You are hidden from the leaderboard, so only you see this.")} <Link href="/account" className="underline decoration-dotted hover:text-ink">{t("Change that")}</Link></p>}
          {s.public && <p className="mt-2 text-xs text-muted"><Link href="/leaderboard" className="underline decoration-dotted hover:text-ink">{t("See the leaderboard")}</Link></p>}
        </section>
      )}
    </div>
  );
}
