/**
 * The address of a calendar file. The feed is not a page, so it has no language prefix (`/ar/feeds/...` does not exist): the language is `?lang=`, left out for English.
 * One helper owns this, so no page link is ever written without the locale prefix (a source rule insists on that for every `<a href="/...">`).
 */
export type CalendarWhat = { event: number } | { bout: number } | { slugs: string[]; days?: number };
export function calendarPath(what: CalendarWhat, locale: string): string {
  const parts = "event" in what ? [`event=${what.event}`] : "bout" in what ? [`bout=${what.bout}`] : [`slugs=${encodeURIComponent(what.slugs.join(","))}`, ...(what.days ? [`days=${what.days}`] : [])];
  if (locale !== "en") parts.push(`lang=${locale}`);
  return `/feeds/calendar.ics?${parts.join("&")}`;
}
