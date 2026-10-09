import type { TeamRole, OrgKind } from "./providers";
export type { TeamRole, OrgKind };

export type { Method } from "./methods";
import type { Method } from "./methods";

export type Stance = "Orthodox" | "Southpaw" | "Switch";
export type Sex = "male" | "female";
export type Status = "scheduled" | "completed" | "cancelled" | "postponed";

export interface Boxer {
  id: number;
  slug: string;
  name: string;
  nickname: string | null;
  country: string;
  /** The facts below can be unknown (null): a real feed does not always have them, and none is ever invented to fill the gap. */
  birthYear: number | null;
  stance: Stance | null;
  sex: Sex;
  heightCm: number | null;
  reachCm: number | null;
  weightClass: string;
  turnedPro: number | null;
  active: boolean;
  rating: number;
  /** The career record as the data supplier states it (null when it gave none); see `careerRecord` in lib/world.ts for when a page shows it. */
  /** Marked by a load that kept the fighter although the supplier's own fight list gives more wins, losses or draws than its career total: the page shows the total and says they disagree (see `careerView`). */
  recordDisputed: boolean;
  vendorRecord: { wins: number; losses: number; draws: number; /** career knockouts and times stopped as the supplier states them, when it does */ koWins?: number; stopped?: number } | null;
  photoUrl: string | null;
  photoCredit: PhotoCredit | null;
  birthDate: string | null;
  birthPlace: string | null;
  residence: string | null;
  wikidataId: string | null;
  boxrecId: string | null;
  ibhofId: string | null; // International Boxing Hall of Fame path, e.g. "modern/leonardray"
  olympediaId: string | null;
  /** The title of the fighter's English Wikipedia article (a link, never copied text), when Wikidata says there is one. */
  wikipediaTitle: string | null;
  aliases: string[];
  debutDate: string | null;
  retiredDate: string | null;
}

export interface PhotoCredit {
  text: string; // "Author, CC BY-SA 4.0"
  license: string;
  licenseUrl: string | null;
  pageUrl: string;
  source: string;
}

export interface BoxerStats {
  wins: number;
  losses: number;
  draws: number;
  kos: number;
  koLosses: number;
  bouts: number;
  koRate: number;
  winRate: number;
  avgRounds: number;
  lastFight: string | null;
  streak: { type: "W" | "L" | "D" | "-"; count: number };
}

export interface BoxerFull extends Boxer, BoxerStats {
  age: number | null;
}

export interface BoutRow {
  /** the judges' scores as the supplier gave them ("116-109"), when it gave them: no judges, no corners */
  vendorScores?: string[] | null;
  id: number;
  eventId: number;
  eventName: string;
  date: string;
  upcoming: boolean;
  redId: number;
  blueId: number;
  redName: string;
  blueName: string;
  redSlug: string;
  blueSlug: string;
  weightClass: string;
  rounds: number;
  winnerId: number | null;
  method: Method | null;
  endRound: number | null;
  title: string | null;
  position: number;
  roundTime: string | null;
  kdRed: number;
  kdBlue: number;
  oddsRed: number | null;
  oddsBlue: number | null;
  contractLb: number | null;
  titleOrgId: number | null;
  titleVacant: boolean;
  status: Status;
}

export interface EventRow {
  id: number;
  name: string;
  date: string;
  venue: string;
  city: string;
  country: string;
  upcoming: boolean;
  posterUrl: string | null;
  promoterOrgId: number | null;
  broadcaster: string | null;
  attendance: number | null;
  status: Status;
}

export { DIVISION_NAMES as WEIGHT_CLASSES } from "./divisions";

export interface Person {
  id: number;
  slug: string;
  name: string;
  country: string | null;
  wikidataId: string | null;
}

export interface Org {
  id: number;
  slug: string;
  name: string;
  kind: OrgKind;
  country: string | null;
  city: string | null;
}

/** A dated fighter-to-person/organisation relationship. `end` null means current. */
export interface TeamStint {
  id: number;
  boxerId: number;
  role: TeamRole;
  personId: number | null;
  orgId: number | null;
  start: string | null;
  end: string | null;
  source: string;
  /** The page a community edit rests on, and the words it quotes there. */
  sourceUrl?: string | null;
  note?: string | null;
}

export interface WeighIn {
  boutId: number;
  boxerId: number;
  officialLb: number | null;
  fightNightLb: number | null;
  limitLb: number | null;
  madeWeight: boolean | null;
  source: string;
}

export interface Official { boutId: number; role: "referee" | "judge"; personId: number; seat: number | null }
export interface Scorecard { boutId: number; judgeId: number; seat: number; red: number; blue: number }
export interface Corner { boutId: number; boxerId: number; role: TeamRole; personId: number }

export interface PunchLine {
  boutId: number; boxerId: number; round: number; thrown: number; landed: number;
  powerThrown: number; powerLanded: number; jabThrown: number | null; jabLanded: number | null;
}

/** A money figure's provenance, shown beside the number everywhere. */
export interface Provenance { basis: "disclosed" | "reported" | "estimated"; source: string; sourceUrl: string | null; retrievedAt: string | null; note: string | null }
export interface EventFinancials extends Provenance {
  eventId: number; gateUsd: number | null; ticketsSold: number | null; capacity: number | null; siteFeeUsd: number | null;
  ppvBuys: number | null; ppvPriceUsd: number | null; ppvRevenueUsd: number | null; sponsorshipUsd: number | null;
}
export interface Purse extends Provenance { boutId: number; boxerId: number; guaranteedUsd: number | null; bonusUsd: number | null; totalUsd: number }
export interface Broadcast extends Provenance {
  eventId: number; broadcaster: string; platform: "ppv" | "streaming" | "subscription" | "free-tv"; region: string; viewersAvg: number | null; viewersPeak: number | null;
}
export interface Honour { boxerId: number; kind: "hall_of_fame" | "award" | "title"; label: string; year: number | null; source: string }
/** One reign on a belt, from a Wikipedia champions list (lib/importers/wikipedia-champions.ts). Dates are ISO prefixes: "1991-01-11", "1995-03" or "1990". Linked to a fighter only through a Wikidata ID. */
export interface TitleReign { boxerId: number; org: string; division: string; category: string; status: string | null; start: string | null; end: string | null; current: boolean; defences: number | null; endNote: string | null; source: string }
/** A venue verified against Wikidata (lib/importers/venues.ts). Capacity is a general figure, not the boxing configuration. */
/** Where an event's venue is, from OpenStreetMap: only what its rules accepted. */
export interface Place { lat: number; lon: number; address: string | null; category: string | null; osmRef: string }
export interface Venue { name: string; city: string; wikidataId: string; label: string; lat: number | null; lon: number | null; capacity: number | null; picture: Picture | null }
/** A picture of an organisation, a belt or a venue, free-licensed, with the credit it has to carry. */
export interface Picture { url: string; credit: PhotoCredit }
export interface Earning extends Provenance { boxerId: number; year: number; totalUsd: number; ringUsd: number | null; offRingUsd: number | null }
