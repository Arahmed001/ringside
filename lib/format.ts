import { endsEarly } from "./methods";
import { nowMs } from "./clock";

export const fmtDate = (d: string, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" }) =>
  new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
export const pct = (x: number, digits = 0) => `${(x * 100).toFixed(digits)}%`;
export const daysUntil = (d: string) => Math.ceil((Date.parse(d + "T12:00:00Z") - nowMs()) / 86400000);
export const FLAGS: Record<string, string> = {
  "United States": "🇺🇸", Mexico: "🇲🇽", "United Kingdom": "🇬🇧", Japan: "🇯🇵", Ukraine: "🇺🇦",
  Philippines: "🇵🇭", Nigeria: "🇳🇬", Argentina: "🇦🇷", "Saudi Arabia": "🇸🇦", Germany: "🇩🇪",
};
export const flag = (c: string) => FLAGS[c] ?? "🏳️";
/** Short result label: "KO R4", "UD", "DQ R3", "Draw". */
export const methodLabel = (m: string | null, r: number | null) =>
  !m ? "—" : m === "DRAW" ? "Draw" : m === "TDRAW" ? `Tech draw${r ? ` R${r}` : ""}` : m === "NC" ? "No contest" : endsEarly(m) && r ? `${m} R${r}` : m;
