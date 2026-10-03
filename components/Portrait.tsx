import type { Boxer } from "@/lib/types";
import { hash, pickBy, frac } from "@/lib/hash";
import { divisionInfo } from "@/lib/divisions";
import { getT } from "@/lib/i18n/server";

const SKIN = ["#f3cfae", "#e6b48a", "#cf9467", "#a8714a", "#80502f", "#5c3822"];
const HAIR = ["#16110e", "#2b1d14", "#4a3020", "#0d0d0f", "#6b4a2b", "#a9a9a9"];
const KIT = ["#c8202a", "#1f55c8", "#0e0e12", "#e8e8ea", "#1a8a5a", "#d9a22b"];
const BG: [string, string][] = [
  ["#3a1016", "#0f0b0c"], ["#10223f", "#0a0c12"], ["#2a2410", "#0e0d09"], ["#13302a", "#0a100e"],
  ["#2b1640", "#0d0a12"], ["#3a1d0e", "#100b08"],
];

type P = Pick<Boxer, "id" | "slug" | "weightClass" | "stance">;

export function Portrait({ boxer, uid }: { boxer: P; uid: string }) {
  const h = hash(boxer.slug);
  const skin = pickBy(h, 1, SKIN);
  const skinShade = "rgba(0,0,0,.18)";
  const hairC = pickBy(h, 2, HAIR);
  const kit = pickBy(h, 3, KIT);
  const [bg0, bg1] = pickBy(h, 4, BG);
  const heavy = (() => { const d = divisionInfo(boxer.weightClass); return d?.lb ? Math.min(1, (d.lb - 105) / 95) : 1; })();
  const jaw = 30 + heavy * 8 + frac(h, 5) * 3; // half head width
  const hair = pickBy(h, 6, ["bald", "buzz", "crop", "curly", "fade", "waves", "buzz", "crop"]);
  const beard = pickBy(h, 7, ["none", "none", "stubble", "full", "goatee", "none"]);
  const scar = frac(h, 8) < 0.28;
  const browLow = 2 + frac(h, 9) * 3;
  const nose = 3 + frac(h, 10) * 4;
  const gloveColor = pickBy(h, 11, ["#c8202a", "#1f55c8"]);
  const cx = 60, headTop = 38, headBot = 118;
  const faceMid = 80;

  return (
    <g>
      <defs>
        <radialGradient id={`bg-${uid}`} cx="50%" cy="38%" r="75%">
          <stop offset="0" stopColor={bg0} />
          <stop offset="1" stopColor={bg1} />
        </radialGradient>
        <linearGradient id={`sk-${uid}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={skin} />
          <stop offset="0.7" stopColor={skin} />
          <stop offset="1" stopColor="#000" stopOpacity="0.22" />
        </linearGradient>
        <linearGradient id={`gl-${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={gloveColor} />
          <stop offset="1" stopColor="#000" stopOpacity="0.45" />
        </linearGradient>
      </defs>
      <rect width="120" height="150" fill={`url(#bg-${uid})`} />
      <circle cx="60" cy="70" r="58" fill="#fff" opacity=".04" />
      {/* shoulders & kit */}
      <path d={`M2 150 C4 128 24 120 ${cx - 14} 116 L${cx + 14} 116 C96 120 116 128 118 150Z`} fill={kit} />
      <path d={`M${cx - 14} 116 L${cx} 132 L${cx + 14} 116`} fill="none" stroke="#000" strokeOpacity=".25" strokeWidth="2" />
      {/* neck */}
      <rect x={cx - 15 - heavy * 3} y={faceMid + 22} width={30 + heavy * 6} height="30" rx="8" fill={skin} />
      <rect x={cx - 15 - heavy * 3} y={faceMid + 22} width={30 + heavy * 6} height="12" fill={skinShade} />
      {/* ears */}
      <ellipse cx={cx - jaw - 1} cy={faceMid} rx="5" ry="9" fill={skin} />
      <ellipse cx={cx + jaw + 1} cy={faceMid} rx="5" ry="9" fill={skin} />
      {/* head */}
      <path
        d={`M${cx - jaw} ${headTop + 22} C${cx - jaw} ${headTop - 4} ${cx + jaw} ${headTop - 4} ${cx + jaw} ${headTop + 22}
            L${cx + jaw - 2} ${faceMid + 14} C${cx + jaw - 4} ${headBot - 6} ${cx + 14} ${headBot + 2} ${cx} ${headBot + 2}
            C${cx - 14} ${headBot + 2} ${cx - jaw + 4} ${headBot - 6} ${cx - jaw + 2} ${faceMid + 14}Z`}
        fill={`url(#sk-${uid})`}
      />
      {/* hair */}
      {hair === "buzz" && <path d={`M${cx - jaw + 1} ${headTop + 24} C${cx - jaw} ${headTop - 6} ${cx + jaw} ${headTop - 6} ${cx + jaw - 1} ${headTop + 24} C${cx + 16} ${headTop + 8} ${cx - 16} ${headTop + 8} ${cx - jaw + 1} ${headTop + 24}Z`} fill={hairC} opacity=".85" />}
      {hair === "crop" && <path d={`M${cx - jaw} ${headTop + 26} C${cx - jaw - 2} ${headTop - 10} ${cx + jaw + 2} ${headTop - 10} ${cx + jaw} ${headTop + 26} C${cx + 22} ${headTop + 6} ${cx - 8} ${headTop + 2} ${cx - jaw} ${headTop + 26}Z`} fill={hairC} />}
      {hair === "fade" && <><path d={`M${cx - jaw + 2} ${headTop + 30} C${cx - jaw} ${headTop - 4} ${cx + jaw} ${headTop - 4} ${cx + jaw - 2} ${headTop + 30} L${cx + jaw - 6} ${headTop + 14} C${cx + 10} ${headTop + 2} ${cx - 10} ${headTop + 2} ${cx - jaw + 6} ${headTop + 14}Z`} fill={hairC} /><path d={`M${cx - jaw + 2} ${headTop + 30} L${cx - jaw + 6} ${headTop + 14} L${cx - jaw + 9} ${headTop + 30}Z`} fill={hairC} opacity=".4" /><path d={`M${cx + jaw - 2} ${headTop + 30} L${cx + jaw - 6} ${headTop + 14} L${cx + jaw - 9} ${headTop + 30}Z`} fill={hairC} opacity=".4" /></>}
      {hair === "waves" && <path d={`M${cx - jaw} ${headTop + 26} C${cx - jaw - 3} ${headTop - 12} ${cx + jaw + 3} ${headTop - 12} ${cx + jaw} ${headTop + 26} C${cx + 14} ${headTop + 10} ${cx - 14} ${headTop + 10} ${cx - jaw} ${headTop + 26}Z`} fill={hairC} />}
      {hair === "curly" && (
        <g fill={hairC}>
          {Array.from({ length: 9 }, (_, i) => {
            const a = Math.PI + (i / 8) * Math.PI;
            return <circle key={i} cx={cx + Math.cos(a) * (jaw + 1)} cy={headTop + 20 + Math.sin(a) * 26} r="8" />;
          })}
          <ellipse cx={cx} cy={headTop + 6} rx={jaw - 2} ry="10" />
        </g>
      )}
      {/* brows */}
      <path d={`M${cx - 23} ${faceMid - 14 + browLow} L${cx - 7} ${faceMid - 16 + browLow + 2}`} stroke={hairC} strokeWidth="4" strokeLinecap="round" />
      <path d={`M${cx + 23} ${faceMid - 14 + browLow} L${cx + 7} ${faceMid - 16 + browLow + 2}`} stroke={hairC} strokeWidth="4" strokeLinecap="round" />
      {/* eyes */}
      {[-15, 15].map((dx) => (
        <g key={dx}>
          <ellipse cx={cx + dx} cy={faceMid - 6} rx="5.5" ry="3.2" fill="#f4f1ea" />
          <circle cx={cx + dx} cy={faceMid - 6} r="2.4" fill="#1a1210" />
          <circle cx={cx + dx + 0.8} cy={faceMid - 6.8} r=".8" fill="#fff" />
          <path d={`M${cx + dx - 6} ${faceMid - 8} Q${cx + dx} ${faceMid - 11} ${cx + dx + 6} ${faceMid - 8}`} stroke={skinShade} strokeWidth="1.4" fill="none" />
        </g>
      ))}
      {/* nose */}
      <path d={`M${cx} ${faceMid - 6} L${cx - 2} ${faceMid + 6 + nose} Q${cx} ${faceMid + 9 + nose} ${cx + 5} ${faceMid + 6 + nose}`} stroke={skinShade} strokeWidth="2" fill="none" strokeLinecap="round" />
      {/* mouth */}
      <path d={`M${cx - 10} ${faceMid + 24} Q${cx} ${faceMid + 28} ${cx + 10} ${faceMid + 24}`} stroke="#3a1a16" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      {/* beard */}
      {beard === "stubble" && <path d={`M${cx - jaw + 4} ${faceMid + 12} C${cx - jaw + 6} ${headBot} ${cx + jaw - 6} ${headBot} ${cx + jaw - 4} ${faceMid + 12} C${cx + 18} ${faceMid + 22} ${cx - 18} ${faceMid + 22} ${cx - jaw + 4} ${faceMid + 12}Z`} fill="#000" opacity=".16" />}
      {beard === "full" && <path d={`M${cx - jaw + 2} ${faceMid + 6} C${cx - jaw + 2} ${headBot + 6} ${cx + jaw - 2} ${headBot + 6} ${cx + jaw - 2} ${faceMid + 6} C${cx + 20} ${faceMid + 20} ${cx + 8} ${faceMid + 20} ${cx} ${faceMid + 19} C${cx - 8} ${faceMid + 20} ${cx - 20} ${faceMid + 20} ${cx - jaw + 2} ${faceMid + 6}Z`} fill={hairC} opacity=".92" />}
      {beard === "goatee" && <path d={`M${cx - 9} ${faceMid + 28} Q${cx} ${headBot + 4} ${cx + 9} ${faceMid + 28} Q${cx} ${faceMid + 22} ${cx - 9} ${faceMid + 28}Z`} fill={hairC} />}
      {scar && <path d={`M${cx + 16} ${faceMid - 20} L${cx + 12} ${faceMid - 8}`} stroke="#000" strokeOpacity=".35" strokeWidth="1.6" strokeLinecap="round" />}
      {/* raised gloves */}
      <g>
        <ellipse cx="14" cy="128" rx="17" ry="20" fill={`url(#gl-${uid})`} />
        <rect x="6" y="140" width="17" height="10" rx="2" fill="#f1efe8" />
        <ellipse cx="106" cy="128" rx="17" ry="20" fill={`url(#gl-${uid})`} />
        <rect x="97" y="140" width="17" height="10" rx="2" fill="#f1efe8" />
        <ellipse cx="9" cy="121" rx="5" ry="8" fill="#fff" opacity=".18" />
        <ellipse cx="101" cy="121" rx="5" ry="8" fill="#fff" opacity=".18" />
      </g>
    </g>
  );
}

export async function Headshot({ boxer, size = 64, className = "", rounded = true }: { boxer: P & { name: string; photoUrl?: string | null }; size?: number; className?: string; rounded?: boolean }) {
  const t = await getT();
  const r = rounded ? "rounded-xl" : "";
  if (boxer.photoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={boxer.photoUrl} alt={t.name(boxer.name)} width={size} height={size * 1.25} loading="lazy" referrerPolicy="no-referrer" className={`${r} object-cover object-top ${className}`} style={{ width: size, height: size * 1.25 }} />;
  }
  return (
    <svg viewBox="0 0 120 150" width={size} height={size * 1.25} role="img" aria-label={t("Portrait of {name}", { name: t.name(boxer.name) })} className={`${r} ${className} shrink-0`} style={{ width: size, height: size * 1.25 }}>
      <Portrait boxer={boxer} uid={`h${boxer.id}`} />
    </svg>
  );
}
