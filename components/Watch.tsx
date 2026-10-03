"use client";
import { useLocal } from "@/lib/useLocal";

const KEY = "ringside:watchlist";
const EMPTY: string[] = [];

export function WatchButton({ slug }: { slug: string }) {
  const [list, setList] = useLocal<string[]>(KEY, EMPTY);
  const on = list.includes(slug);
  return (
    <button onClick={() => setList(on ? list.filter((s) => s !== slug) : [...list, slug])}
      className={`chip cursor-pointer transition ${on ? "!border-gold/60 !bg-gold/10 !text-gold" : "hover:text-ink"}`} aria-pressed={on}>
      {on ? "★ Watching" : "☆ Watch"}
    </button>
  );
}

export function WatchlistStrip({ fighters }: { fighters: { slug: string; name: string; record: string; next?: string }[] }) {
  const [list] = useLocal<string[]>(KEY, EMPTY);
  const mine = fighters.filter((f) => list.includes(f.slug));
  if (!mine.length) return <p className="text-sm text-muted">Star a fighter (☆ Watch on any profile) and their next fight shows up here.</p>;
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {mine.map((f) => (
        <li key={f.slug}><a href={`/boxers/${f.slug}`} className="card flex items-center justify-between p-3 text-sm hover:border-gold/40"><span><b>{f.name}</b> <span className="text-muted">{f.record}</span></span><span className="text-xs text-gold">{f.next ?? "No fight booked"}</span></a></li>
      ))}
    </ul>
  );
}
