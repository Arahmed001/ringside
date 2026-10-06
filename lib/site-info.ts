/**
 * Two things a public site owes its readers once it shows real data, both read from settings so nothing personal is ever written into the code:
 *
 *  - `SITE_CONTACT`: where someone who is not signed in can report a mistake (an email or an https address, published as written: use a role address).
 *  - the data vendor's credit, shown only when a real feed is configured, with a link to its terms once `VENDOR_TERMS_URL` is set.
 *
 * Neither has a default. An unset or malformed value gives null, and the page leaves the line out (the doctor says which).
 */
export interface Contact { label: string; href: string }

const EMAIL = /^[^\s@<>"'()\\,;:]+@[^\s@<>"'()\\,;:]+\.[^\s@<>"'()\\,;:]{2,}$/;

/** An https web address, or null. Plain http and other schemes are refused: these links are shown to every visitor. */
export function httpsUrl(v: string | undefined): string | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  try { const u = new URL(s); return u.protocol === "https:" && !u.username && !u.password ? u.toString() : null; } catch { return null; }
}

/** `env` is for tests; the site reads the real settings. */
export function siteContact(env?: Record<string, string | undefined>): Contact | null {
  const v = ((env ? env.SITE_CONTACT : process.env.SITE_CONTACT) ?? "").trim();
  if (!v) return null;
  if (EMAIL.test(v)) return { label: v, href: `mailto:${v}` };
  const url = httpsUrl(v);
  return url ? { label: v.replace(/^https:\/\//, "").replace(/\/$/, ""), href: url } : null;
}

/**
 * The sanctioning bodies' official lists reach us through the vendor "sourced from BoxingScene", so whether they may be stored and shown is a separate question from the
 * fight and fighter data (docs/boxing-data-api-rankings-enquiry.md). On a licensed feed they are left out, neither requested nor shown, until the owner states in
 * `VENDOR_RANKINGS_CONFIRMED=1` that the vendor's answer allows it. The demo league and a file feed are not affected.
 */
export const rankingsConfirmed = (env?: Record<string, string | undefined>): boolean => ((env ? env.VENDOR_RANKINGS_CONFIRMED : process.env.VENDOR_RANKINGS_CONFIRMED) ?? "").trim() === "1";
export const officialRankingsShown = (env?: Record<string, string | undefined>): boolean => ((env ? env.BOXING_PROVIDER : process.env.BOXING_PROVIDER) ?? "demo").trim() !== "licensed" || rankingsConfirmed(env);

export interface VendorCredit { name: string; url: string; termsUrl: string | null }

/** The vendor behind the configured feed, or null for the demo league and a file feed (which have none to credit). */
export function vendorCredit(env?: Record<string, string | undefined>): VendorCredit | null {
  if (((env ? env.BOXING_PROVIDER : process.env.BOXING_PROVIDER) ?? "demo").trim() !== "licensed") return null;
  return { name: "Boxing Data API", url: "https://boxing-data.com", termsUrl: httpsUrl(env ? env.VENDOR_TERMS_URL : process.env.VENDOR_TERMS_URL) };
}
