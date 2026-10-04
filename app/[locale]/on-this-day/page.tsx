import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "@/components/L";
import { getWorld, recordStr } from "@/lib/world";
import { LEAP, dayOf, nearestWithContent, onThisDay, parseDay, shiftDay, type DayKey } from "@/lib/on-this-day";
import { ScoreBadge } from "@/components/Awards";
import { SectionTitle } from "@/components/ui";
import { resultLine } from "@/lib/fight-score";
import { countryName, flag, fmtDate, methodLabel } from "@/lib/format";
import { hasWinner } from "@/lib/methods";
import { getT, getTFor } from "@/lib/i18n/server";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { pageMetadata } from "@/lib/seo";

type Search = { d?: string | string[] };

const dayLabel = (key: DayKey, locale: Locale) => fmtDate(`${LEAP}-${key}`, { month: "long", day: "numeric" }, locale);

/** The day asked for: today when there is no `d`; a hand-edited or malformed `d` is a 404 rather than a quietly different page. */
const dayFor = (d: string | string[] | undefined, today: string): DayKey => {
  if (d === undefined) return dayOf(today) ?? "01-01";
  return (typeof d === "string" ? parseDay(d) : null) ?? notFound();
};

export async function generateMetadata({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Search> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = await getTFor(locale);
  const { d } = await searchParams;
  const w = await getWorld();
  const key = dayFor(d, w.today);
  return pageMetadata({
    locale, path: "/on-this-day", noindex: d !== undefined,
    title: d === undefined ? t("On this day") : t("{day}: On this day", { day: dayLabel(key, locale) }),
    description: t("The fights decided and the fighters born on this date in boxing history, from every year in the database, with the best fights first."),
  });
}

export default async function OnThisDay({ searchParams }: { searchParams: Promise<Search> }) {
  const t = await getT();
  const w = await getWorld();
  const { d } = await searchParams;
  const today = dayOf(w.today) ?? "01-01";
  const key = dayFor(d, w.today);
  const page = onThisDay(w, key);
  const empty = page.fightTotal + page.birthTotal === 0;
  const prev = shiftDay(key, -1), next = shiftDay(key, 1);
  const before = empty ? nearestWithContent(w, key, -1) : null, after = empty ? nearestWithContent(w, key, 1) : null;
  const link = (k: DayKey) => (k === today ? "/on-this-day" : `/on-this-day?d=${k}`);
  const counts = (c: { fights: number; births: number }) => [c.fights ? t.n(c.fights, "{n} fight", "{n} fights") : "", c.births ? t.n(c.births, "{n} birthday", "{n} birthdays") : ""].filter(Boolean).join(" · ");

  return (
    <div className="space-y-12">
      <div>
        <div className="eyebrow mb-2">{t("Boxing history")}</div>
        <h1 className="font-display text-5xl font-extrabold uppercase">{t("On this day")}</h1>
        <p className="mt-2 max-w-3xl text-muted">{t("The fights decided and the fighters born on this date, in every year the database covers. When a day is crowded the title fights and the highest-scoring fights come first.")}</p>
      </div>

      <section aria-labelledby="day" className="space-y-4">
        <h2 id="day" className="font-display text-4xl font-bold">{dayLabel(key, t.locale)}</h2>
        <nav aria-label={t("Change day")} className="flex flex-wrap gap-2 text-sm">
          <Link href={link(prev)} rel="prev" className="chip hover:!text-ink"><span className="sr-only">{t("Previous day")}: </span>{dayLabel(prev, t.locale)}</Link>
          <Link href={link(next)} rel="next" className="chip hover:!text-ink"><span className="sr-only">{t("Next day")}: </span>{dayLabel(next, t.locale)}</Link>
          {key !== today && <Link href="/on-this-day" className="chip !border-gold/40 hover:!text-gold">{t("Today")}</Link>}
        </nav>
        {!empty && (
          <p className="text-sm text-muted">
            {[page.fightTotal ? t.n(page.fightTotal, "{n} fight", "{n} fights") + (page.fightYears > 1 ? ` ${t("in {n} different years", { n: page.fightYears })}` : "") : "", page.birthTotal ? t.n(page.birthTotal, "{n} fighter born", "{n} fighters born") : ""].filter(Boolean).join(" · ")}
          </p>
        )}
      </section>

      {empty && (
        <section className="card p-6 text-sm">
          <p>{t("Nothing is on record for {day}.", { day: dayLabel(key, t.locale) })}</p>
          {(before || after) && (
            <p className="mt-3 flex flex-wrap gap-2">
              {before && <Link href={link(before.key)} className="chip hover:!text-ink">{t("Closest earlier day")}: {dayLabel(before.key, t.locale)} · {counts(before)}</Link>}
              {after && <Link href={link(after.key)} className="chip hover:!text-ink">{t("Closest later day")}: {dayLabel(after.key, t.locale)} · {counts(after)}</Link>}
            </p>
          )}
        </section>
      )}

      {page.fights.length > 0 && (
        <section>
          <SectionTitle eyebrow={t("Results")} title={t("Fights on this date")} />
          <ul className="card divide-y divide-line/60">
            {page.fights.map(({ bout: b, score }) => (
              <li key={b.id} className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-baseline gap-x-4 gap-y-1 p-4 sm:grid-cols-[4.5rem_minmax(0,1fr)_auto]">
                <span className="font-display text-2xl font-bold tabular">{b.date.slice(0, 4)}</span>
                <div className="min-w-0">
                  <Link href={`/bouts/${b.id}`} className="font-semibold hover:text-gold">{t.name(b.redName)} <span className="text-muted">{t("vs")}</span> {t.name(b.blueName)}</Link>
                  <div className="text-sm text-muted">{resultLine(w, b, t)}{hasWinner(b.method) && ` · ${methodLabel(b.method, b.endRound, t)}`}</div>
                  <div className="text-xs text-muted"><Link href={`/events/${b.eventId}`} className="inline-block py-1 hover:text-ink">{t.name(b.eventName)}</Link>{b.title && <> · <span className="text-gold">{t.name(b.title)}</span></>}</div>
                </div>
                {score !== null && <div className="col-start-2 sm:col-start-3"><ScoreBadge score={score} /></div>}
              </li>
            ))}
          </ul>
          {page.fightTotal > page.fights.length && <p className="mt-3 text-xs text-muted">{t("Showing the {shown} most important of {total} fights.", { shown: page.fights.length, total: page.fightTotal })}</p>}
        </section>
      )}

      {page.births.length > 0 && (
        <section>
          <SectionTitle eyebrow={t("Birthdays")} title={t("Born on this date")} />
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {page.births.map((b) => (
              <li key={b.id}>
                <Link href={`/boxers/${b.slug}`} className="card card-hover block p-4">
                  <div className="font-semibold">{t.name(b.name)}</div>
                  <div className="text-sm text-muted">{t("Born {year}", { year: b.birthDate!.slice(0, 4) })} · {flag(b.country)} {countryName(b.country, t.locale)}</div>
                  <div className="text-xs text-muted tabular">{recordStr(b)}</div>
                </Link>
              </li>
            ))}
          </ul>
          {page.birthTotal > page.births.length && <p className="mt-3 text-xs text-muted">{t("Showing the {shown} highest-rated of {total} fighters.", { shown: page.births.length, total: page.birthTotal })}</p>}
        </section>
      )}

      <p className="text-xs text-muted">{t("Only results in the database are listed, and a birthday only where the exact date is known. A fight on 29 February appears on 29 February only.")}</p>
    </div>
  );
}
