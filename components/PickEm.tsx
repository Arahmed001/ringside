"use client";
import { useLocal } from "@/lib/useLocal";

export interface PickBout { id: number; red: string; blue: string; redId: number; blueId: number; modelPickId: number; modelPct: number; label: string }
const KEY = "ringside:picks";
const EMPTY: Record<number, number> = {};

/** Call it before the bell: pick winners, see how often you side with the model. Stored locally. */
export function PickEm({ bouts }: { bouts: PickBout[] }) {
  const [picks, setPicks] = useLocal<Record<number, number>>(KEY, EMPTY);
  const choose = (bout: number, id: number) => setPicks({ ...picks, [bout]: id });
  const made = bouts.filter((b) => picks[b.id]);
  const agree = made.filter((b) => picks[b.id] === b.modelPickId).length;
  return (
    <div className="card p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div><div className="eyebrow">Fight night pick’em</div><div className="font-display text-2xl font-bold uppercase">Call the card</div></div>
        <div className="text-right text-xs text-muted">
          <div className="font-display text-2xl font-bold text-ink tabular">{made.length}/{bouts.length}</div>
          {made.length > 0 ? <>you side with the model on <b className="text-gold">{agree}</b></> : "picks made"}
        </div>
      </div>
      <ul className="space-y-2">
        {bouts.map((b) => (
          <li key={b.id} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            {[{ id: b.redId, n: b.red, c: "#e5322d" }, null, { id: b.blueId, n: b.blue, c: "#4a8cff" }].map((s, i) => s === null ? (
              <span key="vs" className="text-[10px] uppercase tracking-widest text-muted">{b.label}</span>
            ) : (
              <button key={s.id} onClick={() => choose(b.id, s.id)} aria-pressed={picks[b.id] === s.id}
                className="rounded-xl border px-3 py-2 text-left text-sm transition hover:border-white/30"
                style={{ borderColor: picks[b.id] === s.id ? s.c : "var(--line)", background: picks[b.id] === s.id ? s.c + "22" : "var(--panel-2)", textAlign: i === 0 ? "left" : "right" }}>
                <span className="font-semibold">{s.n}</span>
                {b.modelPickId === s.id && <span className="ml-1.5 text-[10px] text-gold" title={`Model: ${b.modelPct}%`}>✦ {b.modelPct}%</span>}
              </button>
            ))}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[11px] text-muted">✦ marks the model’s pick. Picks are saved in this browser.</p>
    </div>
  );
}
