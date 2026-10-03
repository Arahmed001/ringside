import fs from "node:fs";
import path from "node:path";
import { ImageResponse } from "next/og";
import type { Locale } from "./i18n/config";
import { tEn, type T } from "./i18n/t";

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
export function ogCard({ locale, t = tEn, kicker, title, subtitle, stats = [], accent = "gold" }: OgCard) {
  const ar = locale === "ar";
  const face = ar ? "Tajawal" : "Barlow";
  const color = ACCENT[accent];
  const size = title.length > 26 ? 84 : title.length > 16 ? 104 : 128;
  // The renderer does not reorder Arabic words, so right-to-left text is laid out word by word from the right (row-reverse) and wraps from the right.
  const text = (txt: string, style: Record<string, string | number>) => ar
    ? <div style={{ display: "flex", flexDirection: "row-reverse", flexWrap: "wrap", columnGap: "0.28em", ...style }}>{txt.split(" ").filter(Boolean).map((x, i) => <span key={i} style={{ display: "flex" }}>{x}</span>)}</div>
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
