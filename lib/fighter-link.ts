// Kept apart from lib/fighter-card.ts: the browser code that finds fighter links must not pull the server's world with it.
/** The slug in the address of a fighter's page (`/boxers/some-name`, or `/ar/boxers/some-name`, with or without a trailing slash, query or hash), else null. */
export function fighterSlugFromHref(href: string, origin = "http://x"): string | null {
  let url: URL;
  try { url = new URL(href, origin); } catch { return null; }
  if (url.origin !== new URL(origin).origin) return null;
  const m = /^(?:\/ar)?\/boxers\/([A-Za-z0-9._~-]+)\/?$/.exec(url.pathname);
  return m ? m[1] : null;
}
