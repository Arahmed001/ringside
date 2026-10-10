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
  /** Set by a load that kept a fighter whose loaded fights come to more than the feed's own career total (`--keep-disputed`): true marks him, false clears the mark, undefined (a daily update) leaves it as it was. A page then shows the feed's total and says the two disagree. */
  recordDisputed?: boolean;
  careerRecord?: { wins: number; losses: number; draws: number; /** career knockouts and times stopped, when the feed gives them (never more than the wins and losses they are part of) */ koWins?: number; stopped?: number };
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
  /** The feed gave no USABLE result for this fight (a word the importer cannot read, a status it does not know, copies that disagree), as against "no result yet": an ingest keeps a result already stored instead of erasing it. */
  resultUnsettled?: boolean;
  /** the judges' scores as the feed gave them ("116-109"), in the feed's order, without judges or corners: shown as given and never assigned to a fighter */
  scores?: string[];
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

export type OrgKind = "gym" | "promotion" | "sanctioning_body" | "magazine" | "broadcaster";

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
  /** where a researched weight was read, and how sure the source is (the research pipeline fills these; a vendor feed need not) */
  sourceUrl?: string;
  basis?: MoneyBasis;
  retrievedAt?: string;
  note?: string;
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

/** The four sanctioning bodies whose official lists a feed may carry. */
export const RANKING_BODIES = ["WBA", "WBC", "IBF", "WBO"] as const;
export type RankingBody = (typeof RANKING_BODIES)[number];

/**
 * One body's official list for one division, as published (not our Elo ranking): the champions (a belt each: full, regular or interim, or a vacant one) and the
 * ranked contenders. A fighter the feed names but we do not hold has no `boxerExternalId` we can link, and keeps the name it was given.
 */
export interface ProviderOfficialRanking {
  body: RankingBody;
  division: string;
  sex: "male" | "female";
  /** when the body last changed its list (the supplier's own date, not when we fetched it) */
  updatedAt: string | null;
  champions: { boxerExternalId: string | null; name: string | null; titleType: "full" | "regular" | "interim" | null; vacant: boolean }[];
  contenders: { rank: number; boxerExternalId: string | null; name: string | null; vacant: boolean }[];
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
  /** the sanctioning bodies' official lists, a whole fresh snapshot each time (never a delta) */
  fetchOfficialRankings?(): Promise<ProviderOfficialRanking[]>;
}
