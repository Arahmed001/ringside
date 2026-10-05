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
import { searchFighters } from "@/lib/fighter-search";
import { applyControls, asSort, asStatus, optionsOf, KO_RATE_MIN_WINS } from "@/lib/fighter-list";
import { countryName } from "@/lib/format";
import { metaFor, pagedTitle, type SearchParams } from "@/lib/seo-server";

export const generateMetadata = ({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<SearchParams> }) =>
  metaFor(params, (p, t, sp) => ({ path: "/boxers", title: pagedTitle(t, t("Fighters"), sp.page), description: t("Search every fighter in the Ringside database in plain language, or filter by division and sex: records, ratings, knockouts and fighting styles.") }), searchParams);

/** Fighters per page: the full result set is always reachable, 48 at a time. */
const PAGE = 48;

export default async function Boxers({ searchParams }: { searchParams: Promise<{ q?: string; wc?: string; sex?: string; page?: string; country?: string; stance?: string; status?: string; sort?: string }> }) {
  const { q = "", wc, sex, page: pageParam, country, stance, status, sort } = await searchParams;
  const t = await getT();
  const qs = (extra: Record<string, string | undefined>) => { const p = new URLSearchParams(); const all = { q: q || undefined, wc, sex, country: country || undefined, stance: stance || undefined, status: asStatus(status), sort: sort && asSort(sort) !== "rating" ? asSort(sort) : undefined, page: undefined, ...extra }; for (const [k, v] of Object.entries(all)) if (v) p.set(k, v); const s = p.toString(); return `/boxers${s ? `?${s}` : ""}`; };
  const w = await getWorld();
  let results = w.boxers.filter((b) => b.bouts > 0);
  let chips: string[] = [];
  let closeTo: string | null = null; // the name typed, when nothing is spelt that way and these are the nearest spellings
  if (q.trim()) {
    const { filters } = await parseQuery(q, w, clientId(await headers()));
    chips = describeFilters(filters, t);
    const names = await getNames(t.locale);
    results = applyFilters(results, filters, w, names);
    // a name and nothing else, spelt a little differently from any fighter's: offer the nearest spellings rather than an empty page
    if (!results.length && filters.text && Object.keys(filters).length === 1) {
      results = searchFighters(w, filters.text, { limit: PAGE, minBouts: 1, names });
      if (results.length) closeTo = filters.text;
    }
  } else {
    results = results.sort((a, b) => b.rating - a.rating);
  }
  if (wc) results = results.filter((b) => b.weightClass === wc);
  if (sex === "male" || sex === "female") results = results.filter((b) => b.sex === sex);
  const options = optionsOf(w.boxers.filter((b) => b.bouts > 0));
  results = applyControls(results, { country, stance, status, sort }, !!q.trim());
  const picked = !!(country || stance || asStatus(status) || asSort(sort) !== "rating");
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
      <form className="mt-4 flex flex-wrap items-end gap-3 text-sm">
        {q && <input type="hidden" name="q" value={q} />}
        {wc && <input type="hidden" name="wc" value={wc} />}
        {sex && <input type="hidden" name="sex" value={sex} />}
        {([
          ["country", t("Country"), country, [["", t("All countries")], ...options.countries.map((c) => [c, countryName(c, t.locale)] as const).sort((a, b) => a[1].localeCompare(b[1], t.locale))]],
          ["stance", t("Stance"), stance, [["", t("Any stance")], ...options.stances.map((x) => [x, t(x)] as const)]],
          ["status", t("Status"), asStatus(status), [["", t("Active and retired")], ["active", t("Active")], ["retired", t("Retired")]]],
          ["sort", t("Sort by"), asSort(sort), [["rating", t("Rating")], ["recent", t("Latest fight")], ["wins", t("Most wins")], ["ko", t("Knockout rate")]]],
        ] as const).map(([name, label, value, opts]) => (
          <label key={name} className="grid gap-1">
            <span className="eyebrow">{label}</span>
            <select name={name} defaultValue={value ?? ""} className="rounded-xl border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-gold/60">
              {opts.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
            </select>
          </label>
        ))}
        <button className="rounded-xl border border-line bg-panel-2 px-4 py-2 font-semibold transition hover:text-gold">{t("Apply")}</button>
        {picked && <Link href={qs({ country: undefined, stance: undefined, status: undefined, sort: undefined })} className="py-2 text-muted underline decoration-dotted hover:text-ink">{t("Clear filters")}</Link>}
      </form>
      {q.trim() && (
        <div className="mt-5 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">{t("Interpreted as")}</span>
          {chips.length ? chips.map((c) => <span key={c} className="chip !border-gold/40 !text-gold">{c}</span>) : <span className="text-muted">{t("no recognised filters")}</span>}
        </div>
      )}
      {asSort(sort) === "ko" && <p className="mt-2 text-xs text-muted">{t("Ordered by knockouts as a share of wins. Fighters with fewer than {min} wins, or whose career is held only in part, come last.", { min: KO_RATE_MIN_WINS })}</p>}
      {closeTo && <p className="mt-3 text-sm text-muted">{t("No fighter is spelt exactly “{text}”. These are the closest names.", { text: closeTo })}</p>}
      <div className="mt-2 text-sm text-muted">{results.length > shown.length ? t("{count} · showing {from}–{to}", { count: t.n(results.length, "{n} fighter", "{n} fighters"), from: first + 1, to: first + shown.length }) : t.n(results.length, "{n} fighter", "{n} fighters")}</div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((b) => <BoxerCard key={b.id} b={b} />)}
      </div>
      <Pager page={page} pages={pages} href={(n) => qs({ page: String(n) })} />
      {!shown.length && <div className="card mt-6 p-8 text-center text-muted">{t("Nobody matches that. Loosen a filter or try a different phrasing.")}</div>}
    </div>
  );
}
