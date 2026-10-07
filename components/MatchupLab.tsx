"use client";
import { useState } from "react";
import { presetsFor, TERMS, TERM_KEYS, type Features, type FinishModel, type TermKey, type Weights } from "@/lib/model";
import { predictFeatures } from "@/lib/predict";
import { ProbBar } from "./charts";
import { useT } from "./i18n";
import { msg } from "@/lib/i18n/t";

interface Side { name: string; features: Features }

const RED = "#ff5a54", BLUE = "#4a8cff";
const PRESET_NAME: Record<string, string> = { Balanced: msg("Balanced"), "Pure Elo": msg("Pure Elo"), "Old school": msg("Old school"), "Father Time": msg("Father Time") };
const PRESET_BLURB: Record<string, string> = {
  Balanced: msg("Elo plus small physical and form edges"), "Pure Elo": msg("Results only: ignore everything else"),
  "Old school": msg("Reach, power and chin decide fights"), "Father Time": msg("Age and layoffs hurt more"),
};
type Mult = Record<TermKey, number>;
const toMult = (w: Weights, base: Weights): Mult => Object.fromEntries(TERM_KEYS.map((k) => [k, base[k] ? w[k] / base[k] : 0])) as Mult;
const toWeights = (m: Mult, base: Weights): Weights => Object.fromEntries(TERM_KEYS.map((k) => [k, base[k] * m[k]])) as Weights;

function Slider({ label, value, min, max, step, onChange, display, color }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; display: string; color?: string }) {
  return (
    <label className="block">
      <div className="mb-1 flex justify-between text-xs"><span className="text-muted">{label}</span><span className="tabular font-semibold" style={{ color }}>{display}</span></div>
      <input type="range" min={min} max={max} step={step} value={value} aria-valuetext={display} onChange={(e) => onChange(Number(e.target.value))} className="rs w-full"
        style={{ ["--c" as string]: color ?? "#d9b25f", ["--pct" as string]: `${((value - min) / (max - min)) * 100}%` }} />
    </label>
  );
}

