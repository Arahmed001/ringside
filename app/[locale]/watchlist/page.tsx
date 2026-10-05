import { getT } from "@/lib/i18n/server";
import { metaFor } from "@/lib/seo-server";
import { WatchlistPage } from "@/components/WatchlistPage";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => metaFor(params, (p, t) => ({
  path: "/watchlist", title: t("My watchlist"),
  description: t("The fighters you follow, with their next fight, last result and rating."),
}));

export default async function Watchlist() {
  const t = await getT();
  return (
    <div className="space-y-8">
      <div>
        <div className="eyebrow mb-2">{t("Fighters you follow")}</div>
        <h1 className="font-display text-5xl font-extrabold uppercase">{t("My watchlist")}</h1>
        <p className="mt-2 max-w-2xl text-muted">{t("Soonest fight first.")}</p>
      </div>
      <WatchlistPage />
    </div>
  );
}
