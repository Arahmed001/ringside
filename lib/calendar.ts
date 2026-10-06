import type { World } from "./world";
import type { BoutRow, EventRow } from "./types";
import type { IcsCalendar, IcsEvent } from "./ics";
import { divisionLabel } from "./divisions";
import { eventBouts, isLive, upcomingEvents } from "./events";
import { msg, type T } from "./i18n/t";
import { MAX_WATCH } from "./watch";

/**
 * What goes in a fight calendar (the file itself is built by `lib/ics.ts`). Three kinds, all of fights still to come:
 *  - the cards of the next `days` days (the default), one entry per card, headed by its main event;
 *  - the fights of the fighters in `slugs` (a watchlist), one entry per fight, a fight that fell off the card kept as CANCELLED so a subscribed calendar drops it;
 *  - one card (`eventId`, past or future) or one fight (`boutId`).
 * The calendar's stamp is the data's own day, so a copy fetched twice in a day is the same text and a cache can keep it.
 */
export const CALENDAR_DAYS = 60;
export const MAX_CALENDAR_DAYS = 365;
export interface CalendarRequest { slugs?: string[]; eventId?: number; boutId?: number; days?: number }
export type CalendarResult = { calendar: IcsCalendar } | { error: "unknown_event" | "unknown_bout" };

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

export function buildCalendar(w: World, req: CalendarRequest, t: T, host: string, url: (path: string) => string): CalendarResult {
  const days = Math.min(MAX_CALENDAR_DAYS, Math.max(1, Math.floor(req.days ?? CALENDAR_DAYS)));
  const stamp = `${w.today}T00:00:00Z`;
  const fight = (b: BoutRow) => t("{red} vs {blue}", { red: t.name(b.redName), blue: t.name(b.blueName) });
  const where = (e: EventRow | undefined) => [e?.venue, e?.city, e?.country].filter((x): x is string => !!x && x.trim() !== "").map((x) => t.name(x)).join(", ");
  const sexOf = (b: BoutRow) => w.byId.get(b.redId)?.sex ?? "male";

  const boutEvent = (b: BoutRow): IcsEvent => {
    const e = w.eventById.get(b.eventId);
    const bits = [t.name(b.eventName), divisionLabel(b.weightClass, sexOf(b), t), b.title ? t.name(b.title) : null, t.n(b.rounds, "{n} round", "{n} rounds")].filter(Boolean);
    return {
      uid: `bout-${b.id}@${host}`, date: b.date, summary: fight(b) + (b.title ? ` · ${t.name(b.title)}` : ""), description: `${bits.join(" · ")}\n${url(`/bouts/${b.id}`)}`,
      location: where(e), url: url(`/bouts/${b.id}`), status: b.status === "cancelled" ? "CANCELLED" : e?.status === "postponed" ? "TENTATIVE" : "CONFIRMED",
    };
  };
  const cardEvent = (e: EventRow): IcsEvent => {
    const live = eventBouts(w, e.id).filter(isLive), main = live[0];
    const shown = live.slice(0, 10).map((b) => `${fight(b)} (${divisionLabel(b.weightClass, sexOf(b), t)})`);
    if (live.length > shown.length) shown.push(t("+{n} more", { n: live.length - shown.length }));
    return {
      uid: `event-${e.id}@${host}`, date: e.date, summary: main ? t("{event}: {fight}", { event: t.name(e.name), fight: fight(main) }) : t.name(e.name),
      description: `${shown.join("\n")}${shown.length ? "\n" : ""}${url(`/events/${e.id}`)}`, location: where(e), url: url(`/events/${e.id}`),
      status: e.status === "cancelled" ? "CANCELLED" : e.status === "postponed" ? "TENTATIVE" : "CONFIRMED",
    };
  };
  const calendar = (name: string, events: IcsEvent[], description = t("Upcoming fights from Ringside")): CalendarResult => ({ calendar: { name, description, lang: t.locale, stamp, events } });

  if (req.boutId !== undefined) {
    const b = w.boutById.get(req.boutId);
    return b ? calendar(fight(b), [boutEvent(b)]) : { error: "unknown_bout" };
  }
  if (req.eventId !== undefined) {
    const e = w.eventById.get(req.eventId);
    return e ? calendar(t.name(e.name), [cardEvent(e)]) : { error: "unknown_event" };
  }
  if (req.slugs) {
    const until = addDays(w.today, days), seen = new Set<number>(), events: IcsEvent[] = [];
    for (const slug of new Set(req.slugs.slice(0, MAX_WATCH))) {
      const f = w.bySlug.get(slug);
      for (const b of f ? w.boutsByBoxer.get(f.id) ?? [] : []) {
        if (seen.has(b.id) || b.date < w.today || b.date > until || !(b.upcoming || b.status === "cancelled")) continue;
        seen.add(b.id);
        events.push(boutEvent(b));
      }
    }
    return calendar(t("Fights I follow"), events, t("The upcoming fights of the fighters I follow on Ringside"));
  }
  const until = addDays(w.today, days);
  return calendar(t("Ringside fight calendar"), upcomingEvents(w).filter((e) => e.date <= until).map(cardEvent));
}

// strings the extractor must see (the route builds some of them through variables)
void [msg("{red} vs {blue}"), msg("{event}: {fight}"), msg("Fights I follow"), msg("Ringside fight calendar"), msg("Upcoming fights from Ringside"), msg("The upcoming fights of the fighters I follow on Ringside")];
