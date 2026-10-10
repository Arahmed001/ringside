import { splitLocale } from "./i18n/config";

/**
 * The pure parts of the link checker (scripts/check-links.ts): reading the links and headings out of a page, deciding whether a link is ours, and the rules a link must
 * pass. Nothing here touches the network, so every rule is tested on small pages (tests/link-check.test.ts).
 */

export interface Anchor {
  href: string;
  /** What a visitor reads: the link's own text, or the alt text of a picture inside it */
  text: string;
  /** a name given in an attribute (aria-label, or title when there is no aria-label) */
  label: string;
  /** hidden from screen readers and the keyboard on purpose (a decorative duplicate, such as a dot on the map) */
  hidden: boolean;
}

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const plain = (html: string) => decode(html.replace(/<img[^>]*alt="([^"]*)"[^>]*>/g, " $1 ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());

export function extractAnchors(html: string): Anchor[] {
  const out: Anchor[] = [];
  for (const m of html.matchAll(/<a\s([^>]*?)>([\s\S]*?)<\/a>/g)) {
    const href = m[1].match(/href="([^"]*)"/)?.[1];
    if (href === undefined) continue;
    out.push({ href: decode(href), text: plain(m[2]), label: decode(m[1].match(/aria-label="([^"]*)"/)?.[1] ?? m[1].match(/(?:^|\s)title="([^"]*)"/)?.[1] ?? ""), hidden: /aria-hidden="true"/.test(m[1]) });
  }
  return out;
}

export interface PageInfo { title: string; h1: string; ids: Set<string> }
export function pageInfo(html: string): PageInfo {
  return {
    title: decode(html.match(/<title[^>]*>([^<]*)<\/title>/)?.[1] ?? ""),
    h1: plain(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? ""),
    ids: new Set([...html.matchAll(/\s(?:id|name)="([^"]+)"/g)].map((m) => m[1])),
  };
}

export type Target =
  | { kind: "internal"; path: string; frag: string }
  | { kind: "external"; url: string }
  | { kind: "skip" };

/** Where a link goes, as the site sees it. `base` is the address being checked, so an absolute link back to ourselves counts as internal. */
export function classify(href: string, base: string, from: string): Target {
  if (!href || /^(mailto:|tel:|javascript:|data:)/i.test(href)) return { kind: "skip" };
  let u: URL;
  try { u = new URL(href, new URL(from, base)); } catch { return { kind: "skip" }; }
  if (u.origin !== new URL(base).origin) return /^https?:$/.test(u.protocol) ? { kind: "external", url: u.href } : { kind: "skip" };
  return { kind: "internal", path: u.pathname + u.search, frag: decodeURIComponent(u.hash.replace(/^#/, "")) };
}

/** Not pages: the file types and service routes a link may point at without being a page to read. */
export const isAsset = (path: string) => /^\/(_next|api|sitemaps|opengraph)(\/|$)/.test(path) || /\.(png|jpe?g|svg|webp|gif|ico|xml|txt|json|css|js|pdf)(\?.*)?$/.test(path.split("#")[0]);

/** `/boxers/x?y=1` and `/ar/boxers/z` are the same kind of page: `/boxers/*`. The crawl reads only a few of each kind. */
export function routePattern(path: string): string {
  const { path: bare } = splitLocale(path.split("?")[0]);
  const parts = bare.split("/").filter(Boolean);
  return parts.length ? parts.map((s, i) => (i === 0 ? s : "*")).join("/") : "/";
}

/**
 * A page in one language must link to pages in that language. The one link allowed to cross is the language switch itself.
 * Returns what is wrong, or null.
 */
export function localeProblem(fromPath: string, toPath: string, text: string): string | null {
  if (isAsset(toPath) || /^\/(feeds|embed)(\/|$)/.test(toPath)) return null;
  const a = splitLocale(fromPath.split("?")[0]).locale, b = splitLocale(toPath.split("?")[0]).locale;
  if (a === b) return null;
  if (/^(English|العربية)$/.test(text.trim())) return null; // the switcher
  return `a ${a} page links to a ${b} page`;
}

const STOP = new Set("the a an of and in on to for with at by from vs all view more read see open full this that your my our new what who how is are as or any every top best".split(" "));
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const words = (s: string) => new Set(fold(s).split(" ").filter((w) => w.length > 2 && !STOP.has(w)).map((w) => w.slice(0, 5)));

/**
 * Does a link's text have anything to do with the page it leads to? True when they share a word, or the text has no words to compare.
 * A hint for a person to read, not a rule: a filter chip ("Heavyweight") on the page it filters shares nothing with that page's heading.
 */
export function sharesWord(text: string, heading: string): boolean {
  const t = words(text);
  if (!t.size) return true;
  const h = words(heading);
  for (const w of t) if (h.has(w)) return true;
  return false;
}

/** Link texts that point at their own page's views (filter chips, sort headers, "next day"): never worth a second look. */
export const looksLikeControl = (fromPath: string, toPath: string) => fromPath.split("?")[0] === toPath.split("?")[0];
