import { createElement, Fragment, type ReactNode } from "react";
import type { Locale } from "./config";

/**
 * Text-as-key translation: the English sentence in the source IS the key, so reading the code still reads like the page
 * and a missing translation falls back to English instead of showing "home.hero.title". Arabic lives in i18n/ar.json.
 *
 *   t("Find a fighter")                         plain text
 *   t("{n} fighters", { n })                    {name} placeholders
 *   t.n(count, "{n} fighter", "{n} fighters")   plurals (the "other" form is the key; Arabic has six forms)
 *   t.rich("Entered rated <b>{r}</b>", { r, b: (c) => <b>{c}</b> })   markup inside a sentence
 *
 * Keys must be string literals so `npm run i18n:extract` can find them.
 */
/** Marks a string that is translated later with t(variable): `extract` finds it, the call site stays dynamic. Returns its argument. */
export const msg = <S extends string>(s: S): S => s;

export type Vars = Record<string, string | number>;
export type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>>;
export type Dict = Record<string, string | PluralForms>;
export type RichVars = Record<string, ReactNode | ((chunks: ReactNode) => ReactNode)>;

export interface T {
  (text: string, vars?: Vars): string;
  n(count: number, one: string, other: string, vars?: Vars): string;
  rich(text: string, vars?: RichVars): ReactNode;
  /** A proper name (fighter, trainer, gym, event, venue, city, nickname) in this language; the English spelling when none is on file. */
  name(en: string): string;
  locale: Locale;
}

/**
 * A record, a score or a date ("23-4-1", "2026-07-04") put into an Arabic sentence is shown backwards ("1-4-23"): after an Arabic letter the digits become Arabic numbers,
 * and the hyphens between them no longer hold them together, so the right-to-left order flips them. Wrapped in a left-to-right isolate it reads as written. Only a value that
 * is all digits and separators is wrapped (a name or a sentence is not), and only for Arabic.
 */
const NUMERIC_RUN = /^[\d\s\-–−/:.,%()+]+$/;
export const isolateNumeric = (v: string, locale: Locale): string => (locale === "ar" && /\d\s?[-–−/:]\s?\d/.test(v) && NUMERIC_RUN.test(v) ? `\u2066${v}\u2069` : v);
const fill = (s: string, vars?: Vars, locale: Locale = "en") => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? isolateNumeric(String(vars[k]), locale) : m)) : s);

export type Names = Record<string, string>;

export function makeT(locale: Locale, dict: Dict = {}, names: Names = {}): T {
  const lookup = (key: string): string => { const v = dict[key]; return typeof v === "string" && v ? v : key; };
  const t = ((text: string, vars?: Vars) => fill(lookup(text), vars, locale)) as T;
  t.locale = locale;
  // a function's own `name` is read-only, hence defineProperty (the API reads best as t.name(...))
  Object.defineProperty(t, "name", { value: (en: string) => names[en] ?? en });
  t.n = (count, one, other, vars) => {
    const v = { n: count.toLocaleString("en-US"), ...vars };
    const entry = dict[other];
    if (entry && typeof entry === "object") {
      const form = entry[new Intl.PluralRules(locale).select(count)] ?? entry.other;
      if (form) return fill(form, v, locale);
    } else if (typeof entry === "string" && entry) return fill(entry, v, locale);
    return fill(count === 1 ? one : other, v, locale);
  };
  t.rich = (text, vars = {}) => {
    const src = lookup(text);
    const out: ReactNode[] = [];
    // <tag>chunks</tag> first (non-nested), then {placeholders} inside plain runs
    const re = /<(\w+)>([\s\S]*?)<\/\1>/g;
    let last = 0, m: RegExpExecArray | null, i = 0;
    const plain = (s: string): ReactNode[] => s.split(/(\{\w+\})/).filter(Boolean).map((p) => {
      const k = p.match(/^\{(\w+)\}$/)?.[1];
      const v = k !== undefined ? vars[k] : undefined;
      return createElement(Fragment, { key: `p${i++}` }, k !== undefined && v !== undefined && typeof v !== "function" ? (typeof v === "string" ? isolateNumeric(v, locale) : v) : p);
    });
    while ((m = re.exec(src))) {
      out.push(...plain(src.slice(last, m.index)));
      const f = vars[m[1]];
      out.push(createElement(Fragment, { key: `t${i++}` }, typeof f === "function" ? f(plain(m[2])) : plain(m[2])));
      last = m.index + m[0].length;
    }
    out.push(...plain(src.slice(last)));
    return out;
  };
  return t;
}

/** Shared English instance for code that has no request (scripts, tests, defaults). */
export const tEn: T = makeT("en");
