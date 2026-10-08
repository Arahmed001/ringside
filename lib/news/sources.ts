/**
 * The boxing news feeds the site may list, and what each publisher lets a site do with them. The site shows a headline, a short excerpt the feed itself publishes,
 * the outlet's name, the date and a link to the original: never an article body and never an image. Every entry says why it is allowed.
 *
 * `use: "open"` is a feed with no restriction on being listed (an independent outlet's public feed). `use: "noncommercial"` is a feed whose publisher limits it to
 * non-commercial sites (the public broadcasters and newspapers): it is fetched only when the owner sets NEWS_NONCOMMERCIAL=1, which is the owner's statement
 * that the site earns nothing (no advertising, no sales, no paid tier).
 */
export interface NewsSource { id: string; name: string; feed: string; home: string; use: "open" | "noncommercial"; note: string; /** false: the feed's excerpt is damaged (names cut out of it), so only the headline is kept */ excerpt?: boolean }

export const NEWS_SOURCES: NewsSource[] = [
  { id: "boxing-news", name: "Boxing News", feed: "https://www.boxingnewsonline.net/feed/", home: "https://www.boxingnewsonline.net/", use: "open", excerpt: false, note: "Public WordPress feed; no restriction stated on listing headlines with a link. Its excerpts lack the names (they begin \"already has another plan...\"), so only headlines are kept." },
  { id: "boxing-news-24", name: "Boxing News 24", feed: "https://www.boxingnews24.com/feed/", home: "https://www.boxingnews24.com/", use: "open", note: "Public WordPress feed; no restriction stated on listing headlines with a link." },
  { id: "15-rounds", name: "15Rounds", feed: "https://www.15rounds.com/feed/", home: "https://www.15rounds.com/", use: "open", note: "Public WordPress feed; no restriction stated on listing headlines with a link." },
  { id: "world-boxing-news", name: "World Boxing News", feed: "https://www.worldboxingnews.com/feed/", home: "https://www.worldboxingnews.com/", use: "open", note: "Public WordPress feed; no restriction stated on listing headlines with a link." },
  { id: "bbc-sport", name: "BBC Sport", feed: "https://feeds.bbci.co.uk/sport/boxing/rss.xml", home: "https://www.bbc.co.uk/sport/boxing", use: "noncommercial", note: "BBC feeds are for personal, non-commercial use." },
  { id: "guardian", name: "The Guardian", feed: "https://www.theguardian.com/sport/boxing/rss", home: "https://www.theguardian.com/sport/boxing", use: "noncommercial", note: "Guardian feeds are free for non-commercial use with a link back." },
  { id: "sky-sports", name: "Sky Sports", feed: "https://www.skysports.com/rss/12040", home: "https://www.skysports.com/boxing", use: "noncommercial", note: "Sky Sports feeds are for personal, non-commercial use." },
];

export const sourcesFor = (noncommercial: boolean = process.env.NEWS_NONCOMMERCIAL === "1"): NewsSource[] => NEWS_SOURCES.filter((s) => s.use === "open" || noncommercial);
