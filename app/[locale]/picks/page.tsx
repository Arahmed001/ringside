import { getT } from "@/lib/i18n/server";
import { metaFor } from "@/lib/seo-server";
import { MyPicks } from "@/components/MyPicks";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => metaFor(params, (p, t) => ({
  path: "/picks", title: t("My picks"),
  description: t("Your fight-night picks, graded against the results and against the Ringside model's call before the bell."),
}));

export default async function Picks() {
  const t = await getT();
  return (
    <div className="space-y-8">
      <div>
        <div className="eyebrow mb-2">{t("Fight night pick’em")}</div>
        <h1 className="font-display text-5xl font-extrabold uppercase">{t("My picks")}</h1>
        <p className="mt-2 max-w-2xl text-muted">{t("Call fights before the bell, then see how you did, how long your streak runs and whether you can beat the model.")}</p>
      </div>
      <MyPicks />
    </div>
  );
}
