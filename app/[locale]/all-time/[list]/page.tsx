import { notFound } from "next/navigation";
import Link from "@/components/L";
import { getWorld } from "@/lib/world";
import { LISTS, dataSpan, listDef, parseScope, recordList } from "@/lib/records";
import { RecordRows } from "@/components/RecordRows";
import { RecordsFilter } from "@/components/RecordsFilter";
import { JsonLd } from "@/components/JsonLd";
import { divisionFromSlug, divisionLabel } from "@/lib/divisions";
import { abs } from "@/lib/seo";
import { localePath } from "@/lib/i18n/config";
import { fmtDate } from "@/lib/format";
import { getT } from "@/lib/i18n/server";
import { metaFor } from "@/lib/seo-server";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string; list: string }> }) => metaFor(params, ({ list }, t) => {
  const def = listDef(list);
  if (!def) notFound();
  return { path: `/all-time/${list}`, title: t(def.title), description: t(def.blurb).slice(0, 300) };
});

export default async function AllTimeList({ params, searchParams }: { params: Promise<{ list: string }>; searchParams: Promise<{ sex?: string; division?: string }> }) {
  const { list } = await params;
  const def = listDef(list);
  if (!def) notFound();
  const t = await getT();
  const { scope, sex, division } = parseScope(await searchParams);
  const w = await getWorld();
  const rows = recordList(w, def.id, scope, 50);
  const span = dataSpan(w);
  const dv = division ? divisionFromSlug(division) : undefined;
  const scopeText = [sex === "female" ? t("Women") : sex === "male" ? t("Men") : null, dv ? divisionLabel(dv.name, sex === "female" ? "female" : "male", t) : null].filter(Boolean).join(" · ");
  const others = LISTS.filter((l) => l.group === def.group && l.id !== def.id);

  return (
    <div className="space-y-8">
      <JsonLd data={{
        "@type": "ItemList", name: t(def.title), numberOfItems: rows.length, url: abs(localePath(t.locale, `/all-time/${def.id}`)),
        itemListElement: rows.filter((r) => r.boxer).slice(0, 25).map((r) => ({ "@type": "ListItem", position: r.rank, url: abs(localePath(t.locale, `/boxers/${r.boxer!.slug}`)), name: t.name(r.boxer!.name) })),
      }} />
      <div>
        <div className="eyebrow mb-2"><Link href="/all-time" className="hover:text-ink">{t("All-time lists")}</Link>{scopeText && ` · ${scopeText}`}</div>
        <h1 className="font-display text-4xl font-extrabold uppercase sm:text-5xl">{t(def.title)}</h1>
        <p className="mt-2 max-w-3xl text-muted">{t(def.blurb)}</p>
        {span && <p className="mt-2 text-xs text-muted">{t("From {bouts} bouts, {from} to {to}.", { bouts: span.bouts.toLocaleString("en-US"), from: fmtDate(span.from, { month: "short", year: "numeric" }, t.locale), to: fmtDate(span.to, { month: "short", year: "numeric" }, t.locale) })}</p>}
        {def.scoped && <div className="mt-5"><RecordsFilter sex={sex} division={division} /></div>}
      </div>
      <section className="card p-5">
        {rows.length ? <RecordRows w={w} id={def.id} rows={rows} /> : <p className="py-6 text-center text-sm text-muted">{t("Nobody qualifies in this data.")}</p>}
      </section>
      <nav aria-label={t("More lists")} className="flex flex-wrap gap-2">
        {others.map((l) => <Link key={l.id} href={`/all-time/${l.id}${l.scoped && (sex || division) ? `?${new URLSearchParams(Object.entries({ sex, division }).filter(([, v]) => v) as [string, string][])}` : ""}`} className="chip hover:!text-ink">{t(l.title)}</Link>)}
      </nav>
    </div>
  );
}
