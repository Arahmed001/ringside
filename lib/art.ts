import { Portrait } from "@/components/PortraitArt";
import { svgString } from "./svg-string";
import { hash } from "./hash";
import type { Boxer } from "./types";

/** The standalone SVG document for a generated portrait. No text and no page fonts, so it renders the same as an <img>. */
export function portraitSvg(boxer: Pick<Boxer, "id" | "slug" | "weightClass" | "stance">): string {
  const body = svgString(Portrait({ boxer, uid: "p" }));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 150" width="120" height="150">${body}</svg>`;
}

/** Strong-enough validator for a deterministic body: the same fighter and division always give the same tag. */
export const etagOf = (body: string) => `"${hash(body).toString(36)}-${body.length}"`;
