"use client";
import NextLink from "next/link";
import type { ComponentProps } from "react";
import { localePath } from "@/lib/i18n/config";
import { useLocale } from "./i18n";

/** next/link that keeps the visitor in their language: `<Link href="/boxers">` goes to `/ar/boxers` on the Arabic site. */
export default function Link({ href, ...rest }: ComponentProps<typeof NextLink>) {
  const locale = useLocale();
  const to = typeof href === "string" ? localePath(locale, href) : href;
  return <NextLink href={to} {...rest} />;
}

/** The same for places that need a plain string (forms, router.push). */
export function useHref() {
  const locale = useLocale();
  return (path: string) => localePath(locale, path);
}
