import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_LOCALE, LOCALES } from "@/lib/i18n/config";

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

  if (first === DEFAULT_LOCALE) {
    const url = req.nextUrl.clone();
    url.pathname = pathname.slice(DEFAULT_LOCALE.length + 1) || "/";
    return NextResponse.redirect(url, 308);
  }
  if ((LOCALES as readonly string[]).includes(first)) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = `/${DEFAULT_LOCALE}${pathname === "/" ? "" : pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  // pages only: not API routes, sitemaps, robots, Next internals or anything with a file extension
  matcher: ["/((?!api|_next|sitemap|sitemaps|robots\\.txt|favicon\\.ico|.*\\..*).*)"],
};
