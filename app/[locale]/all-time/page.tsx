import Link from "@/components/L";
import { getWorld } from "@/lib/world";
import { GROUP_TITLE, LISTS, dataSpan, parseScope, recordList, type Group } from "@/lib/records";
import { RecordRows } from "@/components/RecordRows";
import { RecordsFilter } from "@/components/RecordsFilter";
import { SectionTitle } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { getT } from "@/lib/i18n/server";
import { metaFor } from "@/lib/seo-server";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => metaFor(params, (p, t) => ({
  path: "/all-time", title: t("All-time lists"),
  description: t("The greatest fighters, longest title reigns, biggest upsets, fastest knockouts and best fights in the Ringside data, each with how it is worked out. Filter by division and sex."),
}));

const GROUPS: Group[] = ["fighters", "titles", "fights"];

export default async function AllTime({ searchParams }: { searchParams: Promise<{ sex?: string; division?: string }> }) {
  const t = await getT();
  const { scope, sex, division } = parseScope(await searchParams);
  const w = await getWorld();
  const span = dataSpan(w);
  const q = new URLSearchParams(Object.entries({ sex, division }).filter(([, v]) => v) as [string, string][]).toString();
  const suffix = q ? `?${q}` : "";

  return (
    <div className="space-y-12">
      <div>
        <div className="eyebrow mb-2">{t("Records")}</div>
        <h1 className="font-display text-5xl font-extrabold uppercase">{t("All-time lists")}</h1>
        <p className="mt-2 max-w-3xl text-muted">{t("Who has done the most, in every way that can be counted from the fights on record. Each list says how it is worked out, and the scored ones show their parts.")}</p>
        {span && <p className="mt-2 max-w-3xl text-sm text-muted">{t("“All-time” means the fights in this data: {bouts} bouts from {from} to {to}. Earlier careers are not counted.", { bouts: span.bouts.toLocaleString("en-US"), from: fmtDate(span.from, { month: "short", year: "numeric" }, t.locale), to: fmtDate(span.to, { month: "short", year: "numeric" }, t.locale) })}</p>}
        <div className="mt-5"><RecordsFilter sex={sex} division={division} /></div>
        <p className="mt-4 flex flex-wrap gap-2 text-sm">
          <Link href="/fight-of-the-year" className="chip !border-gold/40 hover:!text-gold">{t("Fight of the year")}</Link>
          <Link href="/titles" className="chip hover:!text-ink">{t("Title lineages")}</Link>
          <Link href="/money" className="chip hover:!text-ink">{t("Money records")}</Link>
        </p>
      </div>

      <nav aria-label={t("Jump to a section")} className="-mt-6 flex flex-wrap gap-1.5">
        {GROUPS.map((g) => <a key={g} href={`#group-${g}`} className="chip hover:!text-ink">{t(GROUP_TITLE[g])}</a>)}
      </nav>

      {GROUPS.map((g) => (
        <section key={g} id={`group-${g}`}>
          <SectionTitle eyebrow={t("Top 5 of each")} title={t(GROUP_TITLE[g])} />
          <div className="grid gap-4 lg:grid-cols-2">
            {LISTS.filter((l) => l.group === g).map((l) => {
              const rows = recordList(w, l.id, scope, 5);
              return (
                <section key={l.id} className="card min-w-0 p-5" aria-labelledby={`l-${l.id}`}>
                  <div className="mb-1 flex items-start justify-between gap-3">
                    <h3 id={`l-${l.id}`} className="font-display text-2xl font-bold uppercase leading-tight">{t(l.title)}</h3>
                    <Link href={`/all-time/${l.id}${l.scoped ? suffix : ""}`} className="inline-block shrink-0 py-1 text-sm text-muted hover:text-ink">{t("Top 25")} <span className="inline-block rtl:rotate-180">→</span></Link>
                  </div>
                  <p className="mb-3 text-xs text-muted">{t(l.blurb)}</p>
                  {rows.length ? <RecordRows w={w} id={l.id} rows={rows} compact /> : <p className="py-4 text-sm text-muted">{t("Nobody qualifies in this data.")}</p>}
                </section>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
