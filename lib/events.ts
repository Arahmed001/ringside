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

const hasLiveBout = (w: World, eventId: number) => eventBouts(w, eventId).some(isLive);

/**
 * Future events that still have at least one bout on the card (cancelled events and empty cards are left out), soonest first.
 * `w.events` is date-ordered, so this walks back from the end and stops at today instead of scanning every event ever held.
 */
export function upcomingEvents(w: World): EventRow[] {
  const out: EventRow[] = [];
  for (let i = w.events.length - 1; i >= 0 && w.events[i].date > w.today; i--) {
    const e = w.events[i];
    if (e.upcoming && hasLiveBout(w, e.id)) out.push(e);
  }
  return out.reverse();
}

/** The `n` most recent completed events with something to show, newest first (walks back from the end, stops after `n`). */
export function recentEvents(w: World, n: number): EventRow[] {
  const out: EventRow[] = [];
  for (let i = w.events.length - 1; i >= 0 && out.length < n; i--) {
    const e = w.events[i];
    if (!e.upcoming && e.status !== "cancelled" && hasLiveBout(w, e.id)) out.push(e);
  }
  return out;
}
