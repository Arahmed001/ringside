import { Portrait } from "@/components/PortraitArt";
import { svgString } from "./svg-string";
import { hash } from "./hash";
import { isDemoData } from "./seo";
import type { Boxer } from "./types";

type P = Pick<Boxer, "id" | "slug" | "weightClass" | "stance">;

/** The one background every placeholder has: `--panel-2` (DESIGN.md), so it reads as an empty slot, not as a corner colour, and sits quietly beside real photos. */
const PLACEHOLDER_BG = "#1a1a21";

/**
 * What a REAL fighter with no licensed photo shows: a plain head-and-shoulders silhouette on one neutral background. It depends on nothing about the
 * person (no skin, hair, beard, age or face, and not even the division), so it can never be read as a likeness or get a real person wrong. DESIGN.md:
 * generated art must never look like a real person's likeness. (Until 2026-10-06 the background was tinted per division, red and blue among them, which
 * echoed the corner colours and looked loud beside photos.)
 */
export function placeholderSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 150" width="120" height="150"><rect width="120" height="150" fill="${PLACEHOLDER_BG}"/><circle cx="60" cy="62" r="24" fill="#ffffff" fill-opacity=".16"/><path d="M16 150C16 112 36 98 60 98s44 14 44 52z" fill="#ffffff" fill-opacity=".16"/></svg>`;
}

/**
 * The standalone SVG document for a fighter with no photo. The demo league's fighters are fictional, so they get the illustrated portraits; a real-data site
 * gets the neutral silhouette (above). No text and no page fonts, so it renders the same as an <img>.
 */
export function portraitSvg(boxer: P): string {
  if (!isDemoData()) return placeholderSvg();
  const body = svgString(Portrait({ boxer, uid: "p" }));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 150" width="120" height="150">${body}</svg>`;
}

/** Strong-enough validator for a deterministic body: the same fighter and division always give the same tag. */
export const etagOf = (body: string) => `"${hash(body).toString(36)}-${body.length}"`;
