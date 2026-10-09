import { fmtDate } from "@/lib/format";
import { sourceName } from "@/lib/news/read";
import { hasNewsImage } from "@/lib/news/images";
import type { NewsItem } from "@/lib/news/store";
import type { T } from "@/lib/i18n/t";

/**
 * Headlines from other outlets, each a link to the original: the outlet's name, the date, the title, the short excerpt and the picture the outlet's own feed publishes. Their
 * words and addresses are shown as text and as links (never as markup), in their own language, and open in a new tab without handing on where the visitor came from. The
 * picture is a file this site saved and serves itself (lib/news/images.ts): the visitor's browser never contacts the outlet's image host, and the outlet is named under it.
 */
export function NewsList({ items, t }: { items: NewsItem[]; t: T }) {
  if (!items.length) return null;
  return (
    <ul className="grid gap-3 md:grid-cols-2">
      {items.map((n) => (
        <li key={n.id} className="card flex gap-4 p-4">
          {hasNewsImage(n.id) && (
            <div className="w-28 shrink-0 sm:w-36">
              <a href={n.url} target="_blank" rel="noopener noreferrer nofollow" tabIndex={-1} aria-hidden="true" className="block aspect-[4/3] overflow-hidden rounded-lg bg-black">
                {/* eslint-disable-next-line @next/next/no-img-element -- a small picture served by this site; the image optimizer adds nothing */}
                <img src={`/api/news-image/${n.id}`} alt="" width={288} height={216} loading="lazy" decoding="async" className="h-full w-full object-cover" />
              </a>
              <div className="mt-1 text-xs leading-tight text-muted">{t.rich("Picture from <o>{name}</o>", { name: sourceName(n.source), o: (c) => <span lang="en" dir="ltr">{c}</span> })}</div>
            </div>
          )}
          <div className="min-w-0 flex-1">
          <div className="text-xs text-muted"><span lang="en" dir="ltr">{sourceName(n.source)}</span>{n.published ? <> · {fmtDate(n.published.slice(0, 10), { month: "short", day: "numeric", year: "numeric" }, t.locale)}</> : null}</div>
          <a href={n.url} target="_blank" rel="noopener noreferrer nofollow" lang="en" dir="ltr" className="mt-1 block font-display text-lg font-bold leading-snug hover:text-gold">{n.title}</a>
          {n.snippet && <p lang="en" dir="ltr" className="mt-1 text-sm text-muted">{n.snippet}</p>}
          <div className="mt-2 flex flex-wrap gap-x-4 text-xs text-muted">
            <a href={n.url} target="_blank" rel="noopener noreferrer nofollow" className="py-1 hover:text-ink">{t.rich("Read at <o>{name}</o>", { name: sourceName(n.source), o: (c) => <span lang="en" dir="ltr">{c}</span> })} ↗</a>
            {n.archiveUrl && <a href={n.archiveUrl} target="_blank" rel="noopener noreferrer nofollow" className="py-1 hover:text-ink">{t("Archived copy")} ↗</a>}
          </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
