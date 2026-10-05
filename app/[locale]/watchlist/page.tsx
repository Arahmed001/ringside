import { getT } from "@/lib/i18n/server";
import { metaFor } from "@/lib/seo-server";
import { WatchlistPage } from "@/components/WatchlistPage";
import { getWorld } from "@/lib/world";
import { pound4pound } from "@/lib/rankings";
import { toHit } from "@/lib/fighter-search";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => metaFor(params, (p, t) => ({
  path: "/watchlist", title: t("My watchlist"),
  description: t("The fighters you follow, with their next fight, last result and rating."),
  noindex: true, // personal page: nothing in it for a search engine
}));

export default async function Watchlist() {
  const t = await getT();
  // somewhere to start for a visitor who follows nobody yet: the six top-rated active fighters
  const suggestions = pound4pound(await getWorld(), 6).map((b) => toHit(b, t));
  return (
    <div className="space-y-8">
      <div>
        <div className="eyebrow mb-2">{t("Fighters you follow")}</div>
        <h1 className="font-display text-5xl font-extrabold uppercase">{t("My watchlist")}</h1>
        <p className="mt-2 max-w-2xl text-muted">{t("Soonest fight first.")}</p>
      </div>
      <WatchlistPage suggestions={suggestions} />
    </div>
  );
}
