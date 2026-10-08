/**
 * Browser security headers.
 *
 * The content security policy is built per request in proxy.ts (it carries a fresh nonce), so a script that an attacker manages to put into a
 * page (through a bug in how we show user-supplied text, say) does not run: only scripts with this request's nonce do, and the ones they load
 * (`strict-dynamic`). Everything else is the standing set below, applied to every response by next.config.ts.
 *
 * What the policy deliberately allows, and why:
 *  - `img-src https:` because licensed headshots come from other hosts (Wikimedia Commons, a vendor's CDN); `data:` and `blob:` for inline art.
 *  - `style-src-attr 'unsafe-inline'`: charts, posters and bars set `style="..."` on elements, and an attribute cannot carry a nonce. Style
 *    *elements* and stylesheets still need the nonce or to come from this origin.
 *  - `'unsafe-eval'`, `ws:` and inline styles only in development (React's debugging, hot reload, Next's error overlay).
 *  - nothing from a third party is loaded as a script, a style, a font or a frame.
 */
export interface CspOptions { nonce: string; dev?: boolean; https?: boolean; /** a page made to be framed by other sites (`/embed/...`): the only kind that may be */ embed?: boolean }

export function contentSecurityPolicy({ nonce, dev = false, https = false, embed = false }: CspOptions): string {
  const d = [
    ["default-src", "'self'"],
    ["script-src", `'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`],
    // development only: Next's error overlay writes inline styles that carry no nonce, and a nonce in the list would make 'unsafe-inline' ignored
    ["style-src", dev ? "'self' 'unsafe-inline'" : `'self' 'nonce-${nonce}'`],
    ["style-src-attr", "'unsafe-inline'"],
    ["img-src", "'self' data: blob: https:"],
    ["font-src", "'self' data:"],
    ["connect-src", `'self'${dev ? " ws: wss:" : ""}`],
    ["media-src", "'self'"],
    ["object-src", "'none'"],
    ["base-uri", "'self'"],
    ["form-action", "'self'"],
    // the only frame a page here may hold: YouTube's privacy-enhanced player, which a visitor opens by pressing play (components/VideoList.tsx); the embeds for other sites hold none
    ["frame-src", embed ? "'none'" : "https://www.youtube-nocookie.com"],
    ["frame-ancestors", embed ? "*" : "'none'"],
    ["manifest-src", "'self'"],
  ].map(([k, v]) => `${k} ${v}`);
  if (https) d.push("upgrade-insecure-requests");
  return d.join("; ");
}

/** A fresh, unpredictable nonce for one response. */
export const makeNonce = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));

/** Headers every response gets. (Strict-Transport-Security is separate: it is only right over https, which is known at run time.) */
export const STATIC_HEADERS: { key: string; value: string }[] = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

/**
 * The embeds (round: embeds): `/embed/...` pages are meant to be shown in a frame on other people's sites, so they and only they may be framed. They keep every other header
 * and the same nonce policy (`frame-ancestors *` is the only difference in it); no other route changes: `STATIC_HEADERS` (with `X-Frame-Options: DENY`) is applied to every
 * path except these in next.config.ts, and the proxy builds the policy with `embed` only for these.
 */
export const EMBED_PREFIX = "/embed/";
export const isEmbedPath = (pathname: string): boolean => pathname === "/embed" || pathname.startsWith(EMBED_PREFIX);
export const EMBED_HEADERS = STATIC_HEADERS.filter((h) => h.key !== "X-Frame-Options");

/** One year, this host only. No `includeSubDomains` or `preload`: those are commitments about domains this app does not know. */
export const HSTS = "max-age=31536000";

/** Whether the site is served over https: the configured public address, or a proxy that says so. */
export const isHttps = (siteUrl: string | undefined, forwardedProto: string | null | undefined) => (siteUrl ?? "").startsWith("https://") || forwardedProto === "https";

/**
 * What is wrong with a page response, as the browser will see it: a standing header missing, no policy or a policy without this response's
 * nonce, an inline script that does not carry the nonce (it would be blocked, and the page would not hydrate or would flash), an inline event
 * handler or `javascript:` link (blocked too), a framework banner. Used by the smoke run on every kind of page, and by the tests.
 */
export function securityProblems(headers: { get(name: string): string | null }, html: string, opts: { embed?: boolean } = {}): string[] {
  const p: string[] = [];
  // an embed is made to be framed, so its policy differs in exactly that; everything else is held to the same rules
  for (const h of opts.embed ? EMBED_HEADERS : STATIC_HEADERS) if (headers.get(h.key) !== h.value) p.push(`header ${h.key} is ${headers.get(h.key) ?? "missing"}`);
  if (opts.embed && headers.get("x-frame-options")) p.push("an embed carries X-Frame-Options, so it cannot be framed");
  if (headers.get("x-powered-by")) p.push("X-Powered-By announces the framework");
  // the privacy page promises these two: no cookie for someone who has not signed in, and nothing from another website that runs or styles the page
  if (headers.get("set-cookie")) p.push("the page sets a cookie for an anonymous visitor");
  if (/<script\b[^>]*\ssrc=["'](?:https?:)?\/\//i.test(html)) p.push("a script from another website");
  if (/<link\b[^>]*rel=["']stylesheet["'][^>]*href=["'](?:https?:)?\/\//i.test(html) || /<link\b[^>]*href=["'](?:https?:)?\/\/[^"']*["'][^>]*rel=["']stylesheet["']/i.test(html)) p.push("a stylesheet from another website");
  const csp = headers.get("content-security-policy");
  const nonce = csp?.match(/'nonce-([^']+)'/)?.[1];
  if (!csp) p.push("no Content-Security-Policy");
  else {
    if (!nonce) p.push("the policy has no nonce");
    if (/script-src[^;]*'unsafe-inline'/.test(csp)) p.push("script-src allows unsafe-inline");
    if (opts.embed) { if (!/frame-ancestors \*/.test(csp)) p.push("the embed's policy does not let other sites frame it"); }
    else if (!/frame-ancestors 'none'/.test(csp)) p.push("the page can be framed");
  }
  for (const m of html.matchAll(/<script\b([^>]*)>/gi)) {
    const attrs = m[1];
    if (/\bsrc=/i.test(attrs) || /type="application\/(ld\+json|json)"/i.test(attrs)) continue; // an external file, or data the browser does not run
    if (!nonce || !attrs.includes(`nonce="${nonce}"`)) p.push("an inline script without the nonce");
  }
  if (/\son[a-z]+=["']/i.test(html.replace(/<script[\s\S]*?<\/script>/gi, ""))) p.push("an inline event handler attribute");
  if (/href=["']javascript:/i.test(html)) p.push("a javascript: link");
  return [...new Set(p)];
}
