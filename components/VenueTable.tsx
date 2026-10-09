import { countryName, fmtDate } from "@/lib/format";
import { mapsUrl, type VenueRow } from "@/lib/venues";
import type { T } from "@/lib/i18n/t";
import { ScrollRegion } from "@/components/ScrollRegion";

/** Venues that have held fights: the name and city, the kind of place and its address where the open data gave them, its capacity where Wikidata did, how many cards it has held, and a plain link to it in Google Maps. */
export function VenueTable({ venues, t, showCountry = false }: { venues: VenueRow[]; t: T; showCountry?: boolean }) {
  return (
    <ScrollRegion label={t("Venues that have held fights")} className="relative rounded-2xl border border-line">
      <table className="w-full min-w-[34rem] text-sm">
        <caption className="sr-only">{t("Venues that have held fights")}</caption>
        <thead className="bg-panel2 text-start text-xs uppercase tracking-wide text-muted">
          <tr>
            <th scope="col" className="p-3">{t("Venue")}</th>
            <th scope="col" className="p-3">{showCountry ? t("City, country") : t("City")}</th>
            <th scope="col" className="hidden p-3 sm:table-cell">{t("Kind")}</th>
            <th scope="col" className="hidden p-3 lg:table-cell">{t("Address")}</th>
            <th scope="col" className="hidden p-3 text-end md:table-cell">{t("Capacity")}</th>
            <th scope="col" className="p-3 text-end">{t("Cards")}</th>
            <th scope="col" className="p-3"><span className="sr-only">{t("Map")}</span></th>
          </tr>
        </thead>
        <tbody>
          {venues.map((v, i) => (
            <tr key={`${v.name}|${v.city}`} id={`venue-${i}`} className="border-t border-line align-top">
              <th scope="row" className="p-3 text-start font-semibold"><span lang="en" dir="ltr">{v.name}</span>{v.lastDate ? <div className="text-xs font-normal text-muted">{t("last card {date}", { date: fmtDate(v.lastDate, { month: "short", year: "numeric" }, t.locale) })}</div> : null}</th>
              <td className="p-3 text-muted">{[v.city && <span key="c" lang="en" dir="ltr">{v.city}</span>, showCountry && v.country ? countryName(v.country, t.locale) : null].filter(Boolean).reduce<React.ReactNode[]>((a, x, k) => (k ? [...a, ", ", x] : [x]), [])}</td>
              <td className="hidden p-3 text-muted sm:table-cell">{v.category ?? "-"}</td>
              <td className="hidden p-3 text-muted lg:table-cell">{v.address ? <span lang="en" dir="ltr">{v.address}</span> : "-"}</td>
              <td className="tabular hidden p-3 text-end text-muted md:table-cell">{v.capacity ? v.capacity.toLocaleString("en-US") : "-"}</td>
              <td className="tabular p-3 text-end">{(v.events + v.upcoming).toLocaleString("en-US")}</td>
              <td className="p-3 text-end"><a href={mapsUrl(v)} target="_blank" rel="noopener noreferrer nofollow" className="inline-block whitespace-nowrap py-1 text-xs text-muted underline decoration-dotted hover:text-ink">{t("Open in Google Maps")} ↗</a></td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollRegion>
  );
}
