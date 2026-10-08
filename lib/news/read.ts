import { getDb } from "../db";
import type { World } from "../world";
import { memo } from "../memo";
import { latest, type NewsItem } from "./store";
import { newsByFighter } from "./match";
import { ALL_SOURCES } from "./sources";

/** The newest headlines held, read at most every five minutes (a refresh runs hourly at most). */
let cached: { at: number; items: NewsItem[] } | null = null;
export async function recentNews(): Promise<NewsItem[]> {
  const now = Date.now();
  if (cached && now - cached.at < 5 * 60_000) return cached.items;
  const items = latest(await getDb(), 300, undefined, "news");
  cached = { at: now, items };
  return items;
}

let cachedVideos: { at: number; items: NewsItem[] } | null = null;
/** The newest official videos held (the same five-minute read). */
export async function recentVideos(): Promise<NewsItem[]> {
  const now = Date.now();
  if (cachedVideos && now - cachedVideos.at < 5 * 60_000) return cachedVideos.items;
  const items = latest(await getDb(), 200, undefined, "video");
  cachedVideos = { at: now, items };
  return items;
}
/** For tests: forget what was read. */
export const forgetNews = () => { cached = null; cachedVideos = null; };

export const sourceName = (id: string): string => ALL_SOURCES.find((s) => s.id === id)?.name ?? id;

const byFighter = (w: World, items: NewsItem[]) => memo(w, `newsByFighter:${items.length}:${items[0]?.id ?? 0}`, () => newsByFighter(w, items));

/** Headlines that name this fighter, newest first. */
export async function newsForFighter(w: World, boxerId: number, limit = 5): Promise<NewsItem[]> {
  const items = await recentNews();
  return items.length ? (byFighter(w, items).get(boxerId) ?? []).slice(0, limit) : [];
}

/** Headlines that name a fighter on this card, newest first, each once. */
export async function newsForEvent(w: World, eventId: number, limit = 6): Promise<NewsItem[]> {
  const items = await recentNews();
  if (!items.length) return [];
  const map = byFighter(w, items), ids = new Set<number>(), out: NewsItem[] = [];
  for (const b of w.bouts) if (b.eventId === eventId) { ids.add(b.redId); ids.add(b.blueId); }
  const seen = new Set<number>();
  for (const id of ids) for (const it of map.get(id) ?? []) if (!seen.has(it.id)) { seen.add(it.id); out.push(it); }
  return out.sort((a, b) => (b.published ?? "").localeCompare(a.published ?? "")).slice(0, limit);
}

/** Official videos that name this fighter, newest first. */
export async function videosForFighter(w: World, boxerId: number, limit = 3): Promise<NewsItem[]> {
  const items = await recentVideos();
  return items.length ? (memo(w, `videosByFighter:${items.length}:${items[0]?.id ?? 0}`, () => newsByFighter(w, items)).get(boxerId) ?? []).slice(0, limit) : [];
}

/** Official videos that name a fighter on this card, newest first. */
export async function videosForEvent(w: World, eventId: number, limit = 3): Promise<NewsItem[]> {
  const items = await recentVideos();
  if (!items.length) return [];
  const map = memo(w, `videosByFighter:${items.length}:${items[0]?.id ?? 0}`, () => newsByFighter(w, items)), ids = new Set<number>(), seen = new Set<number>(), out: NewsItem[] = [];
  for (const b of w.bouts) if (b.eventId === eventId) { ids.add(b.redId); ids.add(b.blueId); }
  for (const id of ids) for (const it of map.get(id) ?? []) if (!seen.has(it.id)) { seen.add(it.id); out.push(it); }
  return out.sort((a, b) => (b.published ?? "").localeCompare(a.published ?? "")).slice(0, limit);
}
