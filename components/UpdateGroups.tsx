"use client";
import { useCallback, useEffect, useState } from "react";
import { useT } from "@/components/i18n";
import { api } from "@/lib/useAccount";
import { explain } from "@/lib/account-text";
import type { GroupView } from "@/lib/watch/groups";
import type { Rule } from "@/lib/watch/rules";

type T = ReturnType<typeof useT>;
interface Loaded { groups: GroupView[]; rules: Rule[] }

/** The table words of a field such as `boxers.height_cm`, in the reader's language; the column stays as the data calls it. */
export function fieldTitle(t: T, kind: string, field: string): string {
  if (kind === "result_change") return t("Results");
  if (kind === "result_set") return t("Results found in fighters' Wikipedia records");
  if (kind === "list_change") return t("Official ranking lists");
  if (kind === "reign_added") return t("New title reigns");
  if (kind === "reign_removed") return t("Title reigns no longer on the page");
  if (kind === "reign_changed") return t("Changed title reigns");
  const [table, column] = field.split(".");
  const word = table === "boxers" ? t("Fighters") : table === "events" ? t("Cards") : table === "bouts" ? t("Fights") : table === "orgs" ? t("Organisations") : table === "people" ? t("People") : table;
  return `${word}: ${column ?? field}`;
}
const show = (v: unknown) => (v === null || v === undefined || v === "" ? "–" : typeof v === "object" ? JSON.stringify(v).slice(0, 80) : String(v));
const conditionText = (t: T, c: string, amount: number | null) => c === "any" ? t("any change") : c === "fills" ? t("a blank being filled") : t("a change of at most {n}", { n: amount ?? 0 });

/**
 * The waiting changes by group (for administrators): how many, how big, ten samples, and one decision for the whole group. The count the page shows is sent back with the
 * decision, so a change that arrived after the page loaded is never approved unseen. Also the baseline action and the standing rules.
 */
export function UpdateGroups({ onFocus, onChanged, setMsg, busy, setBusy }: { onFocus: (g: GroupView) => void; onChanged: () => void; setMsg: (m: string) => void; busy: boolean; setBusy: (b: boolean) => void }) {
  const t = useT();
  const [data, setData] = useState<Loaded | null>(null);
  const load = useCallback(() => { void api<Loaded>("/api/review/updates/groups?status=pending", "GET").then((r) => { if (r.ok) setData(r.data); else setMsg(explain(t, r.data.error)); }); }, [t, setMsg]);
  useEffect(() => { load(); }, [load]);

  async function decide(body: Record<string, unknown>, done: string) {
    setBusy(true); setMsg("");
    const r = await api<{ approved: number; rejected: number; failed: Record<string, number> }>("/api/review/updates/groups", "POST", body);
    setBusy(false);
    if (!r.ok) { setMsg(explain(t, r.data.error)); load(); return; }
    const failed = Object.entries(r.data.failed ?? {});
    setMsg(failed.length ? `${t("Done for {done} of {all}.", { done: (r.data.approved ?? 0) + (r.data.rejected ?? 0), all: (r.data.approved ?? 0) + (r.data.rejected ?? 0) + failed.reduce((n, [, c]) => n + c, 0) })} ${failed.map(([e]) => explain(t, e)).join(" ")}` : done);
    load(); onChanged();
  }

  if (data === null) return <p className="text-sm text-muted">{t("Loading…")}</p>;
  const vendorTotal = data.groups.filter((g) => g.source.startsWith("vendor:")).reduce((n, g) => n + g.count, 0);
  return (
    <div className="space-y-8">
      {vendorTotal > 0 && <Baseline total={vendorTotal} busy={busy} decide={(note) => decide({ action: "baseline", note, expectCount: vendorTotal }, t("Accepted. What the vendor’s feed said is now what the site shows."))} />}
      {data.groups.length === 0 ? <p className="text-sm text-muted">{t("Nothing is waiting.")}</p> : (
        <ul className="space-y-4">{data.groups.map((g) => <GroupCard key={g.key} g={g} busy={busy} onFocus={() => onFocus(g)} decide={(decision, note) => decide({ action: "decide", source: g.source, kind: g.kind, field: g.field, decision, note, expectCount: g.count }, decision === "approved" ? t("Approved.") : t("Not accepted. It will not be raised again unless the source says something different."))} reload={load} setMsg={setMsg} />)}</ul>
      )}
      <Rules rules={data.rules} reload={load} setMsg={setMsg} />
    </div>
  );
}

