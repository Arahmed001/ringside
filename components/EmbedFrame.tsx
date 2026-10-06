import type { ReactNode } from "react";
import { localePath, type Locale } from "@/lib/i18n/config";
import { abs } from "@/lib/seo";
import { vendorCredit } from "@/lib/site-info";
import type { T } from "@/lib/i18n/t";

export type EmbedTheme = "dark" | "light";
/** The widget's colours: the site's own (dark), or a light set for a light page. The site is dark only, so the light set is a handful of variables on the wrapper. */
const LIGHT = { "--bg": "#ffffff", "--panel": "#f5f5f7", "--panel-2": "#ececf0", "--line": "#d4d4dc", "--text": "#15151a", "--muted": "#5a5a68", "--gold": "#8a6a1c", "--red-ink": "#c4231d", "--green": "#0f7a4a" } as Record<string, string>;
export const parseTheme = (v: string | string[] | undefined): EmbedTheme => (v === "light" ? "light" : "dark");

/** The box around a widget: the theme, the page's language and direction, and the footer that credits Ringside (a link back) and, for a licensed feed, the data supplier. */
export function EmbedFrame({ theme, locale, t, path, children }: { theme: EmbedTheme; locale: Locale; t: T; path: string; children: ReactNode }) {
  const credit = vendorCredit();
  return (
    <div className="mx-auto w-full max-w-xl p-2" style={theme === "light" ? { ...LIGHT, background: "var(--bg)", color: "var(--text)", colorScheme: "light" } as React.CSSProperties : undefined}>
      <div className="card overflow-hidden" style={theme === "light" ? { background: "var(--panel)" } : undefined}>
        <div className="p-4">{children}</div>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line px-4 py-2.5 text-xs text-muted">
          <a href={abs(localePath(locale, path))} target="_blank" rel="noopener" className="inline-block py-1 font-semibold text-ink underline decoration-dotted hover:text-gold">{t("View on Ringside")} ↗</a>
          <span>
            Ringside{credit ? <> · {t.rich("Fight, fighter and event data: <a>{name}</a>.", { name: credit.name, a: (c) => <a href={credit.url} lang="en" dir="ltr" target="_blank" rel="noopener" className="underline decoration-dotted">{c}</a> })}</> : null}
          </span>
        </div>
      </div>
    </div>
  );
}
