import type {
  DataProvider, ProviderBout, ProviderBoxer, ProviderCorner, ProviderEvent, ProviderOfficial, ProviderOrg, ProviderPerson,
  ProviderPunchLine, ProviderScorecard, ProviderStint, ProviderWeighIn,
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
}

export const emptyFeed = (): FeedData => ({
  boxers: [], events: [], bouts: [], people: [], orgs: [], stints: [], weighIns: [], officials: [], scorecards: [], corners: [], punches: [],
});

export async function loadFeed(provider: DataProvider): Promise<FeedData> {
  const [boxers, events, bouts] = await Promise.all([provider.fetchBoxers(), provider.fetchEvents(), provider.fetchBouts()]);
  const [people, orgs, stints, weighIns, officials, scorecards, corners, punches] = await Promise.all([
    provider.fetchPeople?.() ?? [], provider.fetchOrgs?.() ?? [], provider.fetchStints?.() ?? [], provider.fetchWeighIns?.() ?? [],
    provider.fetchOfficials?.() ?? [], provider.fetchScorecards?.() ?? [], provider.fetchCorners?.() ?? [], provider.fetchPunchStats?.() ?? [],
  ]);
  return { boxers, events, bouts, people, orgs, stints, weighIns, officials, scorecards, corners, punches };
}
