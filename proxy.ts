import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_LOCALE, LOCALES } from "@/lib/i18n/config";
import { HSTS, contentSecurityPolicy, isEmbedPath, isHttps, makeNonce } from "@/lib/security";

/**
 * English at the bare path, every other language under its prefix.
 *   /boxers      -> rendered by app/[locale]/boxers with locale "en" (an internal rewrite; the URL does not change)
 *   /ar/boxers   -> rendered with locale "ar"
 *   /en/boxers   -> 308 to /boxers, so each page has exactly one English URL (duplicate URLs split ranking)
 * Search engines are never redirected by Accept-Language: each language is a stable, crawlable address.
 */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const first = pathname.split("/")[1];
  const https = isHttps(process.env.SITE_URL, req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", ""));

  if (first === DEFAULT_LOCALE) {
    const url = req.nextUrl.clone();
    url.pathname = pathname.slice(DEFAULT_LOCALE.length + 1) || "/";
    const redirect = NextResponse.redirect(url, 308);
    if (https) redirect.headers.set("Strict-Transport-Security", HSTS);
    return redirect;
  }

  // the embeds are made to be framed and are not in a language segment (their locale is in the path after /embed): same nonce policy, framing allowed, no locale rewrite
  if (isEmbedPath(pathname)) {
    const nonce = makeNonce();
    const csp = contentSecurityPolicy({ nonce, dev: process.env.NODE_ENV === "development", https, embed: true });
    const headers = new Headers(req.headers);
    headers.set("x-nonce", nonce);
    headers.set("x-pathname", pathname);
    headers.set("Content-Security-Policy", csp);
    const res = NextResponse.next({ request: { headers } });
    res.headers.set("Content-Security-Policy", csp);
    if (https) res.headers.set("Strict-Transport-Security", HSTS);
    return res;
  }

  // a fresh nonce per request; Next reads it back out of the policy and puts it on its own scripts and styles, and the layout puts it on ours
  const nonce = makeNonce();
  const csp = contentSecurityPolicy({ nonce, dev: process.env.NODE_ENV === "development", https });
  const headers = new Headers(req.headers);
  headers.set("x-nonce", nonce);
  headers.set("x-pathname", pathname); // set here, never taken from the visitor: the not-found page reads it to offer the fighter they probably meant
  headers.set("Content-Security-Policy", csp);

  let res: NextResponse;
  if ((LOCALES as readonly string[]).includes(first)) res = NextResponse.next({ request: { headers } });
  else {
    const url = req.nextUrl.clone();
    url.pathname = `/${DEFAULT_LOCALE}${pathname === "/" ? "" : pathname}`;
    res = NextResponse.rewrite(url, { request: { headers } });
  }
  res.headers.set("Content-Security-Policy", csp);
  if (https) res.headers.set("Strict-Transport-Security", HSTS);
  return res;
}

export const config = {
  // pages only: not API routes, sitemaps, robots, Next internals or anything with a file extension
  matcher: ["/((?!api|_next|sitemap|sitemaps|robots\\.txt|favicon\\.ico|.*\\..*).*)"],
};
