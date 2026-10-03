/** The four sanctioning bodies whose belts have a picture (see lib/media/entities.ts), by the code the pictures are filed under. */
const FULL: Record<string, string> = { "world boxing association": "WBA", "world boxing council": "WBC", "international boxing federation": "IBF", "world boxing organization": "WBO" };

/** WBA, WBC, IBF or WBO for an organisation called "WBC", "wbc" or "World Boxing Council"; null for anything else (a different body, a promotion, a made-up name). */
export function bodyCode(name: string | null | undefined): string | null {
  const n = (name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const code = n.toUpperCase();
  return code === "WBA" || code === "WBC" || code === "IBF" || code === "WBO" ? code : FULL[n] ?? null;
}
