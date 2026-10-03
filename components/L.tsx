"use client";
import NextLink from "next/link";
import type { ComponentProps } from "react";
import { localePath } from "@/lib/i18n/config";
import { useLocale } from "./i18n";

/** next/link (without prefetching) that keeps the visitor in their language: `<Link href="/boxers">` goes to `/ar/boxers` on the Arabic site. */
export default function Link({ href, prefetch = false, ...rest }: ComponentProps<typeof NextLink>) {
  const locale = useLocale();
  const to = typeof href === "string" ? localePath(locale, href) : href;
  // Off by default. Every page here is rendered per request, and Next prefetches such pages only as an empty shell (there is no loading.tsx),
  // so prefetching bought nothing and cost a request per link on screen: 215 of them, to our own server, on the style map alone.
  return <NextLink href={to} prefetch={prefetch} {...rest} />;
}

/** The same for places that need a plain string (forms, router.push). */
export function useHref() {
  const locale = useLocale();
  return (path: string) => localePath(locale, path);
}
