"use client";
import { useEffect, useState } from "react";
import { useWatchlist } from "@/lib/useWatchlist";
import type { WatchEntry } from "@/lib/watch";
import { useLocale, useT } from "@/components/i18n";
import { useHref } from "@/components/L";

export function WatchButton({ slug }: { slug: string }) {
  const t = useT();
  const { list, loading, add, remove } = useWatchlist();
  const on = list.includes(slug);
  return (
    <button onClick={() => void (on ? remove(slug) : add(slug))} disabled={loading}
      className={`chip cursor-pointer transition disabled:cursor-wait disabled:opacity-60 ${on ? "!border-gold/60 !bg-gold/10 !text-gold" : "hover:text-ink"}`} aria-pressed={on}>
      {on ? t("★ Watching") : t("☆ Watch")}
    </button>
  );
}

/** The starred fighters' next fights. The slugs live in this browser; the server only sees them to look those few fighters up. */
export function WatchlistStrip() {
  const t = useT();
  const locale = useLocale();
  const href = useHref();
  const { list, loading } = useWatchlist();
  const key = list.join(",");
  const [loaded, setLoaded] = useState<{ key: string; rows: WatchEntry[] | null } | null>(null);
  useEffect(() => {
    if (!key || loading) return;
    const ctl = new AbortController();
    fetch(`/api/watch?slugs=${encodeURIComponent(key)}&lang=${locale}`, { signal: ctl.signal })
      .then((r) => (r.ok ? (r.json() as Promise<WatchEntry[]>) : null))
      .then((rows) => setLoaded({ key, rows }))
      .catch((e) => { if (e?.name !== "AbortError") setLoaded({ key, rows: null }); });
    return () => ctl.abort();
  }, [key, locale, loading]);
  if (loading) return <p className="text-sm text-muted">{t("Loading your watchlist…")}</p>;
  if (!key) return <p className="text-sm text-muted">{t("Star a fighter (☆ Watch on any profile) and their next fight shows up here.")}</p>;
  if (loaded?.key !== key) return <p className="text-sm text-muted">{t("Loading your watchlist…")}</p>;
  if (!loaded.rows) return <p className="text-sm text-muted">{t("Couldn’t load your watchlist. Try again in a moment.")}</p>;
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {loaded.rows.map((f) => (
        <li key={f.slug}><a href={href(`/boxers/${f.slug}`)} className="card flex items-center justify-between p-3 text-sm hover:border-gold/40"><span><b>{f.name}</b> <span className="text-muted">{f.record}</span></span><span className="text-xs text-gold">{f.next ?? t("No fight booked")}</span></a></li>
      ))}
    </ul>
  );
}
