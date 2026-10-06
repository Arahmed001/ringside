import { getT } from "@/lib/i18n/server";
import { calendarPath } from "@/lib/calendar-link";

/** "Add to calendar" for one card or one fight: a download of its .ics file (`/feeds/calendar.ics`), in the page's language. */
export async function AddToCalendar({ kind, id }: { kind: "event" | "bout"; id: number }) {
  const t = await getT();
  return (
    <a href={calendarPath(kind === "event" ? { event: id } : { bout: id }, t.locale)} download className="chip transition hover:!text-gold">
      <span aria-hidden="true">📅 </span>{t("Add to calendar")}
    </a>
  );
}
