/**
 * What a recorded picture must have before the site shows it: a licence that allows showing it (or the rights-holder's permission, with the evidence), the credit that goes with it,
 * where it came from, and an address on the web that is exactly an https picture address. Anything else is refused at the door, so a picture without a right to show it cannot exist
 * in the record.
 */
export const LICENCES = ["CC0", "Public domain", "CC BY", "CC BY-SA", "By permission"] as const;
export type Licence = (typeof LICENCES)[number];
export const LICENCE_URL: Partial<Record<Licence, string>> = { CC0: "https://creativecommons.org/publicdomain/zero/1.0/", "CC BY": "https://creativecommons.org/licenses/by/4.0/", "CC BY-SA": "https://creativecommons.org/licenses/by-sa/4.0/" };

export interface PhotoInput { slug: unknown; imageUrl: unknown; licence: unknown; credit: unknown; sourceUrl: unknown; evidence?: unknown; licenceUrl?: unknown }
export interface PhotoClean { slug: string; imageUrl: string; licence: Licence; licenceUrl: string | null; credit: string; sourceUrl: string; evidence: string | null }
export type PhotoError = "bad_slug" | "bad_image" | "bad_licence" | "no_credit" | "bad_source" | "no_evidence";

const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f-\u009f​‪-‮⁦-⁩]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");
/** An https address with a host, no credentials and no odd port; the fragment is dropped. */
export function httpsUrl(v: unknown): string | null {
  try { const u = new URL(typeof v === "string" ? v.trim() : ""); if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443") || u.href.length > 600 || !u.hostname.includes(".")) return null; u.hash = ""; return u.href; } catch { return null; }
}

export function cleanPhoto(i: PhotoInput): { ok: true; photo: PhotoClean } | { ok: false; error: PhotoError } {
  const slug = text(i.slug, 120).toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,120}$/.test(slug)) return { ok: false, error: "bad_slug" };
  const imageUrl = httpsUrl(i.imageUrl);
  if (!imageUrl || !/\.(jpe?g|png|webp)(\?|$)/i.test(new URL(imageUrl).pathname + new URL(imageUrl).search)) return { ok: false, error: "bad_image" };
  const licence = LICENCES.find((l) => l === i.licence);
  if (!licence) return { ok: false, error: "bad_licence" };
  const credit = text(i.credit, 160);
  if (credit.length < 3) return { ok: false, error: "no_credit" };
  const sourceUrl = httpsUrl(i.sourceUrl);
  if (!sourceUrl) return { ok: false, error: "bad_source" };
  const evidence = text(i.evidence, 300) || null;
  if (licence === "By permission" && (!evidence || evidence.length < 10)) return { ok: false, error: "no_evidence" };
  const licenceUrl = licence === "By permission" ? null : httpsUrl(i.licenceUrl) ?? LICENCE_URL[licence] ?? null;
  return { ok: true, photo: { slug, imageUrl, licence, licenceUrl, credit, sourceUrl, evidence } };
}
