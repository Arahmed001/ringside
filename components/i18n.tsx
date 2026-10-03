"use client";
import { createContext, useContext, useMemo } from "react";
import type { Locale } from "@/lib/i18n/config";
import { makeT, type Dict, type T } from "@/lib/i18n/t";

const Ctx = createContext<{ locale: Locale; t: T }>({ locale: "en", t: makeT("en") });

/** Gives client components the locale and the slice of the dictionary they use (see clientDict). */
export function I18nProvider({ locale, dict, children }: { locale: Locale; dict: Dict; children: React.ReactNode }) {
  const value = useMemo(() => ({ locale, t: makeT(locale, dict) }), [locale, dict]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export const useLocale = () => useContext(Ctx).locale;
export const useT = () => useContext(Ctx).t;
