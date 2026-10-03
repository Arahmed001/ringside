import Link from "@/components/L";
import { ScrollRegion } from "@/components/ScrollRegion";
import { getWorld } from "@/lib/world";
import { SIGNS, TIER_AT, TIER_LABEL, recentShocks, signalLift, upsetRecord, upsetWatch, type Tier, type SignalKind } from "@/lib/upsets";
import { WatchCard } from "@/components/WatchCard";
import { SectionTitle, Stat } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { getT } from "@/lib/i18n/server";
import { metaFor } from "@/lib/seo-server";
import { msg } from "@/lib/i18n/t";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => metaFor(params, (p, t) => ({
  path: "/upset-watch", title: t("Upset watch"),
  description: t("Every upcoming fight ranked by how likely the underdog is to win, with the reasons, and how the same calls have fared in past fights."),
}));

const TIERS: Tier[] = ["live", "longshot", "toss-up"];
const SIGN_NAME: Partial<Record<SignalKind, string>> = {
  layoff: msg("Favourite off for 15 months or more"), age: msg("Favourite aged 36 or older"), "ko-loss": msg("Favourite lost last time by stoppage"),
  "lost-last": msg("Favourite lost last time"), streak: msg("Underdog on a winning run of 4 or more"),
};

export default async function UpsetWatch() {
  const t = await getT();
  const w = await getWorld();
  // the feed is a file, not a page: it takes ?lang= instead of a locale prefix
  const feed = `/feeds/upset-watch.xml${t.locale === "ar" ? "?lang=ar" : ""}`;
  const list = upsetWatch(w, t);
  const rec = upsetRecord(w);
  const lift = signalLift(w);
  const shocks = recentShocks(w, 12, 5);
  const expected = list.filter((x) => x.tier !== "toss-up").reduce((s, x) => s + x.chance, 0);
  const by = (tier: Tier) => list.filter((x) => x.tier === tier);
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const when = (tier: Tier) => tier === "toss-up" ? t("{n}% or more", { n: Math.round(TIER_AT.tossUp * 100) }) : tier === "live" ? t("{a}% to {b}%", { a: Math.round(TIER_AT.live * 100), b: Math.round(TIER_AT.tossUp * 100) }) : t("under {n}%", { n: Math.round(TIER_AT.live * 100) });

  return (
    <div className="space-y-12">
      <div>
        <div className="eyebrow mb-2">{t("Fights to watch")}</div>
        <h1 className="font-display text-5xl font-extrabold uppercase">{t("Upset watch")}</h1>
        <p className="mt-2 max-w-3xl text-muted">{t("Every upcoming fight, ranked by the underdog's chance of winning from the same model as the predictor, with the reasons an upset could happen. Below, how the same calls have fared in past fights, including which warning signs turned out to matter.")}</p>
        <p className="mt-3 flex flex-wrap gap-2 text-sm">
          <a href={feed} className="chip !border-gold/40 hover:!text-gold">{t("Follow in a feed reader")}</a>
          <Link href="/previews" className="chip hover:!text-ink">{t("Fight previews")}</Link>
          <Link href="/accountability" className="chip hover:!text-ink">{t("Track record")}</Link>
        </p>
      </div>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t("Upcoming fights")} value={list.length} sub={t("with an opponent confirmed")} />
        <Stat label={t("Live underdogs")} value={by("live").length} sub={when("live")} />
        <Stat label={t("Longshots")} value={by("longshot").length} sub={when("longshot")} />
        <Stat label={t("Upsets to expect")} value={expected.toFixed(1)} sub={t("by the model, across live and longshot fights")} />
      </section>

      {list.length === 0 && <p className="card p-6 text-muted">{t("No upcoming fights to watch right now.")}</p>}
      {TIERS.map((tier) => by(tier).length > 0 && (
        <section key={tier}>
          <SectionTitle eyebrow={when(tier)} title={t(TIER_LABEL[tier])} />
          {tier === "toss-up" && <p className="-mt-2 mb-4 text-sm text-muted">{t("The model has no real favourite here: the “underdog” is the slightly less likely fighter, and a win for either would not be a surprise.")}</p>}
          <div className="grid gap-4 lg:grid-cols-2">{by(tier).map((x) => <WatchCard key={x.bout.id} x={x} />)}</div>
        </section>
      ))}

      <section className="card p-6" aria-labelledby="record">
        <h2 id="record" className="font-display text-3xl font-bold uppercase">{t("How the same calls fared")}</h2>
        <p className="mt-2 max-w-3xl text-sm text-muted">{t("For every past fight the model scored, using only what was known beforehand: how often the underdog won, against how often the model said they would. The recent column is the last quarter of fights, the stretch the model was not tuned on.")}</p>
        <ScrollRegion className="mt-4" label={t("Underdog win rate against the model, by tier")}>
          <table className="w-full text-sm">
            <caption className="sr-only">{t("Underdog win rate against the model, by tier")}</caption>
            <thead><tr className="text-start text-xs uppercase tracking-widest text-muted"><th scope="col" className="py-2 text-start font-normal">{t("Underdog was")}</th><th scope="col" className="text-end font-normal">{t("Fights")}</th><th scope="col" className="text-end font-normal">{t("Model said")}</th><th scope="col" className="text-end font-normal">{t("Happened")}</th><th scope="col" className="text-end font-normal">{t("Recent: said")}</th><th scope="col" className="text-end font-normal">{t("Recent: happened")}</th></tr></thead>
            <tbody>
              {rec.all.map((r, i) => (
                <tr key={r.tier} className="border-t border-line/60 tabular">
                  <th scope="row" className="py-2 text-start font-semibold">{t(TIER_LABEL[r.tier])} <span className="font-normal text-muted">({when(r.tier)})</span></th>
                  <td className="text-end">{r.n.toLocaleString("en-US")}</td><td className="text-end text-muted">{pct(r.predicted)}</td><td className="text-end text-gold">{pct(r.observed)}</td>
                  <td className="text-end text-muted">{pct(rec.recent[i].predicted)}</td><td className="text-end text-gold">{pct(rec.recent[i].observed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
        <p className="mt-3 text-xs text-muted">{t("Close agreement means the percentages can be taken at face value. Where underdogs win more often than the model says, its chances for them run a little low; where they win less often, a little high.")}</p>
      </section>

      <section className="card p-6" aria-labelledby="signs">
        <h2 id="signs" className="font-display text-3xl font-bold uppercase">{t("Do the warning signs matter?")}</h2>
        <p className="mt-2 max-w-3xl text-sm text-muted">{t("The model does not use these signs, so they are tested: in past fights where the favourite had the sign (or, for the last one, the underdog had the run), did the underdog win more often than the model said?")}</p>
        <ScrollRegion className="mt-4" label={t("Underdog win rate when a warning sign was present")}>
          <table className="w-full text-sm">
            <caption className="sr-only">{t("Underdog win rate when a warning sign was present")}</caption>
            <thead><tr className="text-start text-xs uppercase tracking-widest text-muted"><th scope="col" className="py-2 text-start font-normal">{t("Sign")}</th><th scope="col" className="text-end font-normal">{t("Fights")}</th><th scope="col" className="text-end font-normal">{t("Model said")}</th><th scope="col" className="text-end font-normal">{t("Happened")}</th><th scope="col" className="text-end font-normal">{t("Verdict")}</th></tr></thead>
            <tbody>
              {lift.filter((l) => SIGN_NAME[l.kind]).map((l) => {
                const se = Math.sqrt((l.observed * (1 - l.observed)) / Math.max(1, l.n));
                const z = (l.observed - l.predicted) / (se || 1);
                const verdict = l.n < 30 ? t("Too few fights") : z >= 2 ? t("Underdogs do better") : z <= -2 ? t("Underdogs do worse") : t("No clear effect");
                return (
                  <tr key={l.kind} className="border-t border-line/60 tabular">
                    <th scope="row" className="py-2 text-start font-semibold">{t(SIGN_NAME[l.kind]!)}</th>
                    <td className="text-end">{l.n.toLocaleString("en-US")}</td><td className="text-end text-muted">{pct(l.predicted)}</td><td className="text-end text-gold">{pct(l.observed)}</td>
                    <td className="text-end">{verdict}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollRegion>
        <p className="mt-3 text-xs text-muted">{t("A verdict needs the gap to be about twice its margin of error. Signs listed on the fights above but not in this table (a new head trainer, missed weights, a weak chin against a puncher) cannot be rebuilt as of fight night, so they are shown as context, not as proven edges. Thresholds used: {layoff} months idle, age {age}, a run of {streak}.", { layoff: SIGNS.layoffMonths, age: SIGNS.age, streak: SIGNS.streak })}</p>
      </section>

      {shocks.length > 0 && (
        <section>
          <SectionTitle eyebrow={t("Last 12 months")} title={t("The biggest shocks")} />
          <ul className="card divide-y divide-line/60 p-2">
            {shocks.map((c) => {
              const red = w.byId.get(c.redId), blue = w.byId.get(c.blueId);
              if (!red || !blue) return null;
              const winner = c.redWon ? red : blue, loser = c.redWon ? blue : red;
              return (
                <li key={c.boutId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-3 text-sm">
                  <span><Link href={`/bouts/${c.boutId}`} className="font-semibold hover:text-gold">{t("{a} beat {b}", { a: t.name(winner.name), b: t.name(loser.name) })}</Link> <span className="text-muted">· {fmtDate(c.date, { month: "short", day: "numeric", year: "numeric" }, t.locale)}</span></span>
                  <span className="chip whitespace-nowrap">{t("the model gave the winner {pct}%", { pct: Math.round(c.pWinner * 100) })}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
