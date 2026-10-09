import type { DatabaseSync } from "node:sqlite";
import { saveEntries } from "./store";
import { VIDEO_SOURCES, videoIdOf, type NewsSource } from "./sources";
import type { NewsEntry } from "./parse";
import { MAX_TITLE, plain } from "./parse";

/**
 * The newest uploads of the official channels, read with YouTube's Data API (a key of the owner's own, YOUTUBE_API_KEY: free, 10,000 units a day, one unit per channel per
 * run). YouTube's robots.txt closes its RSS feeds to bots, so the API is the way it provides. Only the title, the date and the watch address are kept: not the description, not
 * the picture. Without a key nothing is read. The key is sent to Google and nowhere else, and is never written to the database, a log or an error message.
 */
export const API = "https://www.googleapis.com/youtube/v3/playlistItems";
export type VideoOutcome = { source: string; ok: boolean; status: string; added: number };

export function entriesFrom(body: unknown): NewsEntry[] {
  const items = (body as { items?: unknown[] })?.items;
  if (!Array.isArray(items)) return [];
  const out: NewsEntry[] = [];
  for (const raw of items.slice(0, 50)) {
    const sn = (raw as { snippet?: { title?: unknown; publishedAt?: unknown; resourceId?: { videoId?: unknown } } })?.snippet;
    const id = typeof sn?.resourceId?.videoId === "string" ? sn.resourceId.videoId : "";
    const url = `https://www.youtube.com/watch?v=${id}`;
    const title = typeof sn?.title === "string" ? plain(sn.title, MAX_TITLE) : "";
    if (!title || !videoIdOf(url) || /^(private|deleted) video$/i.test(title)) continue;
    const t = typeof sn?.publishedAt === "string" ? Date.parse(sn.publishedAt) : NaN;
    out.push({ guid: `yt:video:${id}`, title, url, published: Number.isFinite(t) && t <= Date.now() + 86400_000 ? new Date(t).toISOString() : null, snippet: "" });
  }
  return out;
}

export async function refreshVideos(db: DatabaseSync, o: { key: string | undefined; contact: string; fetchImpl?: typeof fetch; sources?: NewsSource[]; delayMs?: number; sleep?: (ms: number) => Promise<void>; log?: (l: string) => void }): Promise<VideoOutcome[]> {
  const log = o.log ?? (() => {}), f = o.fetchImpl ?? fetch, sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const sources = o.sources ?? VIDEO_SOURCES;
  if (!o.key) { log("official videos: YOUTUBE_API_KEY is not set, so none were read"); return sources.map((s) => ({ source: s.id, ok: false, status: "no YOUTUBE_API_KEY", added: 0 })); }
  const out: VideoOutcome[] = [];
  for (const s of sources) {
    const channel = s.feed.replace(/^uploads:/, "");
    let res: VideoOutcome;
    if (!/^UC[A-Za-z0-9_-]{22}$/.test(channel)) res = { source: s.id, ok: false, status: "not a channel id", added: 0 };
    else {
      try {
        const r = await f(`${API}?part=snippet&maxResults=15&playlistId=UU${channel.slice(2)}&key=${encodeURIComponent(o.key)}`, { headers: { "user-agent": `RingsideNews/1.0 (+${o.contact})`, accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(20000) });
        if (!r.ok) res = { source: s.id, ok: false, status: `HTTP ${r.status}${r.status === 403 ? " (quota used up, or the key is not allowed to use the YouTube Data API)" : ""}`, added: 0 };
        else {
          const entries = entriesFrom(await r.json());
          res = entries.length ? { source: s.id, ok: true, status: "ok", added: saveEntries(db, s.id, entries) } : { source: s.id, ok: false, status: "no readable videos", added: 0 };
        }
      } catch (e) { res = { source: s.id, ok: false, status: `network: ${(e as Error).message.split(o.key).join("[key]")}`, added: 0 }; }
    }
    log(`${s.name}: ${res.status}${res.ok && res.added ? `, ${res.added} new` : ""}`);
    out.push(res);
    if (res.status.startsWith("HTTP 403")) break; // the quota or the key: the rest would fail the same way
    await sleep(o.delayMs ?? 500);
  }
  return out;
}
