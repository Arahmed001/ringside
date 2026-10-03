import { headers } from "next/headers";
import { clientId } from "@/lib/ai-guard";
import Link from "@/components/L";
import { getWorld } from "@/lib/world";
import { parseQuery, applyFilters, describeFilters } from "@/lib/ai";
import { DIVISION_NAMES } from "@/lib/divisions";
import { BoxerCard, Pager } from "@/components/ui";
import { paginate } from "@/lib/paging";
import { getT } from "@/lib/i18n/server";
import { getNames } from "@/lib/i18n/names";
import { metaFor } from "@/lib/seo-server";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) =>
  metaFor(params, (p, t) => ({ path: "/boxers", title: t("Fighters"), description: t("Search every fighter in the Ringside database in plain language, or filter by division and sex: records, ratings, knockouts and fighting styles.") }));

/** Fighters per page: the full result set is always reachable, 48 at a time. */
const PAGE = 48;

export default async function Boxers({ searchParams }: { searchParams: Promise<{ q?: string; wc?: string; sex?: string; page?: string }> }) {
  const { q = "", wc, sex, page: pageParam } = await searchParams;
  const t = await getT();
  const qs = (extra: Record<string, string | undefined>) => { const p = new URLSearchParams(); const all = { q: q || undefined, wc, sex, page: undefined, ...extra }; for (const [k, v] of Object.entries(all)) if (v) p.set(k, v); const s = p.toString(); return `/boxers${s ? `?${s}` : ""}`; };
  const w = await getWorld();
  let results = w.boxers.filter((b) => b.bouts > 0);
  let chips: string[] = [];
  let source: "ai" | "rules" | null = null;
  if (q.trim()) {
    const { filters, source: s } = await parseQuery(q, w, clientId(await headers()));
    source = s;
    chips = describeFilters(filters, t);
    results = applyFilters(results, filters, w, await getNames(t.locale));
  } else {
    results = results.sort((a, b) => b.rating - a.rating);
  }
  if (wc) results = results.filter((b) => b.weightClass === wc);
  if (sex === "male" || sex === "female") results = results.filter((b) => b.sex === sex);
  const { page, pages, first } = paginate(results.length, pageParam, PAGE);
  const shown = results.slice(first, first + PAGE);

  return (
    <div>
      <div className="eyebrow mb-2">{t("Fighter database")}</div>
      <h1 className="font-display text-5xl font-extrabold uppercase">{t("Find a fighter")}</h1>
      <form className="mt-5 flex max-w-2xl gap-2">
        <input name="q" aria-label={t("Search fighters")} defaultValue={q} placeholder={t("Ask in plain English — “southpaw welterweights with 10+ KOs after 2015”")} className="min-w-0 flex-1 rounded-2xl border border-line bg-panel px-5 py-3.5 outline-none transition placeholder:text-muted focus:border-gold/60" />
        <button className="rounded-2xl bg-red-btn px-6 text-white font-display text-lg font-bold uppercase transition hover:brightness-90">{t("Search")}</button>
      </form>
      <div className="mt-4 flex gap-1.5">
        {([[undefined, t("Everyone")], ["male", t("Men")], ["female", t("Women")]] as const).map(([v, label]) => <Link key={label} href={qs({ sex: v })} className={`chip ${(sex ?? undefined) === v ? "!border-gold/50 !text-gold" : ""}`}>{label}</Link>)}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Link href={qs({ wc: undefined })} className={`chip ${!wc ? "!border-gold/50 !text-gold" : ""}`}>{t("All divisions")}</Link>
        {DIVISION_NAMES.map((d) => <Link key={d} href={qs({ wc: d })} className={`chip ${wc === d ? "!border-gold/50 !text-gold" : ""}`}>{t(d)}</Link>)}
      </div>
      {q.trim() && (
        <div className="mt-5 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">{t("Interpreted as")}</span>
          {chips.length ? chips.map((c) => <span key={c} className="chip !border-gold/40 !text-gold">{c}</span>) : <span className="text-muted">{t("no recognised filters")}</span>}
          <span className="chip">{source === "ai" ? "✦ Claude" : t("rule-based parser")}</span>
        </div>
      )}
      <div className="mt-2 text-sm text-muted">{results.length > shown.length ? t("{count} · showing {from}–{to}", { count: t.n(results.length, "{n} fighter", "{n} fighters"), from: first + 1, to: first + shown.length }) : t.n(results.length, "{n} fighter", "{n} fighters")}</div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((b) => <BoxerCard key={b.id} b={b} />)}
      </div>
      <Pager page={page} pages={pages} href={(n) => qs({ page: String(n) })} />
      {!shown.length && <div className="card mt-6 p-8 text-center text-muted">{t("Nobody matches that. Loosen a filter or try a different phrasing.")}</div>}
    </div>
  );
}
