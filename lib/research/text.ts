/** Plain text from an HTML page: scripts, styles and page furniture removed, entities decoded, whitespace collapsed. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|nav|footer|header|form|iframe)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|li|tr|h[1-6]|br|section|article|table)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;|&rsquo;|&lsquo;/g, "'")
    .replace(/&ndash;|&mdash;/g, "-").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/[ \t\f\v]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}

/** For comparing a quote with a page: case, quote marks, dashes, thousands commas inside numbers and runs of space are all ignored. */
export function squash(s: string): string {
  return s.normalize("NFKC").toLowerCase()
    .replace(/[‘’‚‛`´]/g, "'").replace(/[“”„‟]/g, '"').replace(/[‐-―−]/g, "-")
    .replace(/(\d),(?=\d{3}\b)/g, "$1")
    .replace(/[^\p{L}\p{N}$%.\-'" ]+/gu, " ").replace(/\s+/g, " ").trim();
}

const SCALE: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, mn: 1e6, mm: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9 };

/** Every number a passage states, as a plain value: "$72.2 million" -> 72200000 (and 72.2), "16,219" -> 16219, "4.6M" -> 4600000. */
export function numbersIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(million|billion|thousand|mn|bn|mm|m|b|k)?\b/gi)) {
    const base = Number(m[1].replace(/,/g, ""));
    if (!Number.isFinite(base)) continue;
    out.push(base);
    const unit = m[2]?.toLowerCase();
    if (unit && SCALE[unit]) out.push(base * SCALE[unit]);
  }
  return out;
}

/** True when `value` is one of the numbers in `text`, allowing for the rounding a headline does ("$72.2 million" for 72,198,500). */
export function numberStated(value: number, text: string, tolerance = 0.006): boolean {
  return numbersIn(text).some((n) => (value === 0 ? n === 0 : Math.abs(n - value) / Math.abs(value) <= tolerance));
}

/** Registrable-ish domain: "www.espn.com" -> "espn.com", "news.bbc.co.uk" -> "bbc.co.uk". */
export function hostOf(url: string): string {
  try {
    const h = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    const parts = h.split(".");
    if (parts.length <= 2) return h;
    const two = parts.slice(-2).join(".");
    return /^(co|com|org|gov|ac|net)\.[a-z]{2}$/.test(two) ? parts.slice(-3).join(".") : two;
  } catch { return ""; }
}