/** Interactive tale of the tape: re-weight the model and tweak each fighter's inputs; the odds update live. */
export function MatchupLab({ a, b, defaults, modelNote, finish = null }: { a: Side; b: Side; defaults: Weights; modelNote?: string; finish?: FinishModel | null }) {
  const t = useT();
  const presets = presetsFor(defaults);
  const [mult, setMult] = useState<Mult>(toMult(defaults, defaults));
  const [fa, setFa] = useState<Features>(a.features);
  const [fb, setFb] = useState<Features>(b.features);
  const [preset, setPreset] = useState("Balanced");

  const p = predictFeatures(fa, fb, toWeights(mult, defaults), t, finish);
  const base = predictFeatures(a.features, b.features, defaults, t, finish);
  const moved = (p.pA - base.pA) * 100;
  const maxShift = Math.max(0.05, ...p.factors.map((f) => Math.abs(f.shift)));
  const dirty = TERM_KEYS.some((k) => Math.abs(mult[k] - 1) > 1e-6) || JSON.stringify(fa) !== JSON.stringify(a.features) || JSON.stringify(fb) !== JSON.stringify(b.features);
  const reset = () => { setMult(toMult(defaults, defaults)); setFa(a.features); setFb(b.features); setPreset("Balanced"); };

  const fighter = (s: Side, f: Features, set: (f: Features) => void, color: string, orig: Features) => (
    <div className="space-y-3">
      <div className="font-display text-lg font-bold uppercase" style={{ color }}>{s.name} <span className="text-xs font-normal normal-case text-muted">{t("what-if")}</span></div>
      <Slider label={t("Rating")} value={f.rating} min={Math.round(orig.rating - 200)} max={Math.round(orig.rating + 200)} step={5} onChange={(v) => set({ ...f, rating: v })} display={t("{n} Elo", { n: Math.round(f.rating) })} color={color} />
      {f.age === null ? <Unknown label={t("Age")} note={t("Unknown: not counted")} /> : <Slider label={t("Age")} value={f.age} min={18} max={46} step={1} onChange={(v) => set({ ...f, age: v })} display={String(f.age)} color={color} />}
      {f.reachCm === null || orig.reachCm === null ? <Unknown label={t("Reach")} note={t("Unknown: not counted")} /> : <Slider label={t("Reach")} value={f.reachCm} min={Math.round(orig.reachCm - 12)} max={Math.round(orig.reachCm + 12)} step={1} onChange={(v) => set({ ...f, reachCm: v })} display={t("{n} cm", { n: f.reachCm })} color={color} />}
      <Slider label={t("Months since last fight")} value={Math.round(f.monthsIdle)} min={0} max={48} step={1} onChange={(v) => set({ ...f, monthsIdle: v })} display={t("{n} mo", { n: Math.round(f.monthsIdle) })} color={color} />
    </div>
  );

  return (
    <section className="card p-5">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div><div className="eyebrow">{t("Interactive tale of the tape")}</div><h2 className="font-display text-3xl font-bold uppercase">{t("Change the fight")}</h2></div>
        <button onClick={reset} disabled={!dirty} className="chip cursor-pointer transition enabled:hover:text-ink disabled:opacity-40"><span className="inline-block rtl:-scale-x-100">↺</span> {t("Reset")}</button>
      </div>

      <div className="rounded-2xl bg-panel2 p-5">
        <ProbBar a={a.name} b={b.name} pA={p.pA} pB={p.pB} pDraw={p.pDraw} />
        {/* the bar is a picture; this is what a screen reader hears each time a slider or preset changes the odds */}
        <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">{t("{a} {pa}, {b} {pb}", { a: a.name, pa: `${Math.round(p.pA * 100)}%`, b: b.name, pb: `${Math.round(p.pB * 100)}%` })}</p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <span className="chip !border-gold/40 !text-gold">✦ {t(p.confidence)}</span>
          <span className="chip">{t("{n}% KO/TKO", { n: Math.round(p.koProb * 100) })}</span>
          {Math.abs(moved) >= 0.5 && <span className="chip" style={{ color: moved > 0 ? RED : BLUE }}>{moved > 0 ? "▲" : "▼"} {t("{n} pts for {name} vs default", { n: Math.abs(moved).toFixed(1), name: a.name.split(" ").slice(-1)[0] })}</span>}
        </div>
      </div>

      <div className="mt-6 grid gap-8 lg:grid-cols-3">
        <div className="space-y-3">
          <div className="font-display text-lg font-bold uppercase">{t("Model weights")}</div>
          <div className="flex flex-wrap gap-1.5">
            {presets.map((pr) => (
              <button key={pr.name} title={t(PRESET_BLURB[pr.name] ?? pr.blurb)} onClick={() => { setMult(toMult(pr.weights, defaults)); setPreset(pr.name); }}
                className={`chip cursor-pointer transition ${preset === pr.name ? "!border-gold/60 !text-gold" : "hover:text-ink"}`}>{t(PRESET_NAME[pr.name] ?? pr.name)}</button>
            ))}
          </div>
          {TERM_KEYS.map((k) => (
            <Slider key={k} label={t(TERMS[k].label)} value={mult[k]} min={0} max={3} step={0.05} onChange={(v) => { setMult({ ...mult, [k]: v }); setPreset(""); }} display={`${mult[k].toFixed(2)}×`} />
          ))}
        </div>
        {fighter(a, fa, setFa, RED, a.features)}
        {fighter(b, fb, setFb, BLUE, b.features)}
      </div>

      <div className="mt-8">
        <div className="mb-3 font-display text-lg font-bold uppercase">{t("What’s driving the number")}</div>
        <ul className="space-y-2.5">
          {p.factors.map((f) => (
            <li key={f.label} className="grid grid-cols-[110px_1fr_70px] items-center gap-3 text-xs sm:grid-cols-[150px_1fr_80px]">
              <span><b className="text-ink">{t(f.label)}</b><span className="block text-muted">{f.note}</span></span>
              <div className="ltr-fixed relative h-2.5 rounded-full bg-panel2">
                <span className="absolute left-1/2 top-[-3px] h-4 w-px bg-white/25" />
                <div className="absolute top-0 h-full rounded-full transition-all duration-300" style={{
                  width: `${(Math.abs(f.shift) / maxShift) * 50}%`, background: f.shift >= 0 ? RED : BLUE,
                  ...(f.shift >= 0 ? { right: "50%" } : { left: "50%" }),
                }} />
              </div>
              <span className="tabular text-end" style={{ color: f.shift >= 0 ? RED : BLUE }}><span className="ltr-fixed inline-block">{f.shift >= 0 ? "←" : "→"}</span> {t("{n} pts", { n: Math.abs(f.shift * 100).toFixed(1) })}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted">{t("Bars extend toward the fighter the factor favours: left for {a}, right for {b}.", { a: a.name, b: b.name })} {modelNote ?? t("Weights are hand-set until real results are available to fit the model.")}</p>
      </div>
    </section>
  );
}

/** A fact the data does not have: said so, and not a slider, because there is nothing to move. */
function Unknown({ label, note }: { label: string; note: string }) {
  return <div className="flex items-baseline justify-between text-sm"><span className="text-muted">{label}</span><span className="text-muted">{note}</span></div>;
}
