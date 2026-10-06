import { koView, recordStr } from "./career";
import { countryName, flag, fmtDate } from "./format";
import { divisionLabel } from "./divisions";
import { rankOf } from "./rankings";
import type { T } from "./i18n/t";
import type { BoxerFull } from "./types";
import type { World } from "./world";

/** What the hover preview of a fighter shows (components/HoverPreview.tsx), already in the reader's language: nothing the fighter's own page does not say. */
export interface FighterCard {
  slug: string; name: string; nickname: string | null; flag: string; country: string; division: string;
  record: string; rating: number; rank: number | null; koPercent: number; lastFight: string | null; status: string;
}

export function fighterCard(w: World, b: BoxerFull, t: T): FighterCard {
  const rank = rankOf(w, b);
  return {
    slug: b.slug, name: t.name(b.name), nickname: b.nickname ? t.name(b.nickname) : null, flag: flag(b.country), country: countryName(b.country, t.locale),
    division: divisionLabel(b.weightClass, b.sex, t), record: recordStr(b), rating: Math.round(b.rating), rank, koPercent: Math.round(koView(b).rate * 100),
    lastFight: b.lastFight ? fmtDate(b.lastFight, { month: "short", year: "numeric" }, t.locale) : null, status: b.active ? t("Active") : t("Retired"),
  };
}
