import Link from "@/components/L";
import { getT } from "@/lib/i18n/server";
import { nextSort, sortQuery, type Sort } from "@/lib/table-sort";

/**
 * A column heading that sorts the table: a real link (it works without scripts, and the sorted list has an address of its own), `aria-sort` on the heading, and an arrow
 * beside the sorted column. `keep` is every other part of the address that must survive (the sex, a name filter); the page number does not (a new order starts at page 1).
 */
export async function SortTh<K extends string>({ label, column, current, fallback, textual = false, path, keep = {}, className = "", end = false }: {
  label: string; column: K; current: Sort<K>; fallback: Sort<K>; textual?: boolean; path: string; keep?: Record<string, string>; className?: string; end?: boolean;
}) {
  const t = await getT();
  const on = current.key === column;
  const next = nextSort(current, column, textual);
  const href = `${path}${(() => { const q = new URLSearchParams({ ...keep, ...sortQuery(next, fallback) }).toString(); return q ? `?${q}` : ""; })()}`;
  return (
    <th scope="col" aria-sort={on ? (current.dir === "asc" ? "ascending" : "descending") : undefined} className={className}>
      <Link href={href} title={t("Sort by {column}", { column: label })} className={`inline-flex items-center gap-1 py-2 uppercase tracking-widest transition hover:text-ink ${on ? "text-gold" : ""} ${end ? "flex-row-reverse" : ""}`}>
        {label}<span aria-hidden className={on ? "" : "opacity-0"}>{current.dir === "asc" || !on ? "▲" : "▼"}</span>
      </Link>
    </th>
  );
}
