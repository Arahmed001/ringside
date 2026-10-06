"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { readSeen, useWatchlist, writeSeen } from "@/lib/useWatchlist";
import type { WatchEntry } from "@/lib/watch";
import { flag, fmtDate } from "@/lib/format";
import { useLocale, useT } from "@/components/i18n";
import { WatchlistAdd } from "@/components/WatchlistAdd";
import { WatchDigest } from "@/components/WatchDigest";
import type { Digest } from "@/lib/watch-digest";
import { calendarPath } from "@/lib/calendar-link";
import type { FighterHit } from "@/lib/fighter-search";
import { useHref } from "@/components/L";
import Link from "@/components/L";

/** Soonest next fight first, then fighters with nothing booked (by name). */
const byNext = (a: WatchEntry, b: WatchEntry) =>
  a.nextDate && b.nextDate ? a.nextDate.localeCompare(b.nextDate) : a.nextDate ? -1 : b.nextDate ? 1 : a.name.localeCompare(b.name);

/** The upcoming fights of everyone on the list as a calendar: a file to add once, or an address a calendar app subscribes to and keeps up to date. */
function CalendarLinks({ slugs, locale }: { slugs: string[]; locale: string }) {
  const t = useT();
  const host = useSyncExternalStore(() => () => {}, () => window.location.host, () => ""); // the address only exists in the browser: nothing on the server, so the link appears after the page is up
  const path = calendarPath({ slugs, days: 180 }, locale);
  return (
    <div className="card flex flex-wrap items-center gap-3 p-4">
      <p className="min-w-0 flex-1 text-sm text-muted">{t("Your fights as a calendar: the upcoming fights of everyone you follow, updated as cards change.")}</p>
      <a href={path} download className="chip transition hover:!text-gold"><span aria-hidden="true">📅 </span>{t("Add to calendar")}</a>
      {host ? <a href={`webcal://${host}${path}`} className="chip transition hover:!text-gold">{t("Subscribe in your calendar app")}</a> : null}
    </div>
  );
}

