"use client";
import { useState } from "react";
import Link from "@/components/L";
import { useT } from "@/components/i18n";

/** [slug, name, x, y, style index, record, division index]: tuples, because repeating eight key names per point was a third of the payload. */
export type MapPoint = [slug: string, name: string, x: number, y: number, style: number, record: string, division: number];

export function StyleMap({ points, styles, divisions }: { points: MapPoint[]; styles: { label: string; color: string }[]; divisions: string[] }) {
  const t = useT();
  const [hover, setHover] = useState<MapPoint | null>(null);
  const legend = styles.filter((l) => l.label !== "Prospect"); // nobody with 8+ bouts is a prospect
  const [list, setList] = useState(false);
  const [hide, setHide] = useState<Set<string>>(new Set(["Journeyman"])); // journeymen outnumber contenders and would swamp the map
  const shown = points.filter((p) => !hide.has(styles[p[4]].label));
  // dots shrink as the map fills up so 2,000 of them stay readable (0.8 is the size used up to about 800 dots)
  const dot = Math.min(0.8, Math.max(0.35, 0.8 * Math.sqrt(800 / Math.max(1, shown.length))));
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {legend.map((l) => (
          <button key={l.label} onClick={() => setHide((h) => { const n = new Set(h); if (n.has(l.label)) n.delete(l.label); else n.add(l.label); return n; })}
            aria-pressed={!hide.has(l.label)} className={`chip cursor-pointer ${hide.has(l.label) ? "line-through decoration-muted" : "!text-ink"}`}>
            <span className="h-2 w-2 rounded-full" style={{ background: hide.has(l.label) ? "transparent" : l.color, boxShadow: `inset 0 0 0 1.5px ${l.color}` }} aria-hidden />{t(l.label)}
          </button>
        ))}
        <button onClick={() => setList((v) => !v)} aria-pressed={list} className="chip ms-auto cursor-pointer !text-ink hover:!border-gold/60">{list ? t("Show the map") : t("Show as a list")}</button>
      </div>
      {list ? (
        <div className="card max-h-[70vh] overflow-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">{t("Fighter style map")}</caption>
            <thead className="sticky top-0 bg-panel text-start text-xs text-muted"><tr><th scope="col" className="px-4 py-2 text-start font-medium">{t("Fighter")}</th><th scope="col" className="px-4 py-2 text-start font-medium">{t("Style")}</th><th scope="col" className="px-4 py-2 text-start font-medium">{t("Division")}</th><th scope="col" className="px-4 py-2 text-start font-medium">{t("Record")}</th></tr></thead>
            <tbody>
              {[...shown].sort((a, b) => a[4] - b[4] || a[1].localeCompare(b[1])).map((p) => (
                <tr key={p[0]} className="border-t border-line">
                  <th scope="row" className="px-4 py-1.5 text-start font-semibold"><Link href={`/boxers/${p[0]}`} className="hover:text-gold">{p[1]}</Link></th>
                  <td className="px-4 py-1.5"><span className="me-2 inline-block h-2 w-2 rounded-full" style={{ background: styles[p[4]].color }} aria-hidden />{t(styles[p[4]].label)}</td>
                  <td className="px-4 py-1.5 text-muted">{t(divisions[p[6]])}</td>
                  <td className="tabular px-4 py-1.5 text-muted" dir="ltr">{p[5]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
      <div className="card relative overflow-hidden">
        {/* A picture of 2,000 dots has no useful text equivalent; the list view is the accessible version. */}
        <p className="sr-only">{t("Fighter style map. Use “Show as a list” for the same fighters as text.")}</p>
        <svg viewBox="0 0 100 62" className="w-full" aria-hidden>
          {[20, 40, 60, 80].map((v) => <line key={v} x1={v} x2={v} y1="0" y2="62" stroke="#fff" strokeOpacity=".06" strokeWidth="0.12" />)}
          {[15, 31, 47].map((v) => <line key={v} y1={v} y2={v} x1="0" x2="100" stroke="#fff" strokeOpacity=".06" strokeWidth="0.12" />)}
          {shown.map((p) => (
            <Link key={p[0]} href={`/boxers/${p[0]}`} tabIndex={-1} aria-hidden>
              <circle cx={4 + p[2] * 92} cy={3 + p[3] * 56} r={hover?.[0] === p[0] ? dot * 2.1 : dot} fill={styles[p[4]].color} fillOpacity={hover && hover[0] !== p[0] ? 0.3 : 0.78}
                onMouseEnter={() => setHover(p)} onMouseLeave={() => setHover(null)} style={{ transition: "r .15s, fill-opacity .15s", cursor: "pointer" }} />
            </Link>
          ))}
        </svg>
        <div className="pointer-events-none absolute start-4 top-4 min-h-14 rounded-xl [@media(hover:none)]:hidden border border-line bg-bg/85 px-3 py-2 text-sm backdrop-blur" style={{ opacity: hover ? 1 : 0.6 }}>
          {hover ? <><div className="font-display text-lg font-bold leading-tight">{hover[1]}</div><div className="text-xs text-muted">{t("{style} · {division} · {record}", { style: t(styles[hover[4]].label), division: t(divisions[hover[6]]), record: hover[5] })}</div></> : <div className="text-xs text-muted">{t("Hover a dot · click to open the profile")}</div>}
        </div>
      </div>
      )}
    </div>
  );
}
