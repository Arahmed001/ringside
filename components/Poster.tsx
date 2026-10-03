import type { BoutRow, BoxerFull, EventRow } from "@/lib/types";
import { Portrait } from "./Portrait";
import { hash, pickBy } from "@/lib/hash";

const HUES: [string, string, string][] = [
  ["#7a1118", "#1a0507", "#ff5a4d"], ["#10306b", "#050a1a", "#5aa0ff"], ["#6b4a10", "#150f04", "#ffd36a"],
  ["#14583f", "#04120d", "#58e0a8"], ["#4a1a6b", "#0e0415", "#c58bff"], ["#6b2a10", "#150804", "#ff9a5a"],
];

const fmtDate = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).toUpperCase();
const sur = (n: string) => n.split(" ").slice(-1)[0].toUpperCase();

/** A real (licensed) photo when we have one, otherwise the generated portrait. */
function Fighter({ boxer, uid, x }: { boxer: BoxerFull; uid: string; x: number }) {
  if (boxer.photoUrl) return <image href={boxer.photoUrl} x={x} y="50" width="280" height="350" preserveAspectRatio="xMidYMin slice" />;
  return <svg x={x} y="50" width="280" height="350" viewBox="0 0 120 150"><Portrait boxer={boxer} uid={uid} /></svg>;
}

/** Generated promo art for the main event. Replaced by `event.posterUrl` when a licensed feed supplies one. */
export function Poster({ event, main, red, blue, className = "" }: { event: EventRow; main: BoutRow; red: BoxerFull; blue: BoxerFull; className?: string }) {
  if (event.posterUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={event.posterUrl} alt={event.name} className={`aspect-[5/7] w-full rounded-2xl object-cover ${className}`} />;
  }
  const h = hash(event.name + event.date);
  const [c0, c1, accent] = pickBy(h, 1, HUES);
  const u = `p${event.id}`;
  const rs = sur(red.name), bs = sur(blue.name);
  const fs = (s: string) => (s.length > 9 ? 30 : s.length > 7 ? 38 : 46);
  return (
    <svg viewBox="0 0 400 560" className={`aspect-[5/7] w-full rounded-2xl ${className}`} role="img" aria-label={`Poster: ${red.name} vs ${blue.name}`}>
      <defs>
        <linearGradient id={`${u}-bg`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={c0} /><stop offset="1" stopColor={c1} /></linearGradient>
        <radialGradient id={`${u}-spot`} cx="50%" cy="30%" r="60%"><stop offset="0" stopColor={accent} stopOpacity=".5" /><stop offset="1" stopColor={accent} stopOpacity="0" /></radialGradient>
        <linearGradient id={`${u}-fade`} x1="0" y1="0" x2="0" y2="1"><stop offset=".55" stopColor={c1} stopOpacity="0" /><stop offset="1" stopColor={c1} /></linearGradient>
        <clipPath id={`${u}-l`}><polygon points="0,70 232,70 168,420 0,420" /></clipPath>
        <clipPath id={`${u}-r`}><polygon points="232,70 400,70 400,420 168,420" /></clipPath>
      </defs>
      <rect width="400" height="560" fill={`url(#${u}-bg)`} />
      <rect width="400" height="560" fill={`url(#${u}-spot)`} />
      {/* ring ropes */}
      {[0, 1, 2].map((i) => <path key={i} d={`M-10 ${380 + i * 26} Q200 ${352 + i * 26} 410 ${380 + i * 26}`} stroke={accent} strokeOpacity={0.35 - i * 0.08} strokeWidth="3" fill="none" />)}
      {/* fighters */}
      <g clipPath={`url(#${u}-l)`}><Fighter boxer={red} uid={`${u}r`} x={-30} /></g>
      <g clipPath={`url(#${u}-r)`}><Fighter boxer={blue} uid={`${u}b`} x={150} /></g>
      <line x1="232" y1="70" x2="168" y2="420" stroke={accent} strokeWidth="3" />
      <rect width="400" height="560" fill={`url(#${u}-fade)`} />
      {/* header */}
      <text x="200" y="38" textAnchor="middle" fill={accent} fontSize="13" letterSpacing="6" fontWeight="700" style={{ fontFamily: "var(--font-display)" }}>
        {main.title ? main.title.toUpperCase() : `${main.weightClass.toUpperCase()} · ${main.rounds} ROUNDS`}
      </text>
      <text x="200" y="58" textAnchor="middle" fill="#fff" fillOpacity=".55" fontSize="10" letterSpacing="4" style={{ fontFamily: "var(--font-display)" }}>
        {main.title ? `${main.weightClass.toUpperCase()} · ${main.rounds} ROUNDS` : "MAIN EVENT"}
      </text>
      {/* names */}
      <text x="22" y="456" fill="#fff" fontSize={fs(rs)} fontWeight="800" style={{ fontFamily: "var(--font-display)" }}>{rs}</text>
      <text x="378" y="500" textAnchor="end" fill="#fff" fontSize={fs(bs)} fontWeight="800" style={{ fontFamily: "var(--font-display)" }}>{bs}</text>
      <circle cx="200" cy="448" r="19" fill={accent} />
      <text x="200" y="455" textAnchor="middle" fill="#0a0a0c" fontSize="20" fontWeight="900" style={{ fontFamily: "var(--font-display)" }}>VS</text>
      <text x="22" y="474" fill={accent} fontSize="12" letterSpacing="2" style={{ fontFamily: "var(--font-display)" }}>{red.wins}-{red.losses}-{red.draws} · {red.country.toUpperCase()}</text>
      <text x="378" y="518" textAnchor="end" fill={accent} fontSize="12" letterSpacing="2" style={{ fontFamily: "var(--font-display)" }}>{blue.wins}-{blue.losses}-{blue.draws} · {blue.country.toUpperCase()}</text>
      {/* footer */}
      <rect y="528" width="400" height="32" fill="#000" fillOpacity=".55" />
      <text x="22" y="548" fill="#fff" fontSize="12" letterSpacing="2" fontWeight="700" style={{ fontFamily: "var(--font-display)" }}>{fmtDate(event.date)}</text>
      <text x="378" y="548" textAnchor="end" fill="#fff" fillOpacity=".75" fontSize="11" letterSpacing="2" style={{ fontFamily: "var(--font-display)" }}>{event.venue.toUpperCase()} · {event.city.toUpperCase()}</text>
    </svg>
  );
}
