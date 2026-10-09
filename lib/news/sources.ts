/**
 * The boxing news feeds the site may list, and what each publisher lets a site do with them. The site shows a headline, a short excerpt the feed itself publishes,
 * the outlet's name, the date and a link to the original: never an article body and never an image. Every entry says why it is allowed.
 *
 * `use: "open"` is a feed with no restriction on being listed (an independent outlet's public feed). `use: "noncommercial"` is a feed whose publisher limits it to
 * non-commercial sites (the public broadcasters and newspapers): it is fetched only when the owner sets NEWS_NONCOMMERCIAL=1, which is the owner's statement
 * that the site earns nothing (no advertising, no sales, no paid tier).
 */
export interface NewsSource { id: string; name: string; feed: string; home: string; use: "open" | "noncommercial"; note: string; /** false: the feed's excerpt is damaged (names cut out of it), so only the headline is kept */ excerpt?: boolean; /** "video": an official YouTube channel's public feed; its items are played (after a click) in YouTube's own player, never copied */ kind?: "video" }

export const NEWS_SOURCES: NewsSource[] = [
  { id: "boxing-news", name: "Boxing News", feed: "https://www.boxingnewsonline.net/feed/", home: "https://www.boxingnewsonline.net/", use: "open", excerpt: false, note: "Public WordPress feed; no restriction stated on listing headlines with a link. Its excerpts lack the names (they begin \"already has another plan...\"), so only headlines are kept." },
  { id: "boxing-news-24", name: "Boxing News 24", feed: "https://www.boxingnews24.com/feed/", home: "https://www.boxingnews24.com/", use: "open", note: "Public WordPress feed; no restriction stated on listing headlines with a link." },
  { id: "15-rounds", name: "15Rounds", feed: "https://www.15rounds.com/feed/", home: "https://www.15rounds.com/", use: "open", note: "Public WordPress feed; no restriction stated on listing headlines with a link." },
  { id: "world-boxing-news", name: "World Boxing News", feed: "https://www.worldboxingnews.com/feed/", home: "https://www.worldboxingnews.com/", use: "open", note: "Public WordPress feed; no restriction stated on listing headlines with a link." },
  { id: "bbc-sport", name: "BBC Sport", feed: "https://feeds.bbci.co.uk/sport/boxing/rss.xml", home: "https://www.bbc.co.uk/sport/boxing", use: "noncommercial", note: "BBC feeds are for personal, non-commercial use." },
  { id: "guardian", name: "The Guardian", feed: "https://www.theguardian.com/sport/boxing/rss", home: "https://www.theguardian.com/sport/boxing", use: "noncommercial", note: "Guardian feeds are free for non-commercial use with a link back." },
  { id: "sky-sports", name: "Sky Sports", feed: "https://www.skysports.com/rss/12040", home: "https://www.skysports.com/boxing", use: "noncommercial", note: "Sky Sports feeds are for personal, non-commercial use." },
];

/** Official channels of promoters and networks. Each channel id was read from the channel's own page and checked against the channel's title and a recent upload (2026-10-08).
 * Embedding through YouTube's own player is what YouTube provides for; nothing of the video or its picture is copied or loaded before a visitor presses play. */
const yt = (id: string, name: string, channel: string): NewsSource => ({ id: `yt-${id}`, name, feed: `uploads:${channel}`, home: `https://www.youtube.com/channel/${channel}`, use: "open", kind: "video", note: "The channel's list of uploads, read with YouTube's Data API (YouTube's robots.txt closes its RSS feeds to bots); played in YouTube's own embedded player after a click." });
export const VIDEO_SOURCES: NewsSource[] = [
  yt("dazn-boxing", "DAZN Boxing", "UCurvRE5fGcdUgCYWgh-BDsg"), yt("matchroom", "Matchroom Boxing", "UC7LReVje9aPB4B6XAsXX8WQ"), yt("top-rank", "Top Rank Boxing", "UCbzRzJNHx7ZLlJML9BjZQVQ"),
  yt("queensberry", "Queensberry Promotions", "UCP3MOjimNiqqkhBcuXzO0RA"), yt("sky-boxing", "Sky Sports Boxing", "UC_JQGBtA7P0RwkRxd7xpJcA"), yt("probox", "ProBox TV", "UCT7Mm-aRWBZ1Zd2bIXIEsyg"),
  yt("pbc", "Premier Boxing Champions", "UCWXYAGB9SadlL6p5Bb66wWw"), yt("golden-boy", "Golden Boy Boxing", "UC518BHmSjZ2R1UanxO9nHmg"),
];
export const ALL_SOURCES: NewsSource[] = [...NEWS_SOURCES, ...VIDEO_SOURCES];
export const isVideoSource = (id: string): boolean => id.startsWith("yt-");
/** The 11-character id of a YouTube video from its watch address, or null. */
export const videoIdOf = (url: string): string | null => { try { const u = new URL(url); return /(^|\.)youtube\.com$/.test(u.hostname) && /^[A-Za-z0-9_-]{11}$/.test(u.searchParams.get("v") ?? "") ? u.searchParams.get("v") : null; } catch { return null; } };

export const sourcesFor = (noncommercial: boolean = process.env.NEWS_NONCOMMERCIAL === "1"): NewsSource[] => ALL_SOURCES.filter((s) => s.use === "open" || noncommercial);
