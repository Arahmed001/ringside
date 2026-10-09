/**
 * RSS 2.0 and Atom, read without a library and read defensively: what comes out is plain text with a bounded length and a web address, whatever the feed sent. No markup,
 * no script, and no address that is not http(s). The one picture an item's own feed offers for it (media:content, media:thumbnail, an image enclosure, else the first <img> in
 * its text) is kept only as an https address: it is saved by lib/news/images.ts, never loaded from the visitor's browser. A broken item is skipped, never half-kept.
 */
export interface NewsEntry { guid: string; title: string; url: string; published: string | null; snippet: string; image?: string }

export const MAX_TITLE = 180, MAX_SNIPPET = 220, MAX_ITEMS_PER_FEED = 60;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”" };
const decode = (s: string): string => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => { const n = parseInt(h, 16); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : " "; })
  .replace(/&#(\d+);/g, (_, d) => { const n = parseInt(d, 10); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : " "; })
  .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
const UNSAFE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f​⁠‪-‮⁦-⁩﻿]/g;

/** Text from a feed field: CDATA unwrapped, markup removed (twice, since a field can hold escaped markup), entities decoded, spaces collapsed, cut at `max` on a word. */
export function plain(raw: string | undefined, max: number): string {
  if (!raw) return "";
  let t = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  for (let i = 0; i < 2; i++) t = decode(t.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]*>/g, " "));
  t = t.replace(UNSAFE, "").replace(/\s+/g, " ").replace(/ ([.,;:!?…])/g, "$1").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1), at = cut.lastIndexOf(" ");
  return (at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,;:.\-–—]+$/, "") + "…";
}

/** The address of the original: http(s) only, no credentials, no fragment, and no tracking parameters. */
export function cleanUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(decode(raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim()));
    if (!/^https?:$/.test(u.protocol) || u.username || u.password || u.href.length > 600) return null;
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|mc_|ref$|cmpid|ito$|at_)/i.test(k)) u.searchParams.delete(k);
    return u.href;
  } catch { return null; }
}

/** An https address for a picture (an http one is asked for as https): no credentials, a bounded length, not a data: address, not a tracking pixel. */
export function cleanImageUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(decode(raw.trim()).replace(/^http:\/\//i, "https://"));
    if (u.protocol !== "https:" || u.username || u.password || u.href.length > 500) return null;
    if (/\.(gif|svg)(\?|$)/i.test(u.pathname + u.search) || /(pixel|tracking|spacer|avatar|gravatar|logo)/i.test(u.pathname)) return null;
    u.hash = "";
    return u.href;
  } catch { return null; }
}

/** The one picture a feed item offers, in the order feeds usually give it. */
export function imageOf(block: string): string | null {
  const text = decode(block.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")); // markup that a feed escaped is markup again here
  const attr = (el: string, name: string) => el.match(new RegExp(`\\s${name}=["']([^"']+)["']`, "i"))?.[1];
  for (const el of text.match(/<media:content\s[^>]*>/gi) ?? []) { if (/medium=["']image["']|type=["']image\//i.test(el) || /\.(jpe?g|png|webp)(\?|["'])/i.test(el)) { const u = cleanImageUrl(attr(el, "url")); if (u) return u; } }
  for (const el of text.match(/<media:thumbnail\s[^>]*>/gi) ?? []) { const u = cleanImageUrl(attr(el, "url")); if (u) return u; }
  for (const el of text.match(/<enclosure\s[^>]*>/gi) ?? []) { if (/type=["']image\//i.test(el)) { const u = cleanImageUrl(attr(el, "url")); if (u) return u; } }
  for (const el of text.match(/<img\s[^>]*>/gi) ?? []) { const u = cleanImageUrl(attr(el, "src")); if (u) return u; }
  return null;
}

const tag = (block: string, name: string): string | undefined => {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? m[1] : undefined;
};

function isoDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const t = Date.parse(plain(raw, 80));
  if (!Number.isFinite(t) || t < Date.UTC(1990, 0, 1) || t > Date.now() + 2 * 86400_000) return null; // a date in the far future is a feed slip, not news
  return new Date(t).toISOString();
}

export function parseFeed(xml: string): NewsEntry[] {
  const out: NewsEntry[] = [];
  const blocks = [...xml.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)].slice(0, MAX_ITEMS_PER_FEED * 2);
  for (const [, , b] of blocks) {
    const title = plain(tag(b, "title"), MAX_TITLE);
    let link = cleanUrl(tag(b, "link"));
    if (!link) { // Atom: <link rel="alternate" href="..."/>
      const m = [...b.matchAll(/<link\s[^>]*>/gi)].map((x) => x[0]).find((l) => !/rel=["'](?!alternate)/i.test(l));
      const href = m?.match(/href=["']([^"']+)["']/i)?.[1];
      link = cleanUrl(href);
    }
    if (!title || !link) continue;
    const guid = plain(tag(b, "guid") ?? tag(b, "id"), 300) || link;
    const snippet = plain((tag(b, "description") ?? tag(b, "summary") ?? "").replace(/The post .{1,200}? appeared first on .{1,120}$/i, ""), MAX_SNIPPET);
    const image = imageOf(b);
    out.push({ guid, title, url: link, published: isoDate(tag(b, "pubDate") ?? tag(b, "published") ?? tag(b, "updated") ?? tag(b, "dc:date")), snippet: snippet === title ? "" : snippet, ...(image ? { image } : {}) });
    if (out.length >= MAX_ITEMS_PER_FEED) break;
  }
  return out;
}
