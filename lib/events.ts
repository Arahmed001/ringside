import type { World } from "./world";
import type { BoutRow, EventRow, BoxerFull } from "./types";

/** Bouts on a card, main event first. Includes cancelled bouts; use `liveBouts` for what is actually happening. */
export function eventBouts(w: World, eventId: number): BoutRow[] {
  return w.boutsByEvent.get(eventId) ?? [];
}
export const isLive = (b: BoutRow) => b.status !== "cancelled";
export const liveBouts = (w: World, eventId: number) => eventBouts(w, eventId).filter(isLive);

/** The event with its headline bout (first non-cancelled bout by billing) and that bout's fighters. Null for a card with nothing to show. */
export function eventWithMain(w: World, e: EventRow) {
  const bouts = eventBouts(w, e.id);
  const main = bouts.find(isLive) ?? bouts[0];
  if (!main) return null;
  return { event: e, bouts, main, red: w.byId.get(main.redId) as BoxerFull, blue: w.byId.get(main.blueId) as BoxerFull };
}
export type EventView = NonNullable<ReturnType<typeof eventWithMain>>;
export const eventViews = (w: World, events: EventRow[]): EventView[] => events.map((e) => eventWithMain(w, e)).filter((x): x is EventView => x !== null);

/** Future events that still have at least one bout on the card (cancelled events and empty cards are left out). */
export const upcomingEvents = (w: World) =>
  w.events.filter((e) => e.upcoming && liveBouts(w, e.id).length > 0).sort((a, b) => a.date.localeCompare(b.date));
export const recentEvents = (w: World, n: number) =>
  w.events.filter((e) => !e.upcoming && e.status !== "cancelled" && liveBouts(w, e.id).length > 0).slice(-n).reverse();
