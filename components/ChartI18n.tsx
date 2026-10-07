"use client";
import type { ComponentProps } from "react";
import { useT } from "@/components/i18n";
import { CountUp } from "@/components/CountUp";
import type { Vars } from "@/lib/i18n/t";

/** Translated text for chart pieces that must stay importable from both server and client modules (charts.tsx). Pass k={msg("…")}. */
export function Tx({ k, vars }: { k: string; vars?: Vars }) {
  const t = useT();
  return <>{t(k, vars)}</>;
}

/** An <svg role="img"> whose accessible name is translated. Pass label={msg("…")}. */
export function Svg({ label, descKey, descVars, desc, decorative, ...rest }: Omit<ComponentProps<"svg">, "aria-label"> & { label: string; descKey?: string; descVars?: Vars; desc?: string; decorative?: boolean }) {
  const t = useT();
  if (decorative) return <svg aria-hidden {...rest} />; // the same numbers are in text beside it
  // a chart is a picture of numbers, so the numbers go in its name: "Rating over time. From 1500 to 1710, peak 1730"
  const summary = descKey ? t(descKey, descVars) : desc;
  return <svg role="img" aria-label={summary ? `${t(label)}. ${summary}` : t(label)} {...rest} />;
}

export function HeatCell({ label, round, pct, bg }: { label: string; round: number; pct: number; bg: string }) {
  const t = useT();
  const text = t("{label} · R{round}: {pct}% of finishes", { label, round, pct });
  return <td title={text} className="relative h-5 min-w-5 rounded-[4px]" style={{ background: bg }}><span className="sr-only">{pct}%</span></td>;
}

export function ProbBar({ a, b, pA, pB, pDraw, colorA = "#e5322d", colorB = "#4a8cff" }: { a: string; b: string; pA: number; pB: number; pDraw: number; colorA?: string; colorB?: string }) {
  const t = useT();
  const f = (x: number) => `${Math.round(x * 100)}%`;
  return (
    <div>
      <div className="ltr-fixed mb-1.5 flex items-end justify-between font-display text-2xl font-bold">
        <span style={{ color: colorA }}><CountUp value={Math.round(pA * 100)} suffix="%" /></span>
        <span dir="auto" className="text-xs font-medium text-muted">{t("draw {pct}", { pct: f(pDraw) })}</span>
        <span style={{ color: colorB }}><CountUp value={Math.round(pB * 100)} suffix="%" /></span>
      </div>
      <div className="ltr-fixed flex h-3 overflow-hidden rounded-full bg-panel2" role="img" aria-label={t("{a} {pa}, {b} {pb}", { a, pa: f(pA), b, pb: f(pB) })}>
        <div className="growx transition-[width] duration-300" style={{ width: `${pA * 100}%`, background: colorA }} />
        <div style={{ width: `${pDraw * 100}%`, background: "var(--draw)" }} />
        <div className="growx-end ms-auto transition-[width] duration-300" style={{ width: `${pB * 100}%`, background: colorB }} />
      </div>
      <div className="ltr-fixed mt-1.5 flex justify-between text-xs text-muted"><span dir="auto">{a}</span><span dir="auto">{b}</span></div>
    </div>
  );
}
