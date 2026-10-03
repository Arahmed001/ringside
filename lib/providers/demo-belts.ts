import { mulberry32 } from "../prng";
import type { ProviderBout, ProviderBoxer, ProviderEvent } from "./index";

/** The demo's belts: three world bodies in every division, plus a continental title, men and women separately. */
const WORLD = ["body-gbc", "body-ira", "body-wpa"] as const;
const BELTS: { title: string; org: string }[] = [
  ...WORLD.map((org) => ({ title: "World Title", org })),
  { title: "Continental Title", org: "body-pcbu" },
];
const MONTH = 30.4 * 86400000;

/**
 * Gives the demo league champions that behave like champions. The generator sprinkled title labels on random main events,
 * which made every lineage a string of belts changing hands between strangers. This pass (its own random stream, run last)
 * clears those labels and walks the calendar: a champion's fights in their own division are for the belt (so they defend it
 * and can lose it), a belt left vacant (never held, or its champion inactive for 18 months) is fought over by two proven
 * fighters on a main or co-main event, and a champion who loses hands the belt to the winner. Results are untouched.
 */
export function applyDemoBelts(events: ProviderEvent[], bouts: ProviderBout[], boxers: ProviderBoxer[], now: Date) {
  const rnd = mulberry32(4421);
  const sex = new Map(boxers.map((b) => [b.externalId, b.sex ?? "male"]));
  const nowIso = now.toISOString().slice(0, 10);
  for (const b of bouts) { b.title = null; delete b.titleOrgExternalId; delete b.titleVacant; }

  const wins = new Map<string, number>();
  const champ = new Map<string, { id: string; last: number } | null>(); // key: belt|division|sex
  const byEvent = new Map<string, ProviderBout[]>();
  for (const b of bouts) (byEvent.get(b.eventExternalId) ?? byEvent.set(b.eventExternalId, []).get(b.eventExternalId)!).push(b);
  for (const e of [...events].sort((a, b) => a.date.localeCompare(b.date))) {
    const t = Date.parse(e.date + "T12:00:00Z");
    const card = (byEvent.get(e.externalId) ?? []).filter((b) => b.status !== "cancelled").sort((a, b) => b.position - a.position);
    const taken = new Set<string>(); // one fight per belt per card
    card.forEach((b, rank) => {
      const s = sex.get(b.redExternalId) ?? "male";
      for (const belt of BELTS) {
        const key = `${belt.org}|${belt.title}|${b.weightClass}|${s}`;
        if (taken.has(key)) continue;
        let c = champ.get(key) ?? null;
        if (c && t - c.last > 18 * MONTH) { champ.set(key, null); c = null; } // dormant: vacated
        const involves = !!c && (b.redExternalId === c.id || b.blueExternalId === c.id);
        const vacantFight = !c && rank < 2 && (wins.get(b.redExternalId) ?? 0) >= 10 && (wins.get(b.blueExternalId) ?? 0) >= 10 && rnd() < 0.5;
        if (!involves && !vacantFight) continue;
        b.title = belt.title; b.titleOrgExternalId = belt.org; b.titleVacant = !c;
        taken.add(key);
        break; // a bout carries one belt (no unifications in the demo)
      }
    });
    // champions update after the card: results are final for past events, upcoming bouts only carry the label
    for (const b of card) {
      if (!b.title || e.date > nowIso || !b.method || b.method === "NC") continue;
      const key = `${b.titleOrgExternalId}|${b.title}|${b.weightClass}|${sex.get(b.redExternalId) ?? "male"}`;
      const c = champ.get(key) ?? null;
      if (b.winnerExternalId) {
        if (!c || b.titleVacant || b.winnerExternalId !== c.id) champ.set(key, { id: b.winnerExternalId, last: t });
        else c.last = t;
      } else if (c && (b.redExternalId === c.id || b.blueExternalId === c.id)) c.last = t; // a draw keeps the belt
    }
    for (const b of card) if (b.winnerExternalId && b.method && b.method !== "NC" && e.date <= nowIso) wins.set(b.winnerExternalId, (wins.get(b.winnerExternalId) ?? 0) + 1);
  }
}
