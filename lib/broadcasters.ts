/**
 * Who showed a card. The feed's broadcaster field is free text (81 spellings in the real data: "ShowTime" and "Showtime PPV", "ESPN 2" and "ESPN+ PPV",
 * "BT Sport 1" and "TNT Sports 1", "TrillerTV PPV US"): the same channel is one broadcaster, and a field that only names how the card was sold
 * ("Pay Per View", "Internet Stream", "string", "N/A") names nobody. `canonicalBroadcaster` gives the one name a channel goes by, or null.
 */
const NOBODY = /^(?:n\/?a|string|pay per view|ppv|internet ppv|internet stream|internet|tbd|tba|unknown|none)$/i;

/** [pattern on the trimmed text, the broadcaster's name] in the order they are tried. */
const RULES: [RegExp, string][] = [
  [/^dazn\b/i, "DAZN"],
  [/^espn\s*\+/i, "ESPN+"],
  [/^espn\b/i, "ESPN"],
  [/^show\s?time\b/i, "Showtime"],
  [/^youtube\b/i, "YouTube"],
  [/^fite\b/i, "FITE"],
  [/^fox\s*sports?\s*(?:1|2|net|ppv)?$|^fox\b/i, "FOX"],
  [/^sky\s*(?:sports?|box office)\b/i, "Sky Sports"],
  [/^(?:bt\s*sport|tnt\s*sports?)\b/i, "TNT Sports"],
  [/^triller\s?tv\b/i, "TrillerTV"],
  [/^hbo\b/i, "HBO"],
  [/^amazon\b/i, "Amazon Prime Video"],
  [/^itv\b/i, "ITV"],
  [/^nbc\b/i, "NBC"],
  [/^cbs\b/i, "CBS"],
  [/^facebook\b/i, "Facebook"],
  [/^probox\s?tv\b/i, "ProBox TV"],
  [/^peacock\b/i, "Peacock"],
  [/^fubo/i, "Fubo"],
  [/^paramount\+?/i, "Paramount+"],
];

export function canonicalBroadcaster(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim().replace(/\s+/g, " ");
  if (!s || NOBODY.test(s)) return null;
  for (const [re, name] of RULES) if (re.test(s)) return name;
  return s;
}

/** The address of a broadcaster's page. */
export const broadcasterSlug = (name: string): string => "broadcaster-" + name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\+/g, "-plus").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
