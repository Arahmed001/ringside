"use client";
import Link from "@/components/L";
import { useT } from "@/components/i18n";
import { useAccount } from "@/lib/useAccount";

const cls = "flex h-9 min-w-9 pointer-coarse:h-11 pointer-coarse:min-w-11 items-center justify-center rounded-xl border border-line bg-panel px-2 text-sm hover:border-white/30 sm:px-3";
const Person = () => <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4 sm:hidden" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="8" r="3.5" /><path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6" /></svg>;

/** The header's sign-in link, or the signed-in name (an icon on narrow screens). Asks the server once, in the browser, so no page needs to read a cookie. */
export function AccountMenu() {
  const t = useT();
  const me = useAccount();
  if (me === undefined) return <span className="inline-block h-9 w-9 sm:w-20" aria-hidden />;
  return me ? (
    <Link href="/account" className={`${cls} sm:max-w-[9rem]`} aria-label={t("Your account: {name}", { name: me.username })}><Person /><span className="hidden truncate sm:inline">{me.username}</span></Link>
  ) : (
    <Link href="/account" className={cls} aria-label={t("Sign in")}><Person /><span className="hidden sm:inline">{t("Sign in")}</span></Link>
  );
}
