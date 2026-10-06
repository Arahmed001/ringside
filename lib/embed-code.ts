/**
 * The code a site owner pastes to show a Ringside card (`/developers`). Pure, so the address it builds can be checked against the pages that serve it: the card kinds, the
 * language and theme in the address, a row count held to what the ranking card accepts (1 to 10), and everything put into the HTML escaped.
 */
export type EmbedKind = "fighter" | "rankings";
export interface EmbedChoice { kind: EmbedKind; lang: "en" | "ar"; theme: "dark" | "light"; slug?: string; division?: string; rows?: number }
export const EMBED_WIDTH = 460, EMBED_MAX_ROWS = 10;

const html = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The path of the card (no host), or null when what it needs (a fighter) is not chosen. */
export function embedPath(c: EmbedChoice): string | null {
  const lang = c.lang === "ar" ? "ar" : "en", theme = c.theme === "light" ? "light" : "dark";
  if (c.kind === "fighter") return c.slug ? `/embed/${lang}/fighter/${encodeURIComponent(c.slug)}?theme=${theme}` : null;
  const rows = Math.min(EMBED_MAX_ROWS, Math.max(1, Math.floor(c.rows ?? 5)));
  return c.division ? `/embed/${lang}/rankings/${encodeURIComponent(c.division)}?theme=${theme}&limit=${rows}` : null;
}
/** How tall the frame should be: a card is one size, a ranking grows with its rows. */
export const embedHeight = (c: EmbedChoice): number => (c.kind === "fighter" ? 290 : 120 + Math.min(EMBED_MAX_ROWS, Math.max(1, Math.floor(c.rows ?? 5))) * 42);

/** The iframe to paste. The address is on the site's own host; the title is for screen readers; a frame that cannot fit its page is allowed to shrink. */
export function embedSnippet(base: string, c: EmbedChoice): string | null {
  const path = embedPath(c);
  return path ? `<iframe src="${html(base.replace(/\/+$/, "") + path)}" width="${EMBED_WIDTH}" height="${embedHeight(c)}" style="border:0;max-width:100%" loading="lazy" title="Ringside"></iframe>` : null;
}
