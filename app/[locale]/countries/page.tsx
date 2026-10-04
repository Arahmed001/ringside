import Link from "@/components/L";
import { getWorld } from "@/lib/world";
import { countryList } from "@/lib/countries";
import { countryName, flag } from "@/lib/format";
import { getT } from "@/lib/i18n/server";
import { metaFor } from "@/lib/seo-server";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => metaFor(params, (p, t) => ({
  path: "/countries", title: t("Boxing by country"),
  description: t("Every country with a boxer in the Ringside database: its best fighters, current champions, coming fights and the events held there."),
}));

export default async function Countries() {
  const t = await getT();
  const list = countryList(await getWorld());
  return (
    <div className="space-y-8">
      <div>
        <div className="eyebrow mb-2">{t("Where the fighters are from")}</div>
        <h1 className="font-display text-5xl font-extrabold uppercase">{t("Boxing by country")}</h1>
        <p className="mt-2 max-w-3xl text-muted">{t("{n} countries, the one with the most fighters first. Open one for its best fighters, its champions and its coming fights.", { n: list.length })}</p>
      </div>
      {list.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {list.map((c) => (
            <Link key={c.slug} href={`/countries/${c.slug}`} className="card card-hover p-4">
              <div className="font-display text-xl font-bold leading-tight">{flag(c.name)} {countryName(c.name, t.locale)}</div>
              <div className="mt-1 text-xs text-muted">{t("{fighters} · {active} active", { fighters: t.n(c.fighters, "{n} fighter", "{n} fighters"), active: c.active })}</div>
            </Link>
          ))}
        </div>
      ) : <div className="card p-8 text-center text-muted">{t("No fighters yet.")}</div>}
    </div>
  );
}