/** The whole watchlist: every fighter starred in this browser, with the next fight, last result and rating. */
export function WatchlistPage({ suggestions }: { suggestions: FighterHit[] }) {
  const t = useT();
  const locale = useLocale();
  const href = useHref();
  const { list, loading, remove, mode } = useWatchlist();
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

  // "since you last looked": ask for what is newer than the day last seen; a first visit only learns the data's day. The day is brought up to date when the page is left
  // (not at once, so a reload still shows it), or by "Mark as seen"
  const [digest, setDigest] = useState<{ key: string; data: Digest | null } | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const leaving = useRef<string | null>(null);
  useEffect(() => {
    if (!key || loading) return;
    const ctl = new AbortController(), since = readSeen();
    fetch(`/api/watch/digest?slugs=${encodeURIComponent(key)}${since ? `&since=${since}` : ""}&lang=${locale}`, { signal: ctl.signal })
      .then((r) => (r.ok ? (r.json() as Promise<Digest>) : null))
      .then((data) => {
        if (data && !since) writeSeen(data.today); // first visit: nothing to show, remember from now
        else if (data) leaving.current = data.today;
        setDigest({ key, data: since ? data : null });
      })
      .catch((e) => { if (e?.name !== "AbortError") setDigest({ key, data: null }); });
    return () => ctl.abort();
  }, [key, locale, loading]);
  useEffect(() => {
    const mark = () => { if (leaving.current) writeSeen(leaving.current); };
    window.addEventListener("pagehide", mark);
    return () => { window.removeEventListener("pagehide", mark); mark(); };
  }, []);

  if (loading) return <p className="text-sm text-muted">{t("Loading your watchlist…")}</p>;
  if (!key) return (
    <div className="space-y-8">
      <div className="card p-6 text-center">
        <p className="font-semibold">{t("You are not watching anyone yet.")}</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted">{t("Open any fighter’s profile and press ☆ Watch. Their next fight, last result and rating will show up here.")}</p>
        <a href={href("/boxers")} className="chip mt-4 !border-gold/60 !text-gold hover:!bg-gold/10">{t("Browse fighters")}</a>
      </div>
      <WatchlistAdd suggestions={suggestions} showSuggestions />
    </div>
  );
  if (loaded?.key !== key) return <p className="text-sm text-muted">{t("Loading your watchlist…")}</p>;
  if (!loaded.rows) return <p className="text-sm text-muted">{t("Couldn’t load your watchlist. Try again in a moment.")}</p>;
  const rows = [...loaded.rows].sort(byNext);
  const res = { W: t("W"), L: t("L"), D: t("D"), NC: t("NC") };
  const tone = { W: "bg-win/15 text-win", L: "bg-red/15 text-red-ink", D: "bg-white/10 text-muted", NC: "bg-white/10 text-muted" };
  return (
    <div className="space-y-4">
    {!dismissed && digest?.key === key && digest.data ? <WatchDigest digest={digest.data} onSeen={() => { if (leaving.current) writeSeen(leaving.current); leaving.current = null; setDismissed(true); }} /> : null}
    <ul className="grid gap-3 md:grid-cols-2">
      {rows.map((f) => (
        <li key={f.slug} className="card flex flex-col gap-3 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <a href={href(`/boxers/${f.slug}`)} className="inline-block py-1 font-display text-xl font-bold uppercase leading-tight hover:text-gold">{f.name}</a>
              <div className="text-sm text-muted">
                {f.country ? <span aria-hidden="true">{flag(f.country)} </span> : null}
                <span className="tabular">{f.record}</span>
                {f.active === false ? <span> · {t("Retired")}</span> : null}
              </div>
            </div>
            {f.rating ? (
              <div className="shrink-0 text-end">
                <div className="tabular text-lg font-bold text-gold">{f.rating}</div>
                <div className="text-xs text-muted">{t("Elo-style")}</div>
                {f.ratingChange ? <div className={`tabular text-xs ${f.ratingChange > 0 ? "text-win" : "text-red-ink"}`} dir="ltr">{f.ratingChange > 0 ? "+" : ""}{f.ratingChange}</div> : null}
              </div>
            ) : null}
          </div>
          <dl className="grid gap-2 text-sm">
            <div className="flex items-baseline gap-2">
              <dt className="eyebrow w-20 shrink-0">{t("Next fight")}</dt>
              <dd className="min-w-0 text-gold">{f.nextBoutId ? <a href={href(`/bouts/${f.nextBoutId}`)} className="inline-block py-0.5 hover:underline">{f.next}</a> : t("No fight booked")}</dd>
            </div>
            <div className="flex items-baseline gap-2">
              <dt className="eyebrow w-20 shrink-0">{t("Last fight")}</dt>
              <dd className="min-w-0">
                {f.last ? (
                  <a href={href(`/bouts/${f.last.boutId}`)} className="inline-flex flex-wrap items-center gap-x-2 py-0.5 hover:underline">
                    <span className={`grid h-6 min-w-6 place-items-center rounded-md px-1 text-xs font-bold ${tone[f.last.result]}`}>{res[f.last.result]}</span>
                    <span>{t("{opponent}, {how}", { opponent: f.last.opponent, how: f.last.how })}</span>
                    <span className="text-xs text-muted">{fmtDate(f.last.date, { month: "short", day: "numeric", year: "numeric" }, locale)}</span>
                  </a>
                ) : <span className="text-muted">{t("No fights on record")}</span>}
              </dd>
            </div>
          </dl>
          <button onClick={() => void remove(f.slug)} className="chip cursor-pointer self-start !py-1.5 transition hover:text-ink" aria-label={t("Stop watching {name}", { name: f.name })}>
            {t("Remove from watchlist")}
          </button>
        </li>
      ))}
    </ul>
    <p className="text-xs text-muted">
      {mode === "account" ? t("Your watchlist is saved to your account.") : <>{t("Your watchlist is saved in this browser.")} <Link href="/account" className="inline-block py-1 text-ink underline decoration-dotted hover:text-gold">{t("Sign in to keep it on every device")}</Link></>}
    </p>
    <CalendarLinks slugs={list} locale={locale} />
    <WatchlistAdd suggestions={suggestions} showSuggestions={false} />
    </div>
  );
}
