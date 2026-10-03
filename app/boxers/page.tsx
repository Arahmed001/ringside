import type { Metadata } from "next";
import Link from "next/link";
import { getWorld } from "@/lib/world";
import { parseQuery, applyFilters, describeFilters } from "@/lib/ai";
import { DIVISION_NAMES } from "@/lib/divisions";
import { BoxerCard } from "@/components/ui";

export const metadata: Metadata = { title: "Fighters" };

export default async function Boxers({ searchParams }: { searchParams: Promise<{ q?: string; wc?: string; sex?: string }> }) {
  const { q = "", wc, sex } = await searchParams;
  const qs = (extra: Record<string, string | undefined>) => { const p = new URLSearchParams(); const all = { q: q || undefined, wc, sex, ...extra }; for (const [k, v] of Object.entries(all)) if (v) p.set(k, v); const t = p.toString(); return `/boxers${t ? `?${t}` : ""}`; };
  const w = await getWorld();
  let results = w.boxers.filter((b) => b.bouts > 0);
  let chips: string[] = [];
  let source: "ai" | "rules" | null = null;
  if (q.trim()) {
    const { filters, source: s } = await parseQuery(q, w);
    source = s;
    chips = describeFilters(filters);
    results = applyFilters(results, filters, w);
  } else {
    results = results.sort((a, b) => b.rating - a.rating);
  }
  if (wc) results = results.filter((b) => b.weightClass === wc);
  if (sex === "male" || sex === "female") results = results.filter((b) => b.sex === sex);
  const shown = results.slice(0, 48);

  return (
    <div>
      <div className="eyebrow mb-2">Fighter database</div>
      <h1 className="font-display text-5xl font-extrabold uppercase">Find a fighter</h1>
      <form className="mt-5 flex max-w-2xl gap-2">
        <input name="q" defaultValue={q} placeholder="Ask in plain English — “southpaw welterweights with 10+ KOs after 2015”" className="min-w-0 flex-1 rounded-2xl border border-line bg-panel px-5 py-3.5 outline-none transition placeholder:text-muted/70 focus:border-gold/60" />
        <button className="rounded-2xl bg-red px-6 font-display text-lg font-bold uppercase transition hover:brightness-110">Search</button>
      </form>
      <div className="mt-4 flex gap-1.5">
        {([[undefined, "Everyone"], ["male", "Men"], ["female", "Women"]] as const).map(([v, label]) => <Link key={label} href={qs({ sex: v })} className={`chip ${(sex ?? undefined) === v ? "!border-gold/50 !text-gold" : ""}`}>{label}</Link>)}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Link href={qs({ wc: undefined })} className={`chip ${!wc ? "!border-gold/50 !text-gold" : ""}`}>All divisions</Link>
        {DIVISION_NAMES.map((d) => <Link key={d} href={qs({ wc: d })} className={`chip ${wc === d ? "!border-gold/50 !text-gold" : ""}`}>{d}</Link>)}
      </div>
      {q.trim() && (
        <div className="mt-5 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">Interpreted as</span>
          {chips.length ? chips.map((c) => <span key={c} className="chip !border-gold/40 !text-gold">{c}</span>) : <span className="text-muted">no recognised filters</span>}
          <span className="chip">{source === "ai" ? "✦ Claude" : "rule-based parser"}</span>
        </div>
      )}
      <div className="mt-2 text-sm text-muted">{results.length} fighter{results.length === 1 ? "" : "s"}{results.length > shown.length ? ` · showing top ${shown.length}` : ""}</div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((b) => <BoxerCard key={b.id} b={b} />)}
      </div>
      {!shown.length && <div className="card mt-6 p-8 text-center text-muted">Nobody matches that. Loosen a filter or try a different phrasing.</div>}
    </div>
  );
}
