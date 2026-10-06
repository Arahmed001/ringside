import { Portrait } from "@/components/PortraitArt";
import { svgString } from "./svg-string";
import { hash } from "./hash";
import { DIVISIONS } from "./divisions";
import { isDemoData } from "./seo";
import type { Boxer } from "./types";

type P = Pick<Boxer, "id" | "slug" | "weightClass" | "stance">;

/** One background per weight division (the same palette the illustrated portraits draw from), so a list of placeholders still reads as a set. */
const PLACEHOLDER_BG: [string, string][] = [
  ["#3a1016", "#0f0b0c"], ["#10223f", "#0a0c12"], ["#2a2410", "#0e0d09"], ["#13302a", "#0a100e"],
  ["#2b1640", "#0d0a12"], ["#3a1d0e", "#100b08"],
];

/**
 * What a REAL fighter with no licensed photo shows: a plain head-and-shoulders silhouette on the division's colour. It depends on nothing about the
 * person (no skin, hair, beard, age or face), so it can never be read as a likeness or get a real person wrong. DESIGN.md: generated art must never look
 * like a real person's likeness.
 */
export function placeholderSvg(boxer: P): string {
  const i = Math.max(0, DIVISIONS.findIndex((d) => d.name === boxer.weightClass));
  const [c0, c1] = PLACEHOLDER_BG[i % PLACEHOLDER_BG.length];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 150" width="120" height="150"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c0}"/><stop offset="1" stop-color="${c1}"/></linearGradient></defs><rect width="120" height="150" fill="url(#g)"/><circle cx="60" cy="62" r="24" fill="#ffffff" fill-opacity=".16"/><path d="M16 150C16 112 36 98 60 98s44 14 44 52z" fill="#ffffff" fill-opacity=".16"/></svg>`;
}

/**
 * The standalone SVG document for a fighter with no photo. The demo league's fighters are fictional, so they get the illustrated portraits; a real-data site
 * gets the neutral silhouette (above). No text and no page fonts, so it renders the same as an <img>.
 */
export function portraitSvg(boxer: P): string {
  if (!isDemoData()) return placeholderSvg(boxer);
  const body = svgString(Portrait({ boxer, uid: "p" }));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 150" width="120" height="150">${body}</svg>`;
}

/** Strong-enough validator for a deterministic body: the same fighter and division always give the same tag. */
export const etagOf = (body: string) => `"${hash(body).toString(36)}-${body.length}"`;
