import { fmtDate } from "@/lib/format";
import { sourceName } from "@/lib/news/read";
import type { NewsItem } from "@/lib/news/store";
import type { T } from "@/lib/i18n/t";

/**
 * Headlines from other outlets, each a link to the original: the outlet's name, the date, the title and the short excerpt the outlet's own feed publishes. Their
 * words and addresses are shown as text and as links (never as markup), in their own language, and open in a new tab without handing on where the visitor came from.
 */
export function NewsList({ items, t }: { items: NewsItem[]; t: T }) {
  if (!items.length) return null;
  return (
    <ul className="grid gap-3 md:grid-cols-2">
      {items.map((n) => (
        <li key={n.id} className="card p-4">
          <div className="text-xs text-muted"><span lang="en" dir="ltr">{sourceName(n.source)}</span>{n.published ? <> · {fmtDate(n.published.slice(0, 10), { month: "short", day: "numeric", year: "numeric" }, t.locale)}</> : null}</div>
          <a href={n.url} target="_blank" rel="noopener noreferrer nofollow" lang="en" dir="ltr" className="mt-1 block font-display text-lg font-bold leading-snug hover:text-gold">{n.title}</a>
          {n.snippet && <p lang="en" dir="ltr" className="mt-1 text-sm text-muted">{n.snippet}</p>}
          <div className="mt-2 flex flex-wrap gap-x-4 text-xs text-muted">
            <a href={n.url} target="_blank" rel="noopener noreferrer nofollow" className="py-1 hover:text-ink">{t.rich("Read at <o>{name}</o>", { name: sourceName(n.source), o: (c) => <span lang="en" dir="ltr">{c}</span> })} ↗</a>
            {n.archiveUrl && <a href={n.archiveUrl} target="_blank" rel="noopener noreferrer nofollow" className="py-1 hover:text-ink">{t("Archived copy")} ↗</a>}
          </div>
        </li>
      ))}
    </ul>
  );
}
