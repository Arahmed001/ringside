"use client";
import { useState } from "react";
import { presetsFor, TERMS, TERM_KEYS, type Features, type TermKey, type Weights } from "@/lib/model";
import { predictFeatures } from "@/lib/predict";
import { ProbBar } from "./charts";

interface Side { name: string; features: Features }

const RED = "#e5322d", BLUE = "#4a8cff";
type Mult = Record<TermKey, number>;
const toMult = (w: Weights, base: Weights): Mult => Object.fromEntries(TERM_KEYS.map((k) => [k, base[k] ? w[k] / base[k] : 0])) as Mult;
const toWeights = (m: Mult, base: Weights): Weights => Object.fromEntries(TERM_KEYS.map((k) => [k, base[k] * m[k]])) as Weights;

function Slider({ label, value, min, max, step, onChange, display, color }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; display: string; color?: string }) {
  return (
    <label className="block">
      <div className="mb-1 flex justify-between text-xs"><span className="text-muted">{label}</span><span className="tabular font-semibold" style={{ color }}>{display}</span></div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="rs w-full"
        style={{ ["--c" as string]: color ?? "#d9b25f", ["--pct" as string]: `${((value - min) / (max - min)) * 100}%` }} />
    </label>
  );
}

/** Interactive tale of the tape: re-weight the model and tweak each fighter's inputs; the odds update live. */
export function MatchupLab({ a, b, defaults, modelNote }: { a: Side; b: Side; defaults: Weights; modelNote?: string }) {
  const presets = presetsFor(defaults);
  const [mult, setMult] = useState<Mult>(toMult(defaults, defaults));
  const [fa, setFa] = useState<Features>(a.features);
  const [fb, setFb] = useState<Features>(b.features);
  const [preset, setPreset] = useState("Balanced");

  const p = predictFeatures(fa, fb, toWeights(mult, defaults));
  const base = predictFeatures(a.features, b.features, defaults);
  const moved = (p.pA - base.pA) * 100;
  const maxShift = Math.max(0.05, ...p.factors.map((f) => Math.abs(f.shift)));
  const dirty = TERM_KEYS.some((k) => Math.abs(mult[k] - 1) > 1e-6) || JSON.stringify(fa) !== JSON.stringify(a.features) || JSON.stringify(fb) !== JSON.stringify(b.features);
  const reset = () => { setMult(toMult(defaults, defaults)); setFa(a.features); setFb(b.features); setPreset("Balanced"); };

  const fighter = (s: Side, f: Features, set: (f: Features) => void, color: string, orig: Features) => (
    <div className="space-y-3">
      <div className="font-display text-lg font-bold" style={{ color }}>{s.name} <span className="text-xs font-normal text-muted">what-if</span></div>
      <Slider label="Rating" value={f.rating} min={Math.round(orig.rating - 200)} max={Math.round(orig.rating + 200)} step={5} onChange={(v) => set({ ...f, rating: v })} display={`${Math.round(f.rating)} Elo`} color={color} />
      <Slider label="Age" value={f.age} min={18} max={46} step={1} onChange={(v) => set({ ...f, age: v })} display={String(f.age)} color={color} />
      <Slider label="Reach" value={f.reachCm} min={Math.round(orig.reachCm - 12)} max={Math.round(orig.reachCm + 12)} step={1} onChange={(v) => set({ ...f, reachCm: v })} display={`${f.reachCm}cm`} color={color} />
      <Slider label="Months since last fight" value={Math.round(f.monthsIdle)} min={0} max={48} step={1} onChange={(v) => set({ ...f, monthsIdle: v })} display={`${Math.round(f.monthsIdle)} mo`} color={color} />
    </div>
  );

  return (
    <section className="card p-5">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div><div className="eyebrow">Interactive tale of the tape</div><h2 className="font-display text-3xl font-bold uppercase">Change the fight</h2></div>
        <button onClick={reset} disabled={!dirty} className="chip cursor-pointer transition enabled:hover:text-ink disabled:opacity-40">↺ Reset</button>
      </div>

      <div className="rounded-2xl bg-panel2 p-5">
        <ProbBar a={a.name} b={b.name} pA={p.pA} pB={p.pB} pDraw={p.pDraw} />
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <span className="chip !border-gold/40 !text-gold">✦ {p.confidence}</span>
          <span className="chip">{Math.round(p.koProb * 100)}% KO/TKO</span>
          {Math.abs(moved) >= 0.5 && <span className="chip" style={{ color: moved > 0 ? RED : BLUE }}>{moved > 0 ? "▲" : "▼"} {Math.abs(moved).toFixed(1)} pts for {a.name.split(" ").slice(-1)[0]} vs default</span>}
        </div>
      </div>

      <div className="mt-6 grid gap-8 lg:grid-cols-3">
        <div className="space-y-3">
          <div className="font-display text-lg font-bold">Model weights</div>
          <div className="flex flex-wrap gap-1.5">
            {presets.map((pr) => (
              <button key={pr.name} title={pr.blurb} onClick={() => { setMult(toMult(pr.weights, defaults)); setPreset(pr.name); }}
                className={`chip cursor-pointer transition ${preset === pr.name ? "!border-gold/60 !text-gold" : "hover:text-ink"}`}>{pr.name}</button>
            ))}
          </div>
          {TERM_KEYS.map((k) => (
            <Slider key={k} label={TERMS[k].label} value={mult[k]} min={0} max={3} step={0.05} onChange={(v) => { setMult({ ...mult, [k]: v }); setPreset(""); }} display={`${mult[k].toFixed(2)}×`} />
          ))}
        </div>
        {fighter(a, fa, setFa, RED, a.features)}
        {fighter(b, fb, setFb, BLUE, b.features)}
      </div>

      <div className="mt-8">
        <div className="mb-3 font-display text-lg font-bold">What’s driving the number</div>
        <ul className="space-y-2.5">
          {p.factors.map((f) => (
            <li key={f.label} className="grid grid-cols-[110px_1fr_70px] items-center gap-3 text-xs sm:grid-cols-[150px_1fr_80px]">
              <span><b className="text-ink">{f.label}</b><span className="block text-muted">{f.note}</span></span>
              <div className="relative h-2.5 rounded-full bg-panel2">
                <span className="absolute left-1/2 top-[-3px] h-4 w-px bg-white/25" />
                <div className="absolute top-0 h-full rounded-full transition-all duration-300" style={{
                  width: `${(Math.abs(f.shift) / maxShift) * 50}%`, background: f.shift >= 0 ? RED : BLUE,
                  ...(f.shift >= 0 ? { right: "50%" } : { left: "50%" }),
                }} />
              </div>
              <span className="tabular text-right" style={{ color: f.shift >= 0 ? RED : BLUE }}>{f.shift >= 0 ? "←" : "→"} {Math.abs(f.shift * 100).toFixed(1)} pts</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[11px] text-muted">Bars extend toward the fighter the factor favours: left for {a.name}, right for {b.name}. {modelNote ?? "Weights are hand-set until real results are available to fit the model."}</p>
      </div>
    </section>
  );
}
