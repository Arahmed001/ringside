"use client";
import { useLocal } from "@/lib/useLocal";
import { useT } from "@/components/i18n";

export interface PickBout { id: number; red: string; blue: string; redId: number; blueId: number; modelPickId: number; modelPct: number; label: string }
const KEY = "ringside:picks";
const EMPTY: Record<number, number> = {};

/** Call it before the bell: pick winners, see how often you side with the model. Stored locally. */
export function PickEm({ bouts }: { bouts: PickBout[] }) {
  const t = useT();
  const [picks, setPicks] = useLocal<Record<number, number>>(KEY, EMPTY);
  const choose = (bout: number, id: number) => setPicks({ ...picks, [bout]: id });
  const made = bouts.filter((b) => picks[b.id]);
  const agree = made.filter((b) => picks[b.id] === b.modelPickId).length;
  return (
    <div className="card p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div><div className="eyebrow">{t("Fight night pick’em")}</div><div className="font-display text-2xl font-bold uppercase">{t("Call the card")}</div></div>
        <div className="text-end text-xs text-muted">
          <div className="font-display text-2xl font-bold text-ink tabular">{made.length}/{bouts.length}</div>
          {made.length > 0 ? t.rich("you side with the model on <b>{n}</b>", { n: agree, b: (c) => <b className="text-gold">{c}</b> }) : t("picks made")}
        </div>
      </div>
      <ul className="space-y-2">
        {bouts.map((b) => (
          <li key={b.id} className="ltr-fixed grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
            {[{ id: b.redId, n: b.red, c: "#e5322d" }, null, { id: b.blueId, n: b.blue, c: "#4a8cff" }].map((s, i) => s === null ? (
              <span key="vs" className="text-xs uppercase tracking-widest text-muted">{b.label}</span>
            ) : (
              <button key={s.id} onClick={() => choose(b.id, s.id)} aria-pressed={picks[b.id] === s.id}
                className="rounded-xl border px-3 py-2 text-start text-sm transition hover:border-white/30"
                style={{ borderColor: picks[b.id] === s.id ? s.c : "var(--line)", background: picks[b.id] === s.id ? s.c + "22" : "var(--panel-2)", textAlign: i === 0 ? "left" : "right" }}>
                <span className="font-semibold">{s.n}</span>
                {b.modelPickId === s.id && <span className="ms-1.5 text-xs text-gold" title={t("Model: {pct}%", { pct: b.modelPct })}>✦ {b.modelPct}%</span>}
              </button>
            ))}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted">{t("✦ marks the model’s pick. Picks are saved in this browser.")}</p>
    </div>
  );
}
