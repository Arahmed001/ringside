"use client";
import { Suspense } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import NextLink from "next/link";
import { LOCALES, LOCALE_NAME, localePath, splitLocale, type Locale } from "@/lib/i18n/config";
import { useLocale } from "./i18n";

function Inner({ locale, query }: { locale: Locale; query: string }) {
  const pathname = usePathname();
  const { path } = splitLocale(pathname);
  const other = LOCALES.find((l) => l !== locale)!;
  return (
    <NextLink href={`${localePath(other, path)}${query}`} hrefLang={other} lang={other} prefetch={false}
      className="shrink-0 rounded-lg border border-line px-2 py-1.5 text-sm text-ink transition hover:border-gold/60 hover:text-gold sm:px-3">
      {LOCALE_NAME[other]}
    </NextLink>
  );
}

function WithQuery({ locale }: { locale: Locale }) {
  const q = useSearchParams().toString();
  return <Inner locale={locale} query={q ? `?${q}` : ""} />;
}

/** Switches to the same page in the other language, keeping any search filters. */
export function LanguageSwitch() {
  const locale = useLocale();
  return <Suspense fallback={<Inner locale={locale} query="" />}><WithQuery locale={locale} /></Suspense>;
}
