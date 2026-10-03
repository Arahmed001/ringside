"use client";
import type { ComponentProps } from "react";
import { usePathname } from "next/navigation";
import Link from "@/components/L";
import { splitLocale } from "@/lib/i18n/config";

/** A header link that says which page you are on, to screen readers (aria-current) and to everyone else (gold text). */
export function NavLink({ href, className = "", ...rest }: ComponentProps<typeof Link> & { href: string }) {
  const { path } = splitLocale(usePathname());
  const here = path === href || path.startsWith(`${href}/`);
  return <Link href={href} aria-current={here ? "page" : undefined} className={`${className} ${here ? "!text-gold" : ""}`} {...rest} />;
}
