import type { Method, Sex, Stance, Status } from "../types";

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
  birthYear: number | null; // null when the feed does not say: never a guess
  stance: Stance | null;
  sex?: Sex; // defaults to male when a feed does not say
  heightCm: number | null;
  reachCm: number | null;
  weightClass: string;
  turnedPro: number | null;
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
  /** The career record (wins, losses, draws) as the feed states it, when it states all three. Kept beside the record the loaded fights add up to, so a page can say which one it shows. */
  careerRecord?: { wins: number; losses: number; draws: number };
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
  status?: Status; // defaults to scheduled/completed from the date; use cancelled/postponed to say otherwise
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
  status?: Status; // 'cancelled' for bouts that fell off the card
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

/**
 * How a money figure is known, strongest first.
 *   disclosed  an official record: a commission purse disclosure, a company filing, a promoter's own announcement
 *   reported   published by a named outlet that cites people or documents ("ESPN reported Canelo will earn $...")
 *   estimated  an outlet's or analyst's estimate, or a figure derived from other figures
 * Every money row must say which, and name where it came from; the site shows the basis next to the number.
 */
export type MoneyBasis = "disclosed" | "reported" | "estimated";

/** Provenance carried by every financial row. */
export interface Sourced {
  basis: MoneyBasis;
  /** Who published it: "Nevada Athletic Commission", "ESPN", "TKO Group 10-K". */
  source: string;
  /** The page or document, so a reader can check it. Strongly encouraged; its absence is flagged. */
  sourceUrl?: string;
  /** When the figure was read from the source (ISO date). */
  retrievedAt?: string;
  /** A short caveat or the wording that mattered ("gate only, excludes site fee"). */
  note?: string;
}

/** What an event took in. All amounts are US dollars; keep the original currency in `note` when it was not. */
export interface ProviderEventFinancials extends Sourced {
  eventExternalId: string;
  gateUsd?: number; // live gate: ticket revenue
  ticketsSold?: number;
  capacity?: number;
  siteFeeUsd?: number; // paid by a venue or government to host the card
  ppvBuys?: number;
  ppvPriceUsd?: number; // US retail price of the standard definition/HD purchase
  ppvRevenueUsd?: number; // gross retail PPV revenue; derived from buys x price when only those are known
  sponsorshipUsd?: number;
}

/** One fighter's pay for one bout. `totalUsd` is the headline number; guaranteed + bonus when both are known. */
export interface ProviderPurse extends Sourced {
  boutExternalId: string;
  boxerExternalId: string;
  guaranteedUsd?: number;
  bonusUsd?: number; // PPV share, incentives, performance bonuses
  totalUsd?: number;
}

export type BroadcastPlatform = "ppv" | "streaming" | "subscription" | "free-tv";

/** Who showed an event, where, and how many watched. One row per broadcaster and region. */
export interface ProviderBroadcast extends Sourced {
  eventExternalId: string;
  broadcaster: string;
  platform: BroadcastPlatform;
  region?: string; // "United States", "UK & Ireland", "Worldwide"
  viewersAvg?: number;
  viewersPeak?: number;
}

/** A fighter's earnings for a calendar year from a published list or filing (ring pay and everything else). */
export interface ProviderEarning extends Sourced {
  boxerExternalId: string;
  year: number;
  totalUsd: number;
  ringUsd?: number;
  offRingUsd?: number; // endorsements, business, appearances
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
  fetchFinancials?(): Promise<ProviderEventFinancials[]>;
  fetchPurses?(): Promise<ProviderPurse[]>;
  fetchBroadcasts?(): Promise<ProviderBroadcast[]>;
  fetchEarnings?(): Promise<ProviderEarning[]>;
}
