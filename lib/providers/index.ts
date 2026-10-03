import type { Method, Stance } from "../types";

/**
 * The ingestion contract. Any licensed boxing-data API, CSV dump or importer gets an adapter that
 * returns these shapes; `lib/ingest.ts` upserts them and then recomputes ratings.
 * Swap providers with BOXING_PROVIDER in .env.
 *
 * Required: boxers, events, bouts. Everything else is optional: a vendor that has no weigh-in or
 * trainer data simply omits those fetchers and the app hides the matching sections.
 * Every optional row may carry a `source` string ("vendor:x", "wikidata", "nsac-pdf", "editor") so
 * facts from different feeds stay distinguishable.
 */
export interface ProviderBoxer {
  externalId: string;
  name: string;
  nickname?: string;
  country: string;
  birthYear: number;
  stance: Stance;
  heightCm: number;
  reachCm: number;
  weightClass: string;
  turnedPro: number;
  active: boolean;
  photoUrl?: string; // licensed headshot URL; generated portrait used when absent
  birthDate?: string; // ISO yyyy-mm-dd (only when day-precision is known)
  birthPlace?: string;
  residence?: string;
  wikidataId?: string; // e.g. "Q335798"
  boxrecId?: string; // cross-reference ID only; no BoxRec content is ever fetched
  aliases?: string[];
  debutDate?: string;
  retiredDate?: string;
}

export interface ProviderEvent {
  externalId: string;
  name: string;
  date: string; // ISO yyyy-mm-dd
  venue: string;
  city: string;
  country: string;
  posterUrl?: string; // licensed promo art; generated poster used when absent
  promoterExternalId?: string;
  broadcaster?: string;
  attendance?: number;
}

export interface ProviderBout {
  externalId: string;
  eventExternalId: string;
  redExternalId: string;
  blueExternalId: string;
  weightClass: string;
  rounds: number;
  winnerExternalId: string | null;
  method: Method | null;
  endRound: number | null;
  title: string | null;
  position: number;
  roundTime?: string; // "2:41"
  kdRed?: number; // knockdowns suffered by the red corner
  kdBlue?: number;
  oddsRed?: number; // closing decimal odds
  oddsBlue?: number;
  contractLb?: number; // contracted weight if it differs from the division limit
  titleOrgExternalId?: string; // sanctioning body of the belt on the line
  titleVacant?: boolean;
}

export type PersonKindHint = "trainer" | "manager" | "judge" | "referee" | "other";

export interface ProviderPerson {
  externalId: string;
  name: string;
  country?: string;
  wikidataId?: string;
}

export type OrgKind = "gym" | "promotion" | "sanctioning_body" | "broadcaster";

export interface ProviderOrg {
  externalId: string;
  name: string;
  kind: OrgKind;
  country?: string;
  city?: string;
}

export type TeamRole = "head_trainer" | "assistant_trainer" | "strength_coach" | "cutman" | "manager" | "promoter" | "gym";

/** A dated relationship between a fighter and a person or organisation. `end` null means current. */
export interface ProviderStint {
  boxerExternalId: string;
  role: TeamRole;
  personExternalId?: string; // trainers, managers
  orgExternalId?: string; // gyms, promotions
  start?: string | null; // ISO date, null when unknown
  end?: string | null;
  source?: string;
}

export interface ProviderWeighIn {
  boutExternalId: string;
  boxerExternalId: string;
  officialLb?: number; // official weigh-in, usually the day before
  fightNightLb?: number; // pre-fight (rehydrated) weight where a commission records it
  limitLb?: number | null; // contract limit for this bout; null/undefined = no limit (heavyweight)
  madeWeight?: boolean;
  source?: string;
}

export interface ProviderOfficial {
  boutExternalId: string;
  role: "referee" | "judge";
  personExternalId: string;
  seat?: number; // judge seat 1-3
}

export interface ProviderScorecard {
  boutExternalId: string;
  judgeExternalId: string;
  seat: number;
  red: number;
  blue: number;
}

/** Who was in the corner for a specific bout (can differ from the fighter's usual team). */
export interface ProviderCorner {
  boutExternalId: string;
  boxerExternalId: string;
  role: TeamRole;
  personExternalId: string;
}

/** CompuBox-style statistics. round 0 means the whole-fight total. */
export interface ProviderPunchLine {
  boutExternalId: string;
  boxerExternalId: string;
  round: number;
  thrown: number;
  landed: number;
  powerThrown: number;
  powerLanded: number;
  jabThrown?: number;
  jabLanded?: number;
}

export interface DataProvider {
  name: string;
  fetchBoxers(since?: string): Promise<ProviderBoxer[]>;
  fetchEvents(since?: string): Promise<ProviderEvent[]>;
  fetchBouts(since?: string): Promise<ProviderBout[]>;
  fetchPeople?(): Promise<ProviderPerson[]>;
  fetchOrgs?(): Promise<ProviderOrg[]>;
  fetchStints?(): Promise<ProviderStint[]>;
  fetchWeighIns?(): Promise<ProviderWeighIn[]>;
  fetchOfficials?(): Promise<ProviderOfficial[]>;
  fetchScorecards?(): Promise<ProviderScorecard[]>;
  fetchCorners?(): Promise<ProviderCorner[]>;
  fetchPunchStats?(): Promise<ProviderPunchLine[]>;
}
