import { Geist, Barlow_Condensed, IBM_Plex_Sans_Arabic, Tajawal } from "next/font/google";
import { notFound } from "next/navigation";
import { dirOf, isLocale } from "@/lib/i18n/config";
import "../../globals.css";

// The same faces as the site, so a widget looks like Ringside, with no site chrome and no script of ours: a page meant to sit in someone else's frame (lib/public-api.ts has the switch).
const body = Geist({ variable: "--font-body", subsets: ["latin"] });
const display = Barlow_Condensed({ variable: "--font-display", subsets: ["latin"], weight: ["500", "600", "700", "800"] });
const bodyAr = IBM_Plex_Sans_Arabic({ variable: "--font-body", subsets: ["arabic", "latin"], weight: ["400", "500", "600", "700"] });
const displayAr = Tajawal({ variable: "--font-display", subsets: ["arabic", "latin"], weight: ["500", "700", "800"] });

export const dynamic = "force-dynamic";

export default async function EmbedLayout({ children, params }: LayoutProps<"/embed/[locale]">) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    <html lang={locale} dir={dirOf(locale)} className={locale === "ar" ? `${bodyAr.variable} ${displayAr.variable}` : `${body.variable} ${display.variable}`}>
      <body className="min-h-0 bg-transparent">{children}</body>
    </html>
  );
}
