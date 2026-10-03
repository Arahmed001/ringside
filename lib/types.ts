import type { TeamRole, OrgKind } from "./providers";
export type { TeamRole, OrgKind };

export type Stance = "Orthodox" | "Southpaw";
export type Method = "KO" | "TKO" | "UD" | "MD" | "SD" | "DRAW" | "NC";

export interface Boxer {
  id: number;
  slug: string;
  name: string;
  nickname: string | null;
  country: string;
  birthYear: number;
  stance: Stance;
  heightCm: number;
  reachCm: number;
  weightClass: string;
  turnedPro: number;
  active: boolean;
  rating: number;
  photoUrl: string | null;
  photoCredit: PhotoCredit | null;
  birthDate: string | null;
  birthPlace: string | null;
  residence: string | null;
  wikidataId: string | null;
  boxrecId: string | null;
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
  age: number;
}

export interface BoutRow {
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
