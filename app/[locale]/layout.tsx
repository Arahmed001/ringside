import type { Metadata } from "next";
import { Geist, Barlow_Condensed, Instrument_Serif, IBM_Plex_Sans_Arabic, Tajawal, Amiri } from "next/font/google";
import { notFound } from "next/navigation";
import Link from "@/components/L";
import { I18nProvider } from "@/components/i18n";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { CommandPalette } from "@/components/CommandPalette";
import { dirOf, isLocale, localePath } from "@/lib/i18n/config";
import { clientDict, tFor } from "@/lib/i18n/dicts";
import { abs, indexable, jsonLd, siteUrl } from "@/lib/seo";
import { NavLink } from "@/components/NavLink";
import "../globals.css";

const body = Geist({ variable: "--font-body", subsets: ["latin"] });
const display = Barlow_Condensed({ variable: "--font-display", subsets: ["latin"], weight: ["500", "600", "700", "800"] });
const serif = Instrument_Serif({ variable: "--font-serif", subsets: ["latin"], weight: "400", style: ["normal", "italic"] });
// Arabic stack, same CSS variable names so nothing else has to know: IBM Plex Sans Arabic for text, Tajawal (compact,
// heavy) for the poster voice, Amiri for nicknames (Arabic has no italics, so the serif accent becomes a calligraphic face).
const bodyAr = IBM_Plex_Sans_Arabic({ variable: "--font-body", subsets: ["arabic", "latin"], weight: ["400", "500", "600", "700"] });
const displayAr = Tajawal({ variable: "--font-display", subsets: ["arabic", "latin"], weight: ["500", "700", "800"] });
const serifAr = Amiri({ variable: "--font-serif", subsets: ["arabic", "latin"], weight: ["400", "700"] });

// Data changes after every ingest and pages depend on today's date, so never bake pages at build time.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: LayoutProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = tFor(locale);
  const description = t("Every fighter, every fight, every number. Ratings, rankings, predictions and AI scouting for professional boxing.");
  // Canonical and hreflang are per page (pageMetadata); only what every page shares is set here. Robots is
  // inherited, which is what keeps a demo deployment out of search results (see lib/seo.ts).
  return {
    metadataBase: new URL(siteUrl()),
    title: { default: t("Ringside — Boxing Intelligence"), template: "%s · Ringside" },
    description,
    robots: indexable() ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: { siteName: "Ringside", locale: locale === "ar" ? "ar_AR" : "en_US", type: "website" },
  };
}

export default async function RootLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = tFor(locale);
  const ar = locale === "ar";
  const NAV = [
    ["/rankings", t("Rankings")], ["/titles", t("Titles")], ["/boxers", t("Fighters")], ["/events", t("Events")], ["/compare", t("Matchups")], ["/people", t("Corners")],
    ["/weights", t("Weigh-ins")], ["/money", t("Money")], ["/analytics", t("Analytics")], ["/map", t("Style Map")], ["/data", t("Data")],
  ] as const;
  const site = {
    "@type": "WebSite", name: "Ringside", url: abs(localePath(locale, "/")), inLanguage: locale,
    potentialAction: { "@type": "SearchAction", target: `${abs(localePath(locale, "/boxers"))}?q={search_term_string}`, "query-input": "required name=search_term_string" },
  };
  return (
    <html lang={locale} dir={dirOf(locale)} className={ar ? `${bodyAr.variable} ${displayAr.variable} ${serifAr.variable}` : `${body.variable} ${display.variable} ${serif.variable}`}>
      <body className="min-h-screen">
        <I18nProvider locale={locale} dict={clientDict(locale)}>
          <a href="#main" className="skip-link">{t("Skip to content")}</a>
          <header className="sticky top-0 z-40 border-b border-line/70 bg-bg/75 backdrop-blur-xl">
            <div className="mx-auto flex max-w-7xl items-center gap-4 px-5 py-3 xl:gap-6">
              <Link href="/" className="flex items-center gap-2" dir="ltr">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-red font-display text-lg font-extrabold">R</span>
                <span className="font-display text-2xl font-extrabold uppercase tracking-wide">Ring<span className="text-red-ink">side</span></span>
              </Link>
              <nav className="hidden gap-1 xl:flex" aria-label={t("Main")}>
                {NAV.map(([href, label]) => (
                  <NavLink key={href} href={href} className="whitespace-nowrap rounded-lg px-3 py-1.5 text-sm text-muted transition hover:bg-panel2 hover:text-ink">{label}</NavLink>
                ))}
              </nav>
              <div className="ms-auto flex items-center gap-3">
                <form action={localePath(locale, "/boxers")} className="hidden w-72 2xl:block" role="search">
                  <input name="q" aria-label={t("Search fighters")} placeholder={t("Ask anything… “southpaw welterweights with 10+ KOs”")} className="w-full rounded-xl border border-line bg-panel px-4 py-2 text-sm outline-none transition placeholder:text-muted focus:border-gold/60" />
                </form>
                <CommandPalette />
                <LanguageSwitch />
              </div>
            </div>
            <nav className="flex gap-1 overflow-x-auto px-4 pb-2 xl:hidden" aria-label={t("Main")}>
              {NAV.map(([href, label]) => <NavLink key={href} href={href} className="chip whitespace-nowrap">{label}</NavLink>)}
            </nav>
          </header>
          <main id="main" tabIndex={-1} className="mx-auto max-w-7xl px-5 py-8 outline-none">{children}</main>
          <footer className="mx-auto max-w-7xl px-5 pb-12 pt-6 text-xs text-muted">
            {t.rich("Ringside demo build · All fighters, fights and events shown are <b>fictional, simulated data</b>. Ratings are Elo-style and unofficial.", { b: (c) => <b className="text-ink/80">{c}</b> })}
          </footer>
        </I18nProvider>
        {indexable() && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(site) }} />}
      </body>
    </html>
  );
}
