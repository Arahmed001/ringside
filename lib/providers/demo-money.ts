import { mulberry32 } from "../prng";
import { VENUE_CAP } from "./demo-data";
import type { BroadcastPlatform, MoneyBasis, ProviderBout, ProviderBroadcast, ProviderEarning, ProviderEvent, ProviderEventFinancials, ProviderPurse } from "./index";

const SRC: Record<MoneyBasis, string> = {
  disclosed: "Demo commission ledger (simulated)",
  reported: "Demo Sports Wire (simulated)",
  estimated: "Demo analyst estimate (simulated)",
};
const round = (x: number, to: number) => Math.round(x / to) * to;

/**
 * Money for the fictional league: gates, ticket sales, pay-per-view, purses, audiences and yearly earnings.
 * It runs from its own random stream AFTER the league is built, so adding it never changed a single fighter or result.
 * Figures scale with star power (wins before the card, belts on the line), as real ones do, and each row is tagged
 * with a basis and a clearly simulated source so the pages that show provenance have all three cases to display.
 */
export function demoMoney(events: ProviderEvent[], bouts: ProviderBout[], now: Date) {
  const rnd = mulberry32(7311);
  const nowIso = now.toISOString().slice(0, 10);
  const eventBy = new Map(events.map((e) => [e.externalId, e]));
  const byEvent = new Map<string, ProviderBout[]>();
  for (const b of bouts) (byEvent.get(b.eventExternalId) ?? byEvent.set(b.eventExternalId, []).get(b.eventExternalId)!).push(b);

  // wins before each card, for "star power"
  const wins = new Map<string, number>();
  const winsBefore = new Map<string, number>(); // `${boutExt}/${boxerExt}`
  for (const b of [...bouts].sort((a, c) => (eventBy.get(a.eventExternalId)!.date).localeCompare(eventBy.get(c.eventExternalId)!.date) || a.position - c.position)) {
    winsBefore.set(`${b.externalId}/${b.redExternalId}`, wins.get(b.redExternalId) ?? 0);
    winsBefore.set(`${b.externalId}/${b.blueExternalId}`, wins.get(b.blueExternalId) ?? 0);
    if (b.winnerExternalId && b.status !== "cancelled") wins.set(b.winnerExternalId, (wins.get(b.winnerExternalId) ?? 0) + 1);
  }

  const financials: ProviderEventFinancials[] = [], purses: ProviderPurse[] = [], broadcasts: ProviderBroadcast[] = [];
  const pickBasis = (): MoneyBasis => { const r = rnd(); return r < 0.35 ? "disclosed" : r < 0.8 ? "reported" : "estimated"; };

  for (const e of [...events].sort((a, b) => a.date.localeCompare(b.date))) {
    const card = (byEvent.get(e.externalId) ?? []).filter((b) => b.status !== "cancelled").sort((a, b) => b.position - a.position);
    if (!card.length || e.status === "cancelled") continue;
    const main = card[0];
    const star = (id: string) => Math.min(1, (winsBefore.get(`${main.externalId}/${id}`) ?? 0) / 28);
    const s = Math.min(1, (star(main.redExternalId) + star(main.blueExternalId)) / 2 + (main.title ? 0.3 : 0) + (main.rounds >= 12 ? 0.08 : 0) + rnd() * 0.08);
    const ppv = /PPV/.test(e.broadcaster ?? "");
    const platform: BroadcastPlatform = ppv ? "ppv" : /streaming/i.test(e.broadcaster ?? "") ? "streaming" : /Free/i.test(e.broadcaster ?? "") ? "free-tv" : "subscription";

    // broadcasts exist for upcoming cards too (the deal is signed); audiences and money only once the card has happened
    const done = e.date <= nowIso;
    if (e.broadcaster) {
      const basis = pickBasis();
      const avg = platform === "ppv" ? undefined : done ? round(60_000 + 3_600_000 * Math.pow(s, 1.9) * (0.55 + rnd() * 0.7), 1000) : undefined;
      broadcasts.push({ eventExternalId: e.externalId, broadcaster: e.broadcaster, platform, region: e.country, viewersAvg: avg, viewersPeak: avg ? round(avg * (1.15 + rnd() * 0.4), 1000) : undefined, basis, source: SRC[basis] });
      if (s > 0.72 && done && platform !== "ppv") {
        const b2 = pickBasis();
        const w = round(2_000_000 + 24_000_000 * Math.pow(s, 2) * (0.5 + rnd()), 10_000);
        broadcasts.push({ eventExternalId: e.externalId, broadcaster: "RingPass (streaming)", platform: "streaming", region: "Worldwide", viewersAvg: w, viewersPeak: round(w * 1.3, 10_000), basis: b2, source: SRC[b2] });
      }
    }
    if (!done) continue;

    const capacity = VENUE_CAP[e.venue] ?? 9000;
    const tickets = Math.min(capacity, Math.round((e.attendance ?? capacity * 0.7) * (0.9 + rnd() * 0.1)));
    const ticketPrice = 35 + 850 * Math.pow(s, 2.1) * (0.6 + rnd() * 0.8);
    const gate = round(tickets * ticketPrice, 1000);
    const siteFee = s > 0.5 && rnd() < 0.3 ? round(gate * (0.25 + rnd() * 0.9), 50_000) : undefined;
    let ppvBuys: number | undefined, ppvPrice: number | undefined, ppvRev: number | undefined;
    if (ppv) {
      ppvBuys = round(25_000 + 1_900_000 * Math.pow(s, 2.3) * (0.5 + rnd() * 0.8), 5000);
      ppvPrice = [59.99, 69.99, 74.99][Math.floor(rnd() * 3)];
      ppvRev = round(ppvBuys * ppvPrice, 10_000);
    }
    const fb = pickBasis();
    financials.push({ eventExternalId: e.externalId, gateUsd: gate, ticketsSold: tickets, capacity, siteFeeUsd: siteFee, ppvBuys, ppvPriceUsd: ppvPrice, ppvRevenueUsd: ppvRev, basis: fb, source: SRC[fb] });

    // purses: the main event takes most of the pool, the rest shrinks down the card
    const pool = 0.5 * (gate + (ppvRev ?? 0) * 0.45 + (siteFee ?? 0));
    const share = [0.62, 0.14, 0.07, 0.04, 0.025, 0.015];
    card.slice(0, 6).forEach((b, i) => {
      const bout = pool * share[i];
      const a = (winsBefore.get(`${b.externalId}/${b.redExternalId}`) ?? 0) + 4, c = (winsBefore.get(`${b.externalId}/${b.blueExternalId}`) ?? 0) + 4;
      const split = [a / (a + c), c / (a + c)].map((x) => 0.3 + 0.4 * x); // never a 70-30 purse split worse than the fighters' resumes justify
      [b.redExternalId, b.blueExternalId].forEach((id, k) => {
        const total = Math.max(2500, round(bout * split[k] * (0.85 + rnd() * 0.3), bout > 400_000 ? 25_000 : 1000));
        const bonus = ppv && i === 0 ? round(total * (0.15 + rnd() * 0.3), 5000) : 0;
        const basis = pickBasis();
        purses.push({ boutExternalId: b.externalId, boxerExternalId: id, guaranteedUsd: total - bonus, bonusUsd: bonus || undefined, totalUsd: total, basis, source: SRC[basis] });
      });
    });
  }

  // yearly earnings: purses summed by calendar year, plus off-ring income for the biggest names
  const ring = new Map<string, number>();
  const boutBy = new Map(bouts.map((x) => [x.externalId, x]));
  for (const p of purses) {
    const b = boutBy.get(p.boutExternalId);
    if (!b) continue;
    const key = `${p.boxerExternalId}|${eventBy.get(b.eventExternalId)!.date.slice(0, 4)}`;
    ring.set(key, (ring.get(key) ?? 0) + (p.totalUsd ?? 0));
  }
  const earnings: ProviderEarning[] = [];
  for (const [key, r] of [...ring].sort()) {
    if (r < 250_000) continue;
    const [boxer, year] = key.split("|");
    const off = round(r * (r > 5_000_000 ? 0.25 + rnd() * 0.3 : 0.04 + rnd() * 0.12), 50_000);
    earnings.push({ boxerExternalId: boxer, year: Number(year), totalUsd: round(r, 10_000) + off, ringUsd: round(r, 10_000), offRingUsd: off, basis: "estimated", source: "Demo earnings list (simulated)" });
  }
  return { financials, purses, broadcasts, earnings };
}