function Baseline({ total, busy, decide }: { total: number; busy: boolean; decide: (note: string) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  return (
    <div className="card space-y-3 p-5 text-sm">
      <h2 className="font-display text-xl font-bold">{t("Accept the present state of the vendor’s feed")}</h2>
      <p className="text-muted">{t("The first nights of holding leave a pile of changes that are not news. Look at the groups below, then accept all {n} waiting at once, in one logged step. What arrives afterwards is the real news.", { n: total })}</p>
      {open ? (
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[14rem] flex-1">
            <label htmlFor="bl-note" className="mb-1 block text-xs uppercase tracking-widest text-muted">{t("Why (logged)")}</label>
            <input id="bl-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className="w-full rounded-xl border border-line bg-panel2 px-3 py-2 outline-none focus:border-gold/60" />
          </div>
          <button className="rounded-xl bg-red-btn px-4 py-2 font-bold text-white hover:brightness-90 disabled:opacity-60" disabled={busy || !note.trim()} onClick={() => { setOpen(false); decide(note); }}>{t("Yes, accept all {n}", { n: total })}</button>
          <button className="rounded-xl border border-line bg-panel2 px-4 py-2 hover:border-white/30" onClick={() => setOpen(false)}>{t("Cancel")}</button>
        </div>
      ) : <button className="rounded-xl border border-line bg-panel2 px-4 py-2 hover:border-white/30 disabled:opacity-60" disabled={busy} onClick={() => setOpen(true)}>{t("Accept everything waiting ({n})", { n: total })}</button>}
    </div>
  );
}

function GroupCard({ g, busy, onFocus, decide, reload, setMsg }: { g: GroupView; busy: boolean; onFocus: () => void; decide: (d: "approved" | "rejected", note: string) => void; reload: () => void; setMsg: (m: string) => void }) {
  const t = useT();
  const [ask, setAsk] = useState<"approve" | "reject" | null>(null);
  const [note, setNote] = useState("");
  const [rule, setRule] = useState(false);
  const [cond, setCond] = useState<"any" | "fills" | "max_delta">("any");
  const [amount, setAmount] = useState("");
  const btn = "rounded-xl border border-line bg-panel2 px-4 py-2 transition hover:border-white/30 disabled:opacity-60";
  const title = fieldTitle(t, g.kind, g.field);
  const vendor = g.source.startsWith("vendor:");
  const canRule = vendor && g.kind !== "reign_added";
  async function saveRule() {
    const field = g.field;
    const r = await api("/api/review/updates/rules", "POST", { field, condition: cond, ...(cond === "max_delta" ? { amount: Number(amount) } : {}) });
    if (!r.ok) { setMsg(explain(t, r.data.error)); return; }
    setMsg(t("The rule is saved. It applies from the next update.")); setRule(false); reload();
  }
  return (
    <li className="card space-y-3 p-5 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-bold">{title} <span className="text-muted">({g.count})</span></h2>
          <p className="text-xs text-muted">
            {g.kind === "field_change" && <>{t("{a} filled, {b} replaced, {c} cleared", { a: g.fills, b: g.replaces, c: g.clears })}{g.medianDelta !== undefined ? ` · ${t("median change {a}, largest {b}", { a: g.medianDelta, b: g.maxDelta ?? 0 })}` : ""} · </>}
            {t("Oldest waiting since {date}", { date: g.oldestSeen.slice(0, 10) })}
          </p>
        </div>
      </div>
      <table className="w-full text-start">
        <caption className="sr-only">{title}</caption>
        <thead><tr className="text-xs uppercase tracking-widest text-muted"><th scope="col" className="py-1 pe-3 text-start font-normal">{t("Detail")}</th><th scope="col" className="py-1 pe-3 text-start font-normal">{t("Held now")}</th><th scope="col" className="py-1 text-start font-normal">{t("Source says")}</th></tr></thead>
        <tbody>{g.samples.map((s) => <tr key={s.id} className="border-t border-line"><th scope="row" className="py-1 pe-3 text-start font-normal text-muted [overflow-wrap:anywhere]">{s.label.split(": ")[0]}</th><td className="py-1 pe-3 [overflow-wrap:anywhere]">{g.kind === "field_change" ? show(s.old) : g.kind === "result_change" ? show((s.old as Record<string, unknown> | null)?.method ?? "") : "…"}</td><td className="py-1 font-semibold [overflow-wrap:anywhere]">{g.kind === "field_change" ? show(s.new) : g.kind === "result_change" ? show((s.new as Record<string, unknown> | null)?.method ?? "") : "…"}</td></tr>)}</tbody>
      </table>
      {g.count > g.samples.length && <p className="text-xs text-muted">{t("Showing {n} of {all}.", { n: g.samples.length, all: g.count })}</p>}
      <div className="flex flex-wrap items-end gap-3 border-t border-line pt-3">
        {ask === "approve" ? (
          <><span>{t("Approve {n} changes?", { n: g.count })}</span><button className="rounded-xl bg-red-btn px-4 py-2 font-bold text-white hover:brightness-90 disabled:opacity-60" disabled={busy} onClick={() => { setAsk(null); decide("approved", ""); }}>{t("Yes, approve")}</button><button className={btn} onClick={() => setAsk(null)}>{t("Cancel")}</button></>
        ) : ask === "reject" ? (
          <>
            <div className="min-w-[14rem] flex-1"><label htmlFor={`gn-${g.key}`} className="mb-1 block text-xs uppercase tracking-widest text-muted">{t("Note (needed to reject)")}</label><input id={`gn-${g.key}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className="w-full rounded-xl border border-line bg-panel2 px-3 py-2 outline-none focus:border-gold/60" /></div>
            <button className={`${btn} hover:!border-red/60`} disabled={busy || !note.trim()} onClick={() => { setAsk(null); decide("rejected", note); }}>{t("Yes, reject {n}", { n: g.count })}</button><button className={btn} onClick={() => setAsk(null)}>{t("Cancel")}</button>
          </>
        ) : (
          <>
            <button className="rounded-xl bg-red-btn px-4 py-2 font-bold text-white hover:brightness-90 disabled:opacity-60" disabled={busy} onClick={() => setAsk("approve")}>{t("Approve all {n}", { n: g.count })}</button>
            <button className={`${btn} hover:!border-red/60`} disabled={busy} onClick={() => setAsk("reject")}>{t("Reject all {n}", { n: g.count })}</button>
            <button className={btn} disabled={busy} onClick={onFocus}>{t("Review one by one")}</button>
            {canRule && <button className={btn} disabled={busy} onClick={() => setRule(!rule)} aria-expanded={rule}>{t("Always accept changes like this")}</button>}
          </>
        )}
      </div>
      {rule && (
        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-line p-3">
          <div><label htmlFor={`rc-${g.key}`} className="mb-1 block text-xs uppercase tracking-widest text-muted">{t("Accept")}</label>
            <select id={`rc-${g.key}`} value={cond} onChange={(e) => setCond(e.target.value as typeof cond)} className="rounded-xl border border-line bg-panel2 px-3 py-2">
              <option value="any">{t("any change")}</option>
              {g.kind === "field_change" && <option value="fills">{t("a blank being filled")}</option>}
              {g.numeric && <option value="max_delta">{t("a change of at most…")}</option>}
            </select></div>
          {cond === "max_delta" && <div><label htmlFor={`ra-${g.key}`} className="mb-1 block text-xs uppercase tracking-widest text-muted">{t("At most")}</label><input id={`ra-${g.key}`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-24 rounded-xl border border-line bg-panel2 px-3 py-2" /></div>}
          <button className={btn} disabled={cond === "max_delta" && amount.trim() === ""} onClick={() => void saveRule()}>{t("Save the rule")}</button>
        </div>
      )}
    </li>
  );
}

function Rules({ rules, reload, setMsg }: { rules: Rule[]; reload: () => void; setMsg: (m: string) => void }) {
  const t = useT();
  async function remove(id: number) {
    const r = await api(`/api/review/updates/rules?id=${id}`, "DELETE");
    if (!r.ok) { setMsg(explain(t, r.data.error)); return; }
    setMsg(t("The rule is removed.")); reload();
  }
  return (
    <section aria-labelledby="rules-h" className="space-y-3">
      <h2 id="rules-h" className="font-display text-2xl font-bold">{t("Standing rules")}</h2>
      <p className="text-sm text-muted">{t("A change a rule accepts needs no approval. A rule applies from the next update and every use is logged. A rule cannot hide a changed format: the flood guard looks at the whole night first.")}</p>
      {rules.length === 0 ? <p className="text-sm text-muted">{t("No standing rules yet.")}</p> : (
        <ul className="space-y-2">{rules.map((r) => (
          <li key={r.id} className="card flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
            <div><span className="font-semibold">{fieldTitle(t, r.field === "result" ? "result_change" : r.field === "lists" ? "list_change" : "field_change", r.field)}</span>: {conditionText(t, r.condition, r.amount)}
              <div className="text-xs text-muted">{r.usedCount ? t("Used {n} times, last {date}", { n: r.usedCount, date: (r.lastUsed ?? "").slice(0, 10) }) : t("Not used yet")}{r.createdBy ? ` · ${t("made by {name}", { name: r.createdBy })}` : ""}</div></div>
            <button className="rounded-xl border border-line bg-panel2 px-4 py-2 hover:!border-red/60" onClick={() => void remove(r.id)}>{t("Remove")}</button>
          </li>))}</ul>
      )}
    </section>
  );
}
