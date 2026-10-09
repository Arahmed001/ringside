import type { DatabaseSync } from "node:sqlite";
import { parseRobots, robotsAllows, readCapped } from "../research/fetcher";
import { publicHostOnly } from "../research/netguard";
import { parseFeed, type NewsEntry } from "./parse";
import { prune, saveEntries } from "./store";
import { sourcesFor, type NewsSource } from "./sources";

export const MAX_FEED_BYTES = 1_500_000;
export type FeedOutcome = { source: string; ok: boolean; status: string; added: number; items: number };

export interface RefreshOptions {
  contact: string;
  fetchImpl?: typeof fetch;
  sources?: NewsSource[];
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  hostCheck?: (host: string) => Promise<string | null>;
  now?: () => number;
  log?: (line: string) => void;
}

/**
 * Reads each outlet's public feed once: identifies itself (name and contact in the User-Agent), reads robots.txt first and stays away from what it forbids, asks only for
 * what changed since last time (ETag / Last-Modified), takes only XML, stops at 1.5 MB, follows no redirect to another site, and never fetches a private address. A feed
 * that refuses (401, 403, 429) is left alone until the next run and not retried. One outlet failing never stops the others.
 */
export async function refreshNews(db: DatabaseSync, o: RefreshOptions): Promise<FeedOutcome[]> {
  if (!o.contact || !/@|^https?:\/\//.test(o.contact)) throw new Error("A contact (an email address or web page) is needed: it goes in the User-Agent so an outlet can reach whoever runs this. Set NEWS_CONTACT.");
  const f = o.fetchImpl ?? fetch, log = o.log ?? (() => {}), sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = o.now ?? Date.now;
  const headers = { "user-agent": `RingsideNews/1.0 (+${o.contact})`, accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8" };
  const state = db.prepare("SELECT * FROM news_feeds WHERE source = ?");
  const setState = db.prepare("INSERT INTO news_feeds (source, etag, last_modified, checked_at, status, items) VALUES (?,?,?,?,?,?) ON CONFLICT(source) DO UPDATE SET etag = COALESCE(excluded.etag, news_feeds.etag), last_modified = COALESCE(excluded.last_modified, news_feeds.last_modified), checked_at = excluded.checked_at, status = excluded.status, items = excluded.items");
  const out: FeedOutcome[] = [];
  const hostCheck = o.hostCheck ?? publicHostOnly;
  for (const s of o.sources ?? sourcesFor()) {
    const res = async (): Promise<FeedOutcome> => {
      const u = new URL(s.feed);
      const refused = await hostCheck(u.hostname);
      if (refused) return { source: s.id, ok: false, status: `refused: ${refused}`, added: 0, items: 0 };
      // robots.txt: no file means no limits; 401/403 means stay away
      let rules = { allow: [] as string[], disallow: [] as string[], crawlDelay: undefined as number | undefined };
      try {
        const r = await f(`${u.origin}/robots.txt`, { headers, redirect: "manual", signal: AbortSignal.timeout(15000) });
        if (r.ok) rules = { ...rules, ...parseRobots(await readCapped(r, 100_000), "ringsidenews") };
        else if (r.status === 401 || r.status === 403) rules = { allow: [], disallow: ["/"], crawlDelay: undefined };
      } catch { /* unreachable robots.txt: the feed fetch below will say if the site is down */ }
      if (!robotsAllows(rules as Parameters<typeof robotsAllows>[0], u.pathname + u.search)) return { source: s.id, ok: false, status: "robots.txt disallows the feed", added: 0, items: 0 };
      const prev = state.get(s.id) as { etag: string | null; last_modified: string | null } | undefined;
      const h: Record<string, string> = { ...headers };
      if (prev?.etag) h["if-none-match"] = prev.etag;
      if (prev?.last_modified) h["if-modified-since"] = prev.last_modified;
      let r: Response;
      try { r = await f(s.feed, { headers: h, redirect: "manual", signal: AbortSignal.timeout(20000) }); }
      catch (e) { return { source: s.id, ok: false, status: `network: ${(e as Error).message}`, added: 0, items: 0 }; }
      if (r.status >= 300 && r.status < 400 && r.status !== 304) {
        const loc = r.headers.get("location");
        let to: URL | null = null; try { to = loc ? new URL(loc, s.feed) : null; } catch { /* not a URL */ }
        if (!to || to.hostname.replace(/^www\./, "") !== u.hostname.replace(/^www\./, "") || !/^https?:$/.test(to.protocol)) return { source: s.id, ok: false, status: "redirects to another site: not followed", added: 0, items: 0 };
        const why = await hostCheck(to.hostname);
        if (why) return { source: s.id, ok: false, status: `refused: ${why}`, added: 0, items: 0 };
        try { r = await f(to.href, { headers: h, redirect: "manual", signal: AbortSignal.timeout(20000) }); } catch (e) { return { source: s.id, ok: false, status: `network: ${(e as Error).message}`, added: 0, items: 0 }; }
      }
      if (r.status === 304) return { source: s.id, ok: true, status: "unchanged", added: 0, items: 0 };
      if ([401, 403, 429, 451].includes(r.status)) return { source: s.id, ok: false, status: `HTTP ${r.status}: refused, not retried`, added: 0, items: 0 };
      if (!r.ok) return { source: s.id, ok: false, status: `HTTP ${r.status}`, added: 0, items: 0 };
      if (!/xml/i.test(r.headers.get("content-type") ?? "")) return { source: s.id, ok: false, status: `not a feed (${r.headers.get("content-type") ?? "no content type"})`, added: 0, items: 0 };
      const body = await readCapped(r, MAX_FEED_BYTES);
      const entries: NewsEntry[] = parseFeed(body).map((e) => (s.excerpt === false ? { ...e, snippet: "" } : e));
      if (!entries.length) return { source: s.id, ok: false, status: "no readable items", added: 0, items: 0 };
      const added = saveEntries(db, s.id, entries, new Date(now()).toISOString());
      setState.run(s.id, r.headers.get("etag"), r.headers.get("last-modified"), new Date(now()).toISOString(), "ok", entries.length);
      return { source: s.id, ok: true, status: "ok", added, items: entries.length };
    };
    const outcome = await res();
    if (!outcome.ok || outcome.status === "unchanged") setState.run(s.id, null, null, new Date(now()).toISOString(), outcome.status, outcome.items);
    log(`${s.name}: ${outcome.status}${outcome.ok && outcome.added ? `, ${outcome.added} new of ${outcome.items}` : ""}`);
    out.push(outcome);
    await sleep(o.delayMs ?? 3000);
  }
  prune(db, now());
  return out;
}
