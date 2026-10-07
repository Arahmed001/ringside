import fs from "node:fs";
import path from "node:path";
import { ImageResponse } from "next/og";
import type { Locale } from "./i18n/config";
import { tEn, type T } from "./i18n/t";
import { arabicForCard } from "./arabic-card";
import { ByteLru, budgetMb } from "./byte-lru";

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_TYPE = "image/png";

const font = (f: string) => fs.readFileSync(path.join(process.cwd(), "assets", "fonts", f));
let fonts: { name: string; data: Buffer; weight: 500 | 600 | 800; style: "normal" }[] | undefined;
const loadFonts = () => (fonts ??= [
  { name: "Barlow", data: font("BarlowCondensed-800.ttf"), weight: 800, style: "normal" },
  { name: "Barlow", data: font("BarlowCondensed-600.ttf"), weight: 600, style: "normal" },
  { name: "Tajawal", data: font("Tajawal-800.ttf"), weight: 800, style: "normal" },
  { name: "Tajawal", data: font("Tajawal-500.ttf"), weight: 500, style: "normal" },
]);

export interface OgCard {
  locale: Locale;
  t?: T;
  /** Small gold line above the title: "WELTERWEIGHT · UNITED STATES". */
  kicker?: string;
  title: string;
  subtitle?: string;
  stats?: { label: string; value: string }[];
  /** "red" is the first-listed fighter's corner, "blue" the second; gold for everything else (DESIGN.md colour meanings). */
  accent?: "red" | "blue" | "gold";
}

const ACCENT = { red: "#e5322d", blue: "#4a8cff", gold: "#d9b25f" };

/** A 1200x630 share card in the site's look: dark ring, one coloured glow, big condensed type. */
/**
 * How long a browser, a CDN or a link-preview robot may reuse a card without asking (RINGSIDE_OG_MAX_AGE, seconds), and how long after that it may show the
 * old one while it fetches a new one. A card is the same for every visitor (it depends on the address and the data, never on who asks), so it may be shared;
 * a record or a rating on it changes at most when the league is updated.
 */
const cardCacheControl = () => {
  const n = Number(process.env.RINGSIDE_OG_MAX_AGE);
  const age = process.env.RINGSIDE_OG_MAX_AGE !== undefined && process.env.RINGSIDE_OG_MAX_AGE !== "" && Number.isFinite(n) && n >= 0 ? Math.floor(n) : 600;
  return age === 0 ? "public, max-age=0, must-revalidate" : `public, max-age=${age}, stale-while-revalidate=3600`;
};

const og = globalThis as unknown as { __ringsideOgCache?: ByteLru<string, Buffer>; __ringsideOgInflight?: Map<string, Promise<Buffer>> };

/**
 * The share card as PNG bytes. Drawing one costs 220 to 380 ms of the server's one thread (docs/capacity.md), so what was drawn is kept, in a cache bounded by
 * bytes (RINGSIDE_OG_CACHE_MB, default 24; 0 turns it off) and shared by every route that draws cards. It is keyed by everything that goes into the picture
 * (language, every line of text, the numbers, the colour), not by the address, so a changed record is a different card at once and an unchanged one is the same
 * bytes; nothing can be served that was drawn for different words. Two requests for one card at the same moment draw it once.
 */
export async function ogCard(card: OgCard): Promise<Response> {
  const t = card.t ?? tEn;
  const key = JSON.stringify([card.locale, card.kicker ?? null, card.title, card.subtitle ?? null, card.stats ?? [], card.accent ?? "gold", t("Ratings, rankings and predictions")]);
  const cache = (og.__ringsideOgCache ??= new ByteLru<string, Buffer>(budgetMb(process.env.RINGSIDE_OG_CACHE_MB, 24)));
  const inflight = (og.__ringsideOgInflight ??= new Map());
  let bytes: Buffer | undefined = cache.get(key);
  if (!bytes) {
    let p = inflight.get(key);
    if (!p) {
      p = renderCard(card).arrayBuffer().then((b) => Buffer.from(b)).finally(() => inflight.delete(key));
      inflight.set(key, p);
    }
    const drawn: Buffer = await p;
    cache.set(key, drawn);
    bytes = drawn;
  }
  return new Response(new Uint8Array(bytes), { headers: { "Content-Type": OG_TYPE, "Cache-Control": cardCacheControl() } });
}

/** Draws a card (no cache): `ogCard` is what callers use. */
export function renderCard({ locale, t = tEn, kicker, title, subtitle, stats = [], accent = "gold" }: OgCard) {
  const ar = locale === "ar";
  const face = ar ? "Tajawal" : "Barlow";
  const color = ACCENT[accent];
  const size = title.length > 26 ? 84 : title.length > 16 ? 104 : 128;
  // The renderer does not reorder Arabic words, so right-to-left text is laid out word by word from the right (row-reverse) and wraps from the right;
  // each word goes through arabicForCard so it is measured as wide as it is drawn (no blank gaps, no early wrapping).
  const text = (txt: string, style: Record<string, string | number>) => ar
    ? <div style={{ display: "flex", flexDirection: "row-reverse", flexWrap: "wrap", columnGap: "0.28em", ...style }}>{txt.split(" ").filter(Boolean).map((x, i) => <span key={i} style={{ display: "flex" }}>{arabicForCard(x)}</span>)}</div>
    : <div style={{ display: "flex", flexWrap: "wrap", ...style }}>{txt}</div>;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "56px 72px", background: "#09090b", color: "#ecebe6", fontFamily: face, position: "relative" }}>
        <div style={{ position: "absolute", top: -260, [ar ? "left" : "right"]: -200, width: 900, height: 900, borderRadius: 900, background: color, opacity: 0.22, filter: "blur(90px)" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 14, alignSelf: ar ? "flex-end" : "flex-start" }}>
          <div style={{ width: 44, height: 44, borderRadius: 10, background: "#e5322d", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 30, fontWeight: 800, fontFamily: "Barlow" }}>R</div>
          <div style={{ fontFamily: "Barlow", fontSize: 38, fontWeight: 800, letterSpacing: 2, display: "flex" }}>RING<span style={{ color: "#e5322d" }}>SIDE</span></div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18, alignItems: ar ? "flex-end" : "flex-start" }}>
          {kicker && text(kicker, { fontSize: 30, fontWeight: ar ? 800 : 600, color, letterSpacing: ar ? 0 : 6, textTransform: "uppercase" })}
          {text(title, { fontSize: size, fontWeight: 800, lineHeight: 1.1, textTransform: ar ? "none" : "uppercase", ...(ar ? { justifyContent: "flex-start" } : {}) })}
          {subtitle && text(subtitle, { fontSize: 36, fontWeight: 500, color: "#b4b4c0" })}
        </div>
        <div style={{ display: "flex", flexDirection: ar ? "row-reverse" : "row", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div style={{ display: "flex", flexDirection: ar ? "row-reverse" : "row", gap: 44 }}>
            {stats.map((s) => (
              <div key={s.label} style={{ display: "flex", flexDirection: "column", alignItems: ar ? "flex-end" : "flex-start" }}>
                <div style={{ fontSize: 58, fontWeight: 800, color: "#ecebe6", display: "flex" }}>{s.value}</div>
                {text(s.label, { fontSize: 24, fontWeight: 500, color: "#8d8d99" })}
              </div>
            ))}
          </div>
          {text(t("Ratings, rankings and predictions"), { fontSize: 24, fontWeight: 500, color: "#8d8d99" })}
        </div>
      </div>
    ),
    { ...OG_SIZE, fonts: loadFonts() },
  );
}
