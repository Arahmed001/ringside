import Link from "@/components/L";
import { getT } from "@/lib/i18n/server";

/**
 * The name filter above a long ranked list, and what it found: a search box (a plain GET form that keeps the page's other settings in hidden fields), a
 * way back to the whole list, and one line saying what came of it: the nearest spellings when nothing is spelt that way, no one, or how many of how many.
 * `hidden` is what else the address carries (the tab, the sort); it is also the address "Clear" goes back to.
 */
export async function ListFinder({ path, hidden, q, label, total, of, close }: { path: string; hidden: Record<string, string>; q: string; label: string; total: number; of: number; close: boolean }) {
  const t = await getT();
  return (
    <div className="mb-3">
      <form role="search" aria-label={label} className="flex max-w-xl gap-2">
        {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <input name="q" defaultValue={q} aria-label={label} placeholder={label} className="min-w-0 flex-1 rounded-xl border border-line bg-panel px-4 py-2.5 text-sm outline-none focus:border-gold/60" />
        <button className="rounded-xl border border-line bg-panel px-4 text-sm font-semibold hover:text-gold">{t("Find")}</button>
        {q && <Link href={`${path}?${new URLSearchParams(hidden)}`} className="chip self-center">{t("Clear")}</Link>}
      </form>
      {q && close && <p className="mt-2 text-sm text-muted">{t("No name is spelt exactly “{q}”. These are the closest names.", { q })}</p>}
      {q && !total && <p className="mt-2 text-sm text-muted">{t("No one in this list has that name.")}</p>}
      {q && total > 0 && <p className="mt-2 text-xs text-muted">{t("{n} of {total} shown", { n: total, total: of })}</p>}
    </div>
  );
}
