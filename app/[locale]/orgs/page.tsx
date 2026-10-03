import Link from "@/components/L";
import { getWorld } from "@/lib/world";
import { orgsIndex } from "@/lib/team";
import { SectionTitle } from "@/components/ui";
import { flag } from "@/lib/format";
import type { Org } from "@/lib/types";
import { getT } from "@/lib/i18n/server";
import { metaFor } from "@/lib/seo-server";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => metaFor(params, (p, t) => ({ path: "/orgs", title: t("Gyms, promotions & bodies"), description: t("Boxing gyms, promotions and sanctioning bodies: who trains and signs the fighters, how many events each promotes and which belts they sanction.") }));

/** Cards shown per list; the stats behind them are computed for these only (see orgsIndex). */
const TOP = 36;

export default async function Orgs() {
  const t = await getT();
  const w = await getWorld();
  const { gyms, promos, gymTotal, promoTotal } = orgsIndex(w, TOP);
  const group = (kind: Org["kind"]) => [...w.orgs.values()].filter((o) => o.kind === kind);
  const bodies = group("sanctioning_body");
  return (
    <div className="space-y-12">
      <div><div className="eyebrow mb-2">{t("Where fighters train, sign and win belts")}</div><h1 className="font-display text-5xl font-extrabold uppercase">{t("Gyms, promotions & bodies")}</h1></div>
      <section>
        <SectionTitle eyebrow={t("Sanctioning bodies")} title={t("Belts")} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{bodies.map((o) => <Link key={o.id} href={`/orgs/${o.slug}`} className="card card-hover p-4"><div className="font-display text-xl font-bold">{t.name(o.name)}</div></Link>)}</div>
      </section>
      <section>
        <SectionTitle eyebrow={promoTotal > TOP ? t("By events promoted · top {top} of {total}", { top: TOP, total: promoTotal }) : t("By events promoted")} title={t("Promotions")} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{promos.map(({ o, s, events }) => (
          <Link key={o.id} href={`/orgs/${o.slug}`} className="card card-hover p-4"><div className="font-display text-xl font-bold">{t.name(o.name)}</div><div className="text-xs text-muted">{o.country && flag(o.country)} {t("{events} events · {fighters} fighters signed · {w}-{l} combined", { events, fighters: s.currentFighters, w: s.record.wins, l: s.record.losses })}</div></Link>
        ))}</div>
      </section>
      <section>
        <SectionTitle eyebrow={gymTotal > TOP ? t("By current fighters · top {top} of {total}", { top: TOP, total: gymTotal }) : t("By current fighters")} title={t("Gyms")} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{gyms.map(({ o, s }) => (
          <Link key={o.id} href={`/orgs/${o.slug}`} className="card card-hover p-4"><div className="font-display text-xl font-bold">{t.name(o.name)}</div><div className="text-xs text-muted">{o.country && flag(o.country)} {o.city ? t.name(o.city) : ""} · {t("{now} training now · {ever} ever · {pct}% wins", { now: s.currentFighters, ever: s.fighters, pct: Math.round(s.record.winRate * 100) })}</div></Link>
        ))}</div>
      </section>
    </div>
  );
}
