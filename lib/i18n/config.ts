export const LOCALES = ["en", "ar"] as const;
export type Locale = (typeof LOCALES)[number];
/** English lives at the bare path (`/boxers`), every other locale under its own prefix (`/ar/boxers`). */
export const DEFAULT_LOCALE: Locale = "en";

export const isLocale = (s: string | undefined | null): s is Locale => !!s && (LOCALES as readonly string[]).includes(s);
export const dirOf = (l: Locale): "ltr" | "rtl" => (l === "ar" ? "rtl" : "ltr");

/** Names each language calls itself, for the switcher. */
export const LOCALE_NAME: Record<Locale, string> = { en: "English", ar: "العربية" };

/** `/boxers/x` in a locale: the default locale has no prefix, so existing English URLs never change. */
export function localePath(locale: Locale, path: string): string {
  if (/^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(path)) return path; // absolute URL or fragment
  const p = path.startsWith("/") ? path : `/${path}`;
  if (locale === DEFAULT_LOCALE) return p;
  return p === "/" ? `/${locale}` : p.startsWith("/?") || p.startsWith("/#") ? `/${locale}${p.slice(1)}` : `/${locale}${p}`;
}

/** Splits `/ar/boxers/x` into its locale and the locale-free path `/boxers/x`. */
export function splitLocale(pathname: string): { locale: Locale; path: string } {
  const m = pathname.match(/^\/([a-z]{2})(\/.*)?$/);
  if (m && isLocale(m[1]) && m[1] !== DEFAULT_LOCALE) return { locale: m[1], path: m[2] ?? "/" };
  return { locale: DEFAULT_LOCALE, path: pathname || "/" };
}
