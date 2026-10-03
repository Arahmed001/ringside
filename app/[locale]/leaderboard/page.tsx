import Link from "@/components/L";
import { getT } from "@/lib/i18n/server";
import { metaFor } from "@/lib/seo-server";
import { getDb } from "@/lib/db";
import { getWorld } from "@/lib/world";
import { leaderboardCached, MIN_RANKED } from "@/lib/accounts/leaderboard";
import { accountsDbIfAny } from "@/lib/accounts/store";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => metaFor(params, (p, t) => ({
  path: "/leaderboard", title: t("Pick’em leaderboard"),
  description: t("Who calls fights best: scored on graded picks, with the Ringside model on the same fights as the bar to beat."), noindex: true,
}));

export default async function Leaderboard() {
  const t = await getT();
  const acc = accountsDbIfAny();
  const lb = acc ? leaderboardCached(await getDb(), await getWorld(), t, acc) : null;
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const pts = (x: number) => x.toFixed(1);
  return (
    <div className="space-y-8">
      <div>
        <div className="eyebrow mb-2">{t("Fight night pick’em")}</div>
        <h1 className="font-display text-5xl font-extrabold uppercase">{t("Pick’em leaderboard")}</h1>
        <p className="mt-2 max-w-2xl text-muted">{t("Everyone’s graded picks, scored the same way. Sign in and call the card to join.")}</p>
      </div>

      <section className="card max-w-3xl space-y-2 p-5 text-sm text-ink/90">
        <h2 className="eyebrow">{t("How it is scored")}</h2>
        <p>{t("A right pick scores 1 point plus the model’s doubt about it: calling an 80% favourite right is worth 1.2, calling the 20% underdog right is worth 1.8. A wrong pick scores 0.")}</p>
        <p>{t("The likelier side is always the better pick on average, so there is nothing to gain from backing underdogs to look bold. Picks lock when fight day begins, and only graded fights count (not draws, no-contests or cancellations).")}</p>
        <p className="text-xs text-muted">{t("You are ranked after {n} graded picks. People who turned their picks private are not listed.", { n: MIN_RANKED })}</p>
      </section>

      {!lb || (!lb.standings.length && !lb.unranked) ? (
        <div className="card p-6">
          <p className="text-muted">{t("Nobody is on the board yet. Be the first: create an account and call the next card.")}</p>
          <p className="mt-3 flex flex-wrap gap-2"><Link href="/account" className="chip !border-gold/40 hover:!text-gold">{t("Create an account")}</Link><Link href="/" className="chip hover:!text-gold">{t("Call the card")}</Link></p>
        </div>
      ) : (
        <section aria-labelledby="board">
          <h2 id="board" className="sr-only">{t("Standings")}</h2>
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm" aria-label={t("Pick’em standings")}>
              <thead className="text-xs uppercase tracking-widest text-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 text-start">{t("Rank")}</th>
                  <th scope="col" className="px-4 py-3 text-start">{t("Name")}</th>
                  <th scope="col" className="px-4 py-3 text-end">{t("Points")}</th>
                  <th scope="col" className="px-4 py-3 text-end">{t("Record")}</th>
                  <th scope="col" className="px-4 py-3 text-end">{t("Right")}</th>
                  <th scope="col" className="px-4 py-3 text-end">{t("Per pick")}</th>
                  <th scope="col" className="px-4 py-3 text-end">{t("Best streak")}</th>
                </tr>
              </thead>
              <tbody>
                {lb.model && (
                  <tr className="border-t border-line bg-gold/5">
                    <td className="px-4 py-2.5 text-muted">–</td>
                    <th scope="row" className="px-4 py-2.5 text-start font-semibold text-gold">{t("The Ringside model")}<span className="block text-xs font-normal text-muted">{t("Same rule, on the {n} fights the field called", { n: lb.model.fights })}</span></th>
                    <td className="px-4 py-2.5 text-end tabular">{pts(lb.model.points)}</td>
                    <td className="px-4 py-2.5 text-end tabular">{lb.model.right}-{lb.model.graded - lb.model.right}</td>
                    <td className="px-4 py-2.5 text-end tabular">{pct(lb.model.accuracy)}</td>
                    <td className="px-4 py-2.5 text-end tabular">{lb.model.perPick.toFixed(2)}</td>
                    <td className="px-4 py-2.5 text-end text-muted">–</td>
                  </tr>
                )}
                {lb.standings.map((s) => (
                  <tr key={s.username} className="border-t border-line">
                    <td className="px-4 py-2.5 tabular">{s.rank}</td>
                    <th scope="row" className="px-4 py-2.5 text-start font-semibold">{s.username}</th>
                    <td className="px-4 py-2.5 text-end tabular">{pts(s.points)}</td>
                    <td className="px-4 py-2.5 text-end tabular">{s.right}-{s.graded - s.right}</td>
                    <td className="px-4 py-2.5 text-end tabular">{pct(s.accuracy)}</td>
                    <td className="px-4 py-2.5 text-end tabular">{s.perPick.toFixed(2)}</td>
                    <td className="px-4 py-2.5 text-end tabular">{s.bestStreak}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {lb.unranked > 0 && <p className="mt-3 text-xs text-muted">{t.n(lb.unranked, "{n} more player has fewer than {min} graded picks and is not ranked yet.", "{n} more players have fewer than {min} graded picks and are not ranked yet.", { min: MIN_RANKED })}</p>}
        </section>
      )}
    </div>
  );
}
