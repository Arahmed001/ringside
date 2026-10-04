import type {
  DataProvider, ProviderBout, ProviderBoxer, ProviderCorner, ProviderEvent, ProviderOfficial, ProviderOrg, ProviderPerson,
  ProviderPunchLine, ProviderScorecard, ProviderStint, ProviderWeighIn, ProviderEventFinancials, ProviderPurse, ProviderBroadcast, ProviderEarning, ProviderOfficialRanking,
} from "./providers";

/** Everything a provider returned, in one object: what the validator checks and the ingest writes. */
export interface FeedData {
  boxers: ProviderBoxer[];
  events: ProviderEvent[];
  bouts: ProviderBout[];
  people: ProviderPerson[];
  orgs: ProviderOrg[];
  stints: ProviderStint[];
  weighIns: ProviderWeighIn[];
  officials: ProviderOfficial[];
  scorecards: ProviderScorecard[];
  corners: ProviderCorner[];
  punches: ProviderPunchLine[];
  financials: ProviderEventFinancials[];
  purses: ProviderPurse[];
  broadcasts: ProviderBroadcast[];
  earnings: ProviderEarning[];
  /** the whole current snapshot of the sanctioning bodies' lists; empty when the provider has none (then the lists already stored are kept) */
  officialRankings: ProviderOfficialRanking[];
}

export const emptyFeed = (): FeedData => ({
  boxers: [], events: [], bouts: [], people: [], orgs: [], stints: [], weighIns: [], officials: [], scorecards: [], corners: [], punches: [],
  financials: [], purses: [], broadcasts: [], earnings: [], officialRankings: [],
});

export async function loadFeed(provider: DataProvider): Promise<FeedData> {
  const [boxers, events, bouts] = await Promise.all([provider.fetchBoxers(), provider.fetchEvents(), provider.fetchBouts()]);
  const [people, orgs, stints, weighIns, officials, scorecards, corners, punches, financials, purses, broadcasts, earnings] = await Promise.all([
    provider.fetchPeople?.() ?? [], provider.fetchOrgs?.() ?? [], provider.fetchStints?.() ?? [], provider.fetchWeighIns?.() ?? [],
    provider.fetchOfficials?.() ?? [], provider.fetchScorecards?.() ?? [], provider.fetchCorners?.() ?? [], provider.fetchPunchStats?.() ?? [],
    provider.fetchFinancials?.() ?? [], provider.fetchPurses?.() ?? [], provider.fetchBroadcasts?.() ?? [], provider.fetchEarnings?.() ?? [],
  ]);
  const officialRankings = (await provider.fetchOfficialRankings?.()) ?? [];
  return { boxers, events, bouts, people, orgs, stints, weighIns, officials, scorecards, corners, punches, financials, purses, broadcasts, earnings, officialRankings };
}
