"use client";
import { useState } from "react";
import { usePicks } from "@/lib/usePicks";
import { explain } from "@/lib/account-text";
import { useT } from "@/components/i18n";
import Link from "@/components/L";

export interface PickBout { id: number; red: string; blue: string; redId: number; blueId: number; modelPickId: number; modelPct: number; label: string }

/** Call it before the bell: pick winners, see how often you side with the model. Saved on your account when signed in, in this browser otherwise. */
export function PickEm({ bouts }: { bouts: PickBout[] }) {
  const t = useT();
  const { picks, choose: save, mode } = usePicks();
  const [problem, setProblem] = useState("");
  const choose = async (bout: number, id: number) => { setProblem(""); const e = await save(bout, id); if (e) setProblem(explain(t, e)); };
  const made = bouts.filter((b) => picks[b.id]);
  const agree = made.filter((b) => picks[b.id] === b.modelPickId).length;
  return (
    <div id="pick-em" className="card @container scroll-mt-20 p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div><div className="eyebrow">{t("Fight night pick’em")}</div><div className="font-display text-2xl font-bold uppercase">{t("Call the card")}</div></div>
        <div className="text-end text-xs text-muted">
          <div className="font-display text-2xl font-bold text-ink tabular">{made.length}/{bouts.length}</div>
          {made.length > 0 ? t.rich("you side with the model on <b>{n}</b>", { n: agree, b: (c) => <b className="text-gold">{c}</b> }) : t("picks made")}
        </div>
      </div>
      <ul className="grid gap-x-8 gap-y-3 @[40rem]:grid-cols-2">
        {bouts.map((b) => (
          <li key={b.id} className="@container min-w-0"><div className="ltr-fixed grid grid-cols-1 items-stretch gap-x-2 gap-y-1 @[17rem]:grid-cols-2">
            {[{ id: b.redId, n: b.red, c: "#e5322d" }, null, { id: b.blueId, n: b.blue, c: "#4a8cff" }].map((s, i) => s === null ? (
              <span key="vs" className="order-first text-center @[17rem]:col-span-2 text-xs uppercase tracking-widest text-muted">{b.label}</span>
            ) : (
              <button key={s.id} onClick={() => void choose(b.id, s.id)} aria-pressed={picks[b.id] === s.id}
                className="min-h-11 w-full min-w-0 rounded-xl border px-3 py-2 text-start text-sm transition hover:border-white/30"
                style={{ borderColor: picks[b.id] === s.id ? s.c : "var(--line)", background: picks[b.id] === s.id ? s.c + "22" : "var(--panel-2)", textAlign: i === 0 ? "left" : "right" }}>
                <span className="font-semibold">{s.n}</span>
                {b.modelPickId === s.id && <span className="block text-xs text-gold" title={t("Model: {pct}%", { pct: b.modelPct })}>✦ {b.modelPct}%</span>}
              </button>
            ))}
          </div></li>
        ))}
      </ul>
      <p role="status" aria-live="polite" className="mt-2 text-xs text-red-ink">{problem}</p>
      <p className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span>{mode === "account" ? t("✦ marks the model’s pick. Saved to your account; picks lock when fight day begins.") : t("✦ marks the model’s pick. Picks are saved in this browser.")}</span>
        <span className="flex gap-3">
          {mode === "local" && <Link href="/account" className="inline-block py-1 text-ink underline decoration-dotted hover:text-gold">{t("Sign in to keep them")}</Link>}
          <Link href="/picks" className="inline-block py-1 text-ink underline decoration-dotted hover:text-gold">{t("See how your picks did")}</Link>
        </span>
      </p>
    </div>
  );
}
