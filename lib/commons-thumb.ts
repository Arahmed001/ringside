/**
 * A picture from Wikimedia Commons at the size it is shown, not the size it was stored at. The enrichment keeps a 480 px thumbnail (or, for some files, the original) as a fighter's
 * photo; a list shows it in a 64 px box, so the visitor's browser was fetching 58 KB for a JPEG and up to 270 KB for a PNG to paint something 128 pixels wide. Commons makes a
 * thumbnail at any of its standard widths on request, so the address is rewritten to the smallest standard width that still covers twice the displayed width (a sharp picture on a
 * phone). Nothing is copied to this site: the visitor's browser still loads it from Wikimedia, as before, only smaller (measured: 58 KB to 6.5 KB for a JPEG, 267 KB to 34 KB for a PNG).
 *
 * Only widths of 250 px or less are ever asked for from an ORIGINAL address, because the enrichment accepts no photo narrower than 250 px (a larger request than the original is an
 * HTTP 400 from Commons, a broken picture). A thumbnail address is only ever made smaller than it already is. Any address that is not a Commons JPEG or PNG is returned unchanged.
 */
const STANDARD = [120, 250, 330, 500] as const;
const THUMB = /^(https:\/\/(?:thumb|upload)\.wikimedia\.org\/wikipedia\/commons\/thumb\/[0-9a-f]\/[0-9a-f]{2}\/([^/?]+\.(?:jpe?g|png)))\/(\d+)px-([^/?]+)(\?.*)?$/i;
const ORIGINAL = /^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/([0-9a-f])\/([0-9a-f]{2})\/([^/?]+\.(?:jpe?g|png))(\?.*)?$/i;

export function commonsWidthFor(cssWidth: number): number | null {
  const want = Math.ceil(cssWidth * 1.75);
  return STANDARD.find((w) => w >= want) ?? null;
}

export function sizedCommons(url: string, cssWidth: number): string {
  const w = commonsWidthFor(cssWidth);
  if (!w) return url;
  const t = THUMB.exec(url);
  if (t) return w < Number(t[3]) ? `${t[1]}/${w}px-${t[4]}${t[5] ?? ""}` : url;
  const o = ORIGINAL.exec(url);
  if (o && w <= 250) return `https://thumb.wikimedia.org/wikipedia/commons/thumb/${o[1]}/${o[2]}/${o[3]}/${w}px-${o[3]}`;
  return url;
}
