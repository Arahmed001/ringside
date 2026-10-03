"use client";
import { useState } from "react";
import Link from "next/link";

export interface MapPoint { slug: string; name: string; x: number; y: number; color: string; arch: string; record: string; wc: string }

export function StyleMap({ points, legend }: { points: MapPoint[]; legend: { label: string; color: string }[] }) {
  const [hover, setHover] = useState<MapPoint | null>(null);
  const [hide, setHide] = useState<Set<string>>(new Set(["Journeyman"])); // journeymen outnumber contenders and would swamp the map
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        {legend.map((l) => (
          <button key={l.label} onClick={() => setHide((h) => { const n = new Set(h); if (n.has(l.label)) n.delete(l.label); else n.add(l.label); return n; })}
            className="chip cursor-pointer" style={{ opacity: hide.has(l.label) ? 0.35 : 1 }}>
            <span className="h-2 w-2 rounded-full" style={{ background: l.color }} />{l.label}
          </button>
        ))}
      </div>
      <div className="card relative overflow-hidden">
        <svg viewBox="0 0 100 62" className="w-full" role="img" aria-label="Fighter style map">
          {[20, 40, 60, 80].map((v) => <line key={v} x1={v} x2={v} y1="0" y2="62" stroke="#fff" strokeOpacity=".06" strokeWidth="0.12" />)}
          {[15, 31, 47].map((v) => <line key={v} y1={v} y2={v} x1="0" x2="100" stroke="#fff" strokeOpacity=".06" strokeWidth="0.12" />)}
          {points.filter((p) => !hide.has(p.arch)).map((p) => (
            <Link key={p.slug} href={`/boxers/${p.slug}`}>
              <circle cx={4 + p.x * 92} cy={3 + p.y * 56} r={hover?.slug === p.slug ? 1.7 : 0.8} fill={p.color} fillOpacity={hover && hover.slug !== p.slug ? 0.3 : 0.78}
                onMouseEnter={() => setHover(p)} onMouseLeave={() => setHover(null)} style={{ transition: "r .15s, fill-opacity .15s", cursor: "pointer" }} />
            </Link>
          ))}
        </svg>
        <div className="pointer-events-none absolute left-4 top-4 min-h-14 rounded-xl border border-line bg-bg/85 px-3 py-2 text-sm backdrop-blur" style={{ opacity: hover ? 1 : 0.6 }}>
          {hover ? <><div className="font-display text-lg font-bold leading-tight">{hover.name}</div><div className="text-xs text-muted">{hover.arch} · {hover.wc} · {hover.record}</div></> : <div className="text-xs text-muted">Hover a dot · click to open the profile</div>}
        </div>
      </div>
    </div>
  );
}
