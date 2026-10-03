import Link from "@/components/L";
import type { Answer } from "@/lib/ask";
import type { Cell } from "@/lib/ask/types";
import { getT } from "@/lib/i18n/server";

const cell = (c: Cell, key: string) => (typeof c === "string" ? c : c.href ? <Link key={key} href={c.href} className="hover:text-gold">{c.text}</Link> : c.text);

/** The answer, the tables it came from, and how it was worked out. The tables are what makes the answer checkable. */
export async function AskResults({ a }: { a: Answer }) {
  const t = await getT();
  const tables = a.results.flatMap((r) => r.tables);
  return (
    <div className="space-y-6">
      <section className="card p-6" aria-labelledby="answer">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h2 id="answer" className="eyebrow">{t("Answer")}</h2>
          <span className={`chip ${a.source === "ai" ? "!border-gold/40 !text-gold" : ""}`}>{a.source === "ai" ? t("Written by AI from the results below") : t("Put together by rules from the results below")}</span>
        </div>
        {a.understood ? <p className="text-lg leading-relaxed" dir="auto">{a.answer}</p> : (
          <p className="text-muted">{t("I could not match that question to anything in the data. Try one of the examples, or ask about fighters, fights, titles, records, upcoming cards or fight money.")}</p>
        )}
        {a.limited && <p className="mt-3 text-sm text-muted">{a.limited === "budget" ? t("The AI budget for today is used up, so this answer comes from rules instead.") : t("You have asked a lot in a short time, so this answer comes from rules instead of AI.")}</p>}
      </section>
      {tables.map((tb) => (
        <section key={tb.id} className="card p-5" aria-labelledby={`t-${tb.id}`}>
          <h3 id={`t-${tb.id}`} className="mb-3 font-display text-2xl font-bold uppercase leading-none">{tb.title}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" aria-labelledby={`t-${tb.id}`}>
              <thead><tr className="text-start text-xs uppercase tracking-widest text-muted">{tb.columns.map((c, i) => c ? <th key={i} scope="col" className="py-2 pe-3 text-start font-normal">{c}</th> : <td key={i} />)}</tr></thead>
              <tbody>{tb.rows.map((r, i) => (
                <tr key={i} className="border-t border-line/60 tabular">{r.map((c, j) => j === 0 && tb.columns[0] === "#" ? <td key={j} className="py-2 pe-3 text-muted">{cell(c, `${i}-${j}`)}</td> : <td key={j} className="py-2 pe-3">{cell(c, `${i}-${j}`)}</td>)}</tr>
              ))}</tbody>
            </table>
          </div>
          {tb.note && <p className="mt-2 text-xs text-muted">{tb.note}</p>}
        </section>
      ))}
      <details className="card p-5 text-sm">
        <summary className="cursor-pointer py-1.5 font-semibold">{t("How this was answered")}</summary>
        <p className="mt-3 text-muted">{a.planner === "ai" ? t("An AI model chose which of our fixed, read-only queries to run. It cannot run anything else, and every number comes from the queries below, not from the model.") : t("Patterns in the question chose which of our fixed, read-only queries to run. Every number comes from the queries below.")}</p>
        <ul className="mt-3 space-y-1 font-mono text-xs" dir="ltr">{a.calls.map((c, i) => <li key={i}>{c.tool}({Object.entries(c.args).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(", ")})</li>)}</ul>
      </details>
    </div>
  );
}
