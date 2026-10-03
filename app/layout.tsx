import type { Metadata } from "next";
import { Geist, Barlow_Condensed, Instrument_Serif } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const body = Geist({ variable: "--font-body", subsets: ["latin"] });
const display = Barlow_Condensed({ variable: "--font-display", subsets: ["latin"], weight: ["500", "600", "700", "800"] });
const serif = Instrument_Serif({ variable: "--font-serif", subsets: ["latin"], weight: "400", style: ["normal", "italic"] });

// Data changes after every ingest and pages depend on today's date, so never bake pages at build time.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "Ringside — Boxing Intelligence", template: "%s · Ringside" },
  description: "Every fighter, every fight, every number. Ratings, rankings, predictions and AI scouting for professional boxing.",
};

const NAV = [
  ["/rankings", "Rankings"],
  ["/boxers", "Fighters"],
  ["/events", "Events"],
  ["/compare", "Matchups"],
  ["/people", "Corners"],
  ["/weights", "Weigh-ins"],
  ["/analytics", "Analytics"],
  ["/map", "Style Map"],
  ["/data", "Data"],
] as const;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${body.variable} ${display.variable} ${serif.variable}`}>
      <body className="min-h-screen">
        <header className="sticky top-0 z-40 border-b border-line/70 bg-bg/75 backdrop-blur-xl">
          <div className="mx-auto flex max-w-7xl items-center gap-6 px-5 py-3">
            <Link href="/" className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-red font-display text-lg font-extrabold">R</span>
              <span className="font-display text-2xl font-extrabold uppercase tracking-wide">Ring<span className="text-red">side</span></span>
            </Link>
            <nav className="hidden gap-1 md:flex">
              {NAV.map(([href, label]) => (
                <Link key={href} href={href} className="whitespace-nowrap rounded-lg px-3 py-1.5 text-sm text-muted transition hover:bg-panel2 hover:text-ink">{label}</Link>
              ))}
            </nav>
            <form action="/boxers" className="ml-auto hidden w-full max-w-sm sm:block">
              <input name="q" placeholder="Ask anything… “southpaw welterweights with 10+ KOs”" className="w-full rounded-xl border border-line bg-panel px-4 py-2 text-sm outline-none transition placeholder:text-muted/70 focus:border-gold/60" />
            </form>
          </div>
          <nav className="flex gap-1 overflow-x-auto px-4 pb-2 md:hidden">
            {NAV.map(([href, label]) => <Link key={href} href={href} className="chip whitespace-nowrap">{label}</Link>)}
          </nav>
        </header>
        <main className="mx-auto max-w-7xl px-5 py-8">{children}</main>
        <footer className="mx-auto max-w-7xl px-5 pb-12 pt-6 text-xs text-muted">
          Ringside demo build · All fighters, fights and events shown are <b className="text-ink/80">fictional, simulated data</b>. Ratings are Elo-style and unofficial.
        </footer>
      </body>
    </html>
  );
}
