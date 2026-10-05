import Link from "@/components/L";
import { getT } from "@/lib/i18n/server";
import { metaFor } from "@/lib/seo-server";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => metaFor(params, (p, t) => ({
  path: "/tour", title: t("Take the tour"),
  description: t("A 70-second silent walkthrough of Ringside: rankings, fighter pages, your watchlist, tonight’s card and the matchup lab."),
}));

/**
 * A silent, captioned walkthrough (public/media/tour-en.mp4 and tour-ar.mp4, each with its captions in its own language).
 * It never starts by itself; the list under it carries the same words as the captions, for anyone who cannot or will not play it.
 * The fighters in it are the fictional demo league.
 */
export default async function Tour() {
  const t = await getT();
  const ar = t.locale === "ar";
  const steps: [string, string][] = [
    [t("The home page"), t("The home page: the next big fight, ratings movers and the latest results")],
    [t("Rankings"), t("Rankings for every division, men and women")],
    [t("A fighter’s page"), t("Each fighter has a full page: record, rating, next fight and last five results")],
    [t("Follow a fighter"), t("Tap Watch to follow a fighter")],
    [t("My watchlist"), t("My watchlist: your fighters, soonest fight first. Saved on your account or this browser")],
    [t("Tonight"), t("Tonight: the card in fight order with win chances, your picks and live results")],
    [t("Matchup lab"), t("Matchup lab: pick any two fighters and see who is favoured and why")],
    [t("Print"), t("Print or save any fighter as a one-page PDF")],
  ];
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <div className="eyebrow mb-2">{t("New to Ringside?")}</div>
        <h1 className="font-display text-5xl font-extrabold uppercase">{t("Take the tour")}</h1>
        <p className="mt-3 text-lg text-muted">{t("Seventy seconds, no sound, with captions. The fighters in it are made up.")}</p>
      </div>
      <video
        key={t.locale}
        controls
        preload="metadata"
        playsInline
        poster={`/media/poster-${ar ? "ar" : "en"}.jpg`}
        aria-label={t("Ringside tour video, with captions")}
        className="aspect-video w-full rounded-2xl border border-line bg-panel"
      >
        <source src={`/media/tour-${ar ? "ar" : "en"}.mp4`} type="video/mp4" />
        <source src={`/media/tour-${ar ? "ar" : "en"}.webm`} type="video/webm" />
        {t("Your browser can’t play this video. The list below says what it shows.")}
      </video>
      <section className="space-y-3">
        <h2 className="font-display text-3xl font-extrabold uppercase">{t("What the tour shows")}</h2>
        <ol className="card divide-y divide-line/60">
          {steps.map(([k, v]) => <li key={k} className="grid gap-1 p-4 sm:grid-cols-[12rem_1fr] sm:gap-4"><span className="font-semibold">{k}</span><span className="text-muted">{v}</span></li>)}
        </ol>
        <p className="text-sm text-muted"><Link href="/learn" className="underline decoration-dotted hover:text-gold">{t("New to boxing? Boxing, explained")}</Link></p>
      </section>
    </div>
  );
}
