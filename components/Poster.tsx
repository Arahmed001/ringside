import type { BoutRow, BoxerFull, EventRow } from "@/lib/types";
import { portraitUrl } from "@/lib/art-url";
import { hash, pickBy } from "@/lib/hash";
import { HEADER_SCRIM, POSTER_HUES } from "@/lib/poster-colors";
import { divisionLabel } from "@/lib/divisions";
import { getT } from "@/lib/i18n/server";
import { countryName, fmtDate } from "@/lib/format";

/** A real (licensed) photo when we have one, otherwise the generated portrait. */
function Fighter({ boxer, x }: { boxer: BoxerFull; x: number }) {
  if (boxer.photoUrl) return <image href={boxer.photoUrl} x={x} y="50" width="280" height="350" preserveAspectRatio="xMidYMin slice" />;
  // an external image rather than a nested copy of the portrait: the poster text stays inline (it uses the page fonts), the art is cached
  return <image href={portraitUrl(boxer.slug)} x={x} y="50" width="280" height="350" preserveAspectRatio="xMidYMid meet" />;
}

/** Generated promo art for the main event. Replaced by `event.posterUrl` when a licensed feed supplies one. */
export async function Poster({ event, main, red, blue, className = "", priority = false }: { event: EventRow; main: BoutRow; red: BoxerFull; blue: BoxerFull; className?: string; /** the poster the page is waiting to paint (the home page's next fight): fetched first; every other poster loads lazily */ priority?: boolean }) {
  const t = await getT();
  if (event.posterUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={event.posterUrl} alt={t.name(event.name)} {...(priority ? { loading: "eager", fetchPriority: "high" } as const : { loading: "lazy" } as const)} decoding="async" className={`aspect-[5/7] w-full rounded-2xl object-cover ${className}`} />;
  }
  const h = hash(event.name + event.date);
  const [c0, c1, accent] = pickBy(h, 1, POSTER_HUES);
  const u = `p${event.id}`;
  const sur = (n: string) => { const last = t.name(n).split(" ").slice(-1)[0]; return t.locale === "en" ? last.toUpperCase() : last; };
  const rs = sur(red.name), bs = sur(blue.name);
  const info = t.n(main.rounds, "{division} · {n} round", "{division} · {n} rounds", { division: divisionLabel(main.weightClass, red.sex, t) }).toUpperCase();
  const up = (x: string) => x.toUpperCase();
  // Arabic glyphs run wider than the condensed Latin face, so the same name needs a smaller size to stay clear of the VS badge
  const fs = (s: string) => (t.locale === "ar" ? (s.length > 8 ? 24 : s.length > 5 ? 30 : 36) : s.length > 9 ? 30 : s.length > 7 ? 38 : 46);
  return (
    <svg viewBox="0 0 400 560" className={`ltr-fixed aspect-[5/7] w-full rounded-2xl ${className}`} role="img" aria-label={t("Poster: {red} vs {blue}", { red: t.name(red.name), blue: t.name(blue.name) })}>
      <defs>
        <linearGradient id={`${u}-bg`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={c0} /><stop offset="1" stopColor={c1} /></linearGradient>
        <radialGradient id={`${u}-spot`} cx="50%" cy="30%" r="60%"><stop offset="0" stopColor={accent} stopOpacity=".5" /><stop offset="1" stopColor={accent} stopOpacity="0" /></radialGradient>
        <linearGradient id={`${u}-fade`} x1="0" y1="0" x2="0" y2="1"><stop offset=".55" stopColor={c1} stopOpacity="0" /><stop offset="1" stopColor={c1} /></linearGradient>
        <linearGradient id={`${u}-top`} x1="0" y1="0" x2="0" y2="1">{HEADER_SCRIM.stops.map(([o, a]) => <stop key={o} offset={o} stopColor="#000" stopOpacity={a} />)}</linearGradient>
        <clipPath id={`${u}-l`}><polygon points="0,70 232,70 168,420 0,420" /></clipPath>
        <clipPath id={`${u}-r`}><polygon points="232,70 400,70 400,420 168,420" /></clipPath>
      </defs>
      <rect width="400" height="560" fill={`url(#${u}-bg)`} />
      <rect width="400" height="560" fill={`url(#${u}-spot)`} />
      {/* ring ropes */}
      {[0, 1, 2].map((i) => <path key={i} d={`M-10 ${380 + i * 26} Q200 ${352 + i * 26} 410 ${380 + i * 26}`} stroke={accent} strokeOpacity={0.35 - i * 0.08} strokeWidth="3" fill="none" />)}
      {/* fighters */}
      <g clipPath={`url(#${u}-l)`}><Fighter boxer={red} x={-30} /></g>
      <g clipPath={`url(#${u}-r)`}><Fighter boxer={blue} x={150} /></g>
      <line x1="232" y1="70" x2="168" y2="420" stroke={accent} strokeWidth="3" />
      <rect width="400" height="560" fill={`url(#${u}-fade)`} />
      {/* a dark band behind the header lines: measured over every poster hue, the accent and grey lines were 2.4:1 without it */}
      <rect width="400" height={HEADER_SCRIM.height} fill={`url(#${u}-top)`} />
      {/* header */}
      <text x="200" y="38" textAnchor="middle" fill={accent} fontSize="13" letterSpacing="6" fontWeight="700" style={{ fontFamily: "var(--font-display)" }}>
        {main.title ? up(t.name(main.title)) : info}
      </text>
      <text x="200" y="58" textAnchor="middle" fill="#fff" fillOpacity=".85" fontSize="11" letterSpacing="4" style={{ fontFamily: "var(--font-display)" }}>
        {main.title ? info : up(t("Main event"))}
      </text>
      {/* names */}
      <text x="22" y="456" fill="#fff" fontSize={fs(rs)} fontWeight="800" style={{ fontFamily: "var(--font-display)" }}>{rs}</text>
      <text x="378" y="500" textAnchor="end" fill="#fff" fontSize={fs(bs)} fontWeight="800" style={{ fontFamily: "var(--font-display)" }}>{bs}</text>
      <circle cx="200" cy="448" r="19" fill={accent} />
      <text x="200" y="455" textAnchor="middle" fill="#0a0a0c" fontSize="20" fontWeight="900" style={{ fontFamily: "var(--font-display)" }}>{t("VS")}</text>
      <text x="22" y="474" fill={accent} fontSize="12" letterSpacing="2" style={{ fontFamily: "var(--font-display)" }}>{t("{record} · {country}", { record: `${red.wins}-${red.losses}-${red.draws}`, country: up(countryName(red.country, t.locale)) })}</text>
      <text x="378" y="518" textAnchor="end" fill={accent} fontSize="12" letterSpacing="2" style={{ fontFamily: "var(--font-display)" }}>{t("{record} · {country}", { record: `${blue.wins}-${blue.losses}-${blue.draws}`, country: up(countryName(blue.country, t.locale)) })}</text>
      {event.status === "cancelled" && (
        <g transform="rotate(-18 200 280)">
          <rect x="-40" y="248" width="480" height="64" fill="#0a0a0c" fillOpacity=".78" />
          <rect x="-40" y="248" width="480" height="64" fill="none" stroke="#e5322d" strokeWidth="3" />
          <text x="200" y="293" textAnchor="middle" fill="#e5322d" fontSize="44" fontWeight="800" letterSpacing="8" style={{ fontFamily: "var(--font-display)" }}>{up(t("Cancelled"))}</text>
        </g>
      )}
      {event.status === "postponed" && (
        <text x="200" y="78" textAnchor="middle" fill="#ffd36a" fontSize="12" letterSpacing="5" fontWeight="700" style={{ fontFamily: "var(--font-display)" }}>{up(t("Postponed · new date"))}</text>
      )}
      {/* footer */}
      <rect y="528" width="400" height="32" fill="#000" fillOpacity=".55" />
      <text x="22" y="548" fill="#fff" fontSize="12" letterSpacing="2" fontWeight="700" style={{ fontFamily: "var(--font-display)" }}>{up(fmtDate(event.date, undefined, t.locale))}</text>
      <text x="378" y="548" textAnchor="end" fill="#fff" fillOpacity=".75" fontSize="11" letterSpacing="2" style={{ fontFamily: "var(--font-display)" }}>{up(t("{venue} · {city}", { venue: t.name(event.venue), city: t.name(event.city) }))}</text>
    </svg>
  );
}
