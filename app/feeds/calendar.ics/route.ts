import { getWorld } from "@/lib/world";
import { buildCalendar } from "@/lib/calendar";
import { icsText } from "@/lib/ics";
import { getTFor } from "@/lib/i18n/dicts";
import { isLocale, localePath, type Locale } from "@/lib/i18n/config";
import { abs } from "@/lib/seo";

export const dynamic = "force-dynamic";

const text = (body: string, status: number) => new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
const whole = (s: string | null): number | undefined | "bad" => (s === null || s === "" ? undefined : /^\d{1,9}$/.test(s) ? Number(s) : "bad");

/**
 * Fight calendars for a calendar app to subscribe to or download: GET /feeds/calendar.ics
 *   (no query)         the cards of the next 60 days, one entry per card
 *   ?slugs=a,b,c       the upcoming fights of those fighters (a watchlist), one entry per fight
 *   ?event=ID, ?bout=ID  one card, one fight (the "Add to calendar" links)
 *   ?days=N            how far ahead for the first two (1 to 365)       ?lang=ar  Arabic text
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const lang = q.get("lang");
  const locale: Locale = lang && isLocale(lang) ? lang : "en";
  const event = whole(q.get("event")), bout = whole(q.get("bout")), days = whole(q.get("days"));
  if (event === "bad" || bout === "bad" || days === "bad") return text("event, bout and days must be whole numbers", 400);
  const slugs = q.has("slugs") ? (q.get("slugs") ?? "").split(",").map((s) => s.trim()).filter(Boolean) : undefined;
  const t = await getTFor(locale);
  const host = new URL(abs("/")).hostname;
  const result = buildCalendar(await getWorld(), { slugs, eventId: event, boutId: bout, days }, t, host, (p) => abs(localePath(locale, p)));
  if ("error" in result) return text(result.error === "unknown_event" ? "no such event" : "no such fight", 404);
  const single = event !== undefined || bout !== undefined;
  return new Response(icsText(result.calendar), {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `${single ? "attachment" : "inline"}; filename="ringside-${single ? (event !== undefined ? `event-${event}` : `fight-${bout}`) : "fights"}.ics"`,
      "cache-control": single ? "public, max-age=900" : "public, max-age=900, stale-while-revalidate=3600",
    },
  });
}
