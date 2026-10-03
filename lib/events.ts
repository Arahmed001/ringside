import type { World } from "./world";
import type { BoutRow, EventRow, BoxerFull } from "./types";

export function eventBouts(w: World, eventId: number): BoutRow[] {
  return w.bouts.filter((b) => b.eventId === eventId).sort((a, b) => b.position - a.position); // main event first
}

export function eventWithMain(w: World, e: EventRow) {
  const bouts = eventBouts(w, e.id);
  const main = bouts[0];
  return { event: e, bouts, main, red: w.byId.get(main.redId) as BoxerFull, blue: w.byId.get(main.blueId) as BoxerFull };
}

export const upcomingEvents = (w: World) => w.events.filter((e) => e.upcoming).sort((a, b) => a.date.localeCompare(b.date));
export const recentEvents = (w: World, n: number) => w.events.filter((e) => !e.upcoming).slice(-n).reverse();
