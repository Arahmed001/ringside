import type { World } from "./world";
import { recordStr } from "./world";
import { eventBouts, isLive, upcomingEvents, recentEvents } from "./events";
import { predict } from "./predict";
import { methodLabel, daysUntil } from "./format";
import { divisionLabel } from "./divisions";
import { buildNight, nightLines } from "./night";
import { tEn, type T } from "./i18n/t";

export interface TonightFighter { id: number; slug: string; name: string; record: string; rating: number; pct: number }
export interface TonightBout {
  id: number; role: "main" | "co" | "under"; division: string; rounds: number; title: string | null;
  red: TonightFighter; blue: TonightFighter; pDraw: number;
  /** pending: not decided yet · decided: a result is in (a draw has no winner) · cancelled */
  status: "pending" | "decided" | "cancelled"; winnerId: number | null; how: string | null;
}
export interface TonightEvent { id: number; name: string; venue: string; city: string; date: string }
export type Tonight =
  | { kind: "card"; event: TonightEvent; bouts: TonightBout[] }
  | { kind: "none"; next: { event: TonightEvent; days: number } | null; review: { event: TonightEvent; lines: string[] } | null };

const evOf = (e: World["events"][number], t: T): TonightEvent => ({ id: e.id, name: t.name(e.name), venue: t.name(e.venue), city: t.name(e.city), date: e.date });

/** Today's card in fight order with win chances and results so far; with no card today, the next card and last night's review. */
export function buildTonight(w: World, t: T = tEn): Tonight {
  const e = w.events.find((x) => x.date === w.today && x.status !== "cancelled" && eventBouts(w, x.id).some(isLive));
  if (e) {
    let i = 0;
    const bouts: TonightBout[] = eventBouts(w, e.id).map((b) => {
      const r = w.byId.get(b.redId), u = w.byId.get(b.blueId);
      if (!r || !u) return null;
      const cancelled = b.status === "cancelled";
      const p = predict(r, u, t);
      const idx = cancelled ? -1 : i++;
      const side = (f: typeof r, pct: number): TonightFighter => ({ id: f.id, slug: f.slug, name: t.name(f.name), record: recordStr(f), rating: Math.round(f.rating), pct: Math.round(pct * 100) });
      return {
        id: b.id, role: idx === 0 ? "main" : idx === 1 ? "co" : "under", division: divisionLabel(b.weightClass, r.sex, t), rounds: b.rounds, title: b.title ? t.name(b.title) : null,
        red: side(r, p.pA), blue: side(u, p.pB), pDraw: Math.round(p.pDraw * 100),
        status: cancelled ? "cancelled" : b.method ? "decided" : "pending", winnerId: b.method ? b.winnerId : null, how: b.method ? methodLabel(b.method, b.endRound, t) : null,
      } satisfies TonightBout;
    }).filter((x): x is TonightBout => x !== null);
    return { kind: "card", event: evOf(e, t), bouts };
  }
  const nx = upcomingEvents(w)[0];
  const last = recentEvents(w, 1)[0];
  const night = last ? buildNight(w, last.id) : null;
  return {
    kind: "none",
    next: nx ? { event: evOf(nx, t), days: daysUntil(nx.date) } : null,
    review: last && night ? { event: evOf(last, t), lines: nightLines(night, w, t) } : null,
  };
}
