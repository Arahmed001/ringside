/**
 * An iCalendar (RFC 5545) file from plain inputs, so a calendar app can subscribe to fights. Pure: the caller decides what the events are (`lib/calendar.ts`).
 * Fights have a date and no start time in the data, so every event is an all-day one (`DTSTART;VALUE=DATE`, the end being the next day, which is exclusive). Each event has
 * a stable `UID`, so a calendar that fetches again updates the entry instead of adding a second. Lines end in CRLF, are folded to 75 octets without ever splitting a
 * multi-byte character (Arabic text is two bytes a letter), and text is escaped as the format requires.
 */
export interface IcsEvent {
  uid: string; /** YYYY-MM-DD */ date: string; summary: string; description?: string; location?: string; url?: string;
  status?: "CONFIRMED" | "TENTATIVE" | "CANCELLED";
}
export interface IcsCalendar { name: string; description?: string; /** IANA-style language tag, "en" or "ar" */ lang: string; /** an ISO timestamp: when this version of the data was made */ stamp: string; events: IcsEvent[] }

const encoder = new TextEncoder();
/** Text as a property value: backslash, semicolon and comma escaped, line breaks as `\n`. */
export const escapeText = (s: string): string => s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");

/** One content line as physical lines of at most 75 octets (the continuation lines start with a space, which counts), cut between characters, never inside one. */
export function foldLine(line: string): string[] {
  const out: string[] = [];
  let cur = "", bytes = 0;
  for (const ch of line) {
    const n = encoder.encode(ch).length;
    if (bytes + n > 75) { out.push(cur); cur = ` ${ch}`; bytes = 1 + n; } else { cur += ch; bytes += n; }
  }
  out.push(cur);
  return out;
}

const compact = (isoDate: string) => isoDate.replaceAll("-", "");
const nextDay = (isoDate: string) => new Date(Date.parse(`${isoDate}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
const stampOf = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

export function icsText(cal: IcsCalendar, prodId = "-//Ringside//Fight calendar//EN"): string {
  const stamp = stampOf(cal.stamp);
  const lines: string[] = ["BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:${prodId}`, "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${escapeText(cal.name)}`];
  if (cal.description) lines.push(`X-WR-CALDESC:${escapeText(cal.description)}`);
  lines.push("REFRESH-INTERVAL;VALUE=DURATION:PT12H", "X-PUBLISHED-TTL:PT12H");
  const events = [...cal.events].sort((a, b) => a.date.localeCompare(b.date) || a.uid.localeCompare(b.uid));
  for (const e of events) {
    lines.push("BEGIN:VEVENT", `UID:${e.uid}`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${compact(e.date)}`, `DTEND;VALUE=DATE:${compact(nextDay(e.date))}`, `SUMMARY;LANGUAGE=${cal.lang}:${escapeText(e.summary)}`);
    if (e.description) lines.push(`DESCRIPTION;LANGUAGE=${cal.lang}:${escapeText(e.description)}`);
    if (e.location) lines.push(`LOCATION;LANGUAGE=${cal.lang}:${escapeText(e.location)}`);
    if (e.url) lines.push(`URL:${e.url}`);
    lines.push(`STATUS:${e.status ?? "CONFIRMED"}`, "TRANSP:TRANSPARENT", "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.flatMap(foldLine).join("\r\n") + "\r\n";
}
