"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "@/components/L";
import { useT } from "@/components/i18n";
import { api, useAccount } from "@/lib/useAccount";
import { explain } from "@/lib/account-text";
import type { ProposalRow } from "@/lib/watch/proposals";
import { groupOf } from "@/lib/watch/group-key";
import { UpdateGroups, fieldTitle } from "@/components/UpdateGroups";
import type { GroupView } from "@/lib/watch/groups";

type Status = "pending" | "approved" | "rejected" | "superseded";
interface SourceInfo { id: string; label: string; kind: string; terms: string }
interface Loaded { key: string; items: ProposalRow[]; counts: Record<string, number>; sources: SourceInfo[]; max: number }

/**
 * Administrators' queue for changes that public sources seem to have made to data we hold. Nothing here is applied until an administrator approves it; approving writes
 * the change to the live data at once. A change that no longer fits what is held is refused and stays here until the next check replaces it.
 */
export function UpdateQueue() {
  const t = useT();
  const me = useAccount();
  const [status, setStatus] = useState<Status>("pending");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"groups" | "list">("groups");
  const [focus, setFocus] = useState<GroupView | null>(null);
  const isAdmin = me?.role === "admin";
  const key = status;
  const data = loaded?.key === key ? loaded : null;

  const load = useCallback((st: Status) => {
    void api<{ items: ProposalRow[]; counts: Record<string, number>; sources: SourceInfo[]; max: number }>(`/api/review/updates?status=${st}`, "GET").then((r) => {
      if (r.ok) setLoaded({ key: st, ...r.data }); else { setLoaded({ key: st, items: [], counts: {}, sources: [], max: 50 }); setMsg(explain(t, r.data.error)); }
    });
  }, [t]);
  useEffect(() => { if (isAdmin) load(status); }, [isAdmin, status, load]);

  if (me === undefined) return <p className="text-sm text-muted">{t("Loading…")}</p>;
  if (!me || !isAdmin) return <div className="card p-6"><p className="text-muted">{me ? t("Only administrators can decide on source updates.") : t("Sign in as an administrator to decide on source updates.")}</p>{!me && <p className="mt-3"><Link href="/account" className="underline decoration-dotted hover:text-ink">{t("Sign in")}</Link></p>}</div>;

  async function decide(ids: number[], decision: "approved" | "rejected", note: string, done: string) {
    setBusy(true); setMsg("");
    const r = await api<{ approved: number; rejected: number; results: { id: number; ok: boolean; error?: string }[] }>("/api/review/updates", "POST", { ids, decision, note });
    setBusy(false);
    if (!r.ok) { setMsg(explain(t, r.data.error)); return; }
    const failed = (r.data.results ?? []).filter((x) => !x.ok);
    setMsg(failed.length ? `${t("Done for {done} of {all}.", { done: ids.length - failed.length, all: ids.length })} ${[...new Set(failed.map((f) => explain(t, f.error)))].join(" ")}` : done);
    load(status);
  }

  const tabs: [Status, string][] = [["pending", t("Waiting")], ["approved", t("Approved")], ["rejected", t("Not accepted")], ["superseded", t("No longer true")]];
  const allItems = data?.items ?? [];
  const items = focus ? allItems.filter((i) => `${i.source}|${i.kind}|${groupOf(i.kind, i.targetKey)}` === focus.key) : allItems;
  const groups = [...new Set(items.map((i) => `${i.source}|${i.kind}`))].map((g) => ({ g, rows: items.filter((i) => `${i.source}|${i.kind}` === g) }));
  return (
    <div className="space-y-5">
      <div role="group" aria-label={t("Show")} className="flex flex-wrap gap-2 text-sm">
        {tabs.map(([k, text]) => <button key={k} aria-pressed={status === k} onClick={() => { setStatus(k); setMsg(""); setFocus(null); }} className={`rounded-full border px-3 py-1 ${status === k ? "border-gold/60 bg-gold/10 text-ink" : "border-line text-muted hover:text-ink"}`}>{text}{data ? ` (${data.counts[k] ?? 0})` : ""}</button>)}
      </div>
      <p role="status" aria-live="polite" className="min-h-5 text-sm text-muted">{msg}</p>
      {status === "pending" && (
        <div role="group" aria-label={t("View")} className="flex flex-wrap items-center gap-2 text-xs">
          <button aria-pressed={mode === "groups" && !focus} onClick={() => { setMode("groups"); setFocus(null); }} className={`rounded-full border px-2.5 py-0.5 ${mode === "groups" && !focus ? "border-gold/60 bg-gold/10 text-ink" : "border-line text-muted hover:text-ink"}`}>{t("By group")}</button>
          <button aria-pressed={mode === "list" || !!focus} onClick={() => { setMode("list"); setFocus(null); }} className={`rounded-full border px-2.5 py-0.5 ${mode === "list" || focus ? "border-gold/60 bg-gold/10 text-ink" : "border-line text-muted hover:text-ink"}`}>{t("One by one")}</button>
          {focus && <span className="text-muted">{fieldTitle(t, focus.kind, focus.field)} · <button className="underline decoration-dotted hover:text-ink" onClick={() => { setFocus(null); setMode("groups"); }}>{t("Back to the groups")}</button></span>}
        </div>
      )}
      {status === "pending" && mode === "groups" && !focus ? (
        <UpdateGroups onFocus={(g) => { setFocus(g); setMode("list"); }} onChanged={() => load(status)} setMsg={setMsg} busy={busy} setBusy={setBusy} />
      ) : data === null ? <p className="text-sm text-muted">{t("Loading…")}</p> : items.length === 0 ? <p className="text-sm text-muted">{status === "pending" ? t("Nothing is waiting.") : t("Nothing here yet.")}</p> : (
        <div className="space-y-8">
          {groups.map(({ g, rows }) => {
            const src = data.sources.find((s) => s.id === rows[0].source);
            return <Group key={g} rows={rows} source={src} max={data.max} pending={status === "pending"} busy={busy} decide={decide} />;
          })}
        </div>
      )}
    </div>
  );
}

const kindTitle = (t: ReturnType<typeof useT>, kind: string) => kind === "field_change" ? t("Changes to details we hold") : kind === "result_change" ? t("Results") : kind === "result_set" ? t("Wikipedia results the vendor's outcome agrees with") : kind === "result_set_alone" ? t("Wikipedia results with no vendor outcome to compare") : kind === "result_set_conflict" ? t("Wikipedia results the vendor's outcome contradicts") : kind === "team_added" ? t("Trainers, managers, gyms and promoters named in Wikipedia articles") : kind === "list_change" ? t("Official ranking lists") : kind === "reign_added" ? t("New title reigns") : kind === "reign_removed" ? t("Title reigns no longer on the page") : kind === "reign_changed" ? t("Changed title reigns") : kind;

function Group({ rows, source, max, pending, busy, decide }: { rows: ProposalRow[]; source?: SourceInfo; max: number; pending: boolean; busy: boolean; decide: (ids: number[], d: "approved" | "rejected", note: string, done: string) => void }) {
  const t = useT();
  const [confirm, setConfirm] = useState(false);
  const shown = rows.slice(0, max);
  return (
    <section aria-labelledby={`g-${rows[0].id}`} className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id={`g-${rows[0].id}`} className="font-display text-2xl font-bold">{kindTitle(t, rows[0].kind)} <span className="text-muted">({rows.length})</span></h2>
          {source && <p className="text-xs text-muted">{source.label} · {source.terms}</p>}
        </div>
        {pending && rows.length > 1 && (confirm ? (
          <div className="flex items-center gap-2 text-sm">
            <span>{t("Approve {n} changes?", { n: shown.length })}</span>
            <button className="rounded-xl bg-red-btn px-4 py-2 font-bold text-white hover:brightness-90 disabled:opacity-60" disabled={busy} onClick={() => { setConfirm(false); decide(shown.map((r) => r.id), "approved", "", t("Approved.")); }}>{t("Yes, approve")}</button>
            <button className="rounded-xl border border-line bg-panel2 px-4 py-2 hover:border-white/30" onClick={() => setConfirm(false)}>{t("Cancel")}</button>
          </div>
        ) : <button className="rounded-xl border border-line bg-panel2 px-4 py-2 text-sm hover:border-white/30 disabled:opacity-60" disabled={busy} onClick={() => setConfirm(true)}>{rows.length > max ? t("Approve the first {n}", { n: max }) : t("Approve all {n}", { n: rows.length })}</button>)}
      </div>
      <ul className="space-y-4">{rows.map((r) => <Item key={r.id} r={r} pending={pending} busy={busy} decide={decide} />)}</ul>
    </section>
  );
}

const KNOWN = ["name", "status", "start", "end", "current", "wonVs", "defences", "endNote"];
function fieldLabel(t: ReturnType<typeof useT>, k: string): string {
  switch (k) {
    case "name": return t("Holder");
    case "status": return t("Kind of champion");
    case "start": return t("Reign began");
    case "end": return t("Reign ended");
    case "current": return t("Current champion");
    case "wonVs": return t("Won it from");
    case "defences": return t("Defences");
    default: return t("How it ended");
  }
}

function Item({ r, pending, busy, decide }: { r: ProposalRow; pending: boolean; busy: boolean; decide: (ids: number[], d: "approved" | "rejected", note: string, done: string) => void }) {
  const t = useT();
  const [note, setNote] = useState("");
  const ev = (r.evidence ?? {}) as { page?: string; revision?: string; seen?: string; held?: string; quote?: string; corroboration?: string; notes?: string; vendor?: { outcome?: string | null } };
  const old = (r.old ?? {}) as Record<string, unknown>, now = (r.new ?? {}) as Record<string, unknown>;
  const show = (v: unknown) => (v === null || v === undefined || v === "" ? "–" : v === true ? t("Yes") : v === false ? t("No") : String(v));
  const record = (o: Record<string, unknown>) => { const w = o.vendor_wins, l = o.vendor_losses, d = o.vendor_draws; return [w, l, d].every((x) => x === undefined) ? "–" : `${w ?? "?"}-${l ?? "?"}-${d ?? "?"}${o.vendor_ko_wins !== undefined ? ` (${o.vendor_ko_wins} KO)` : ""}`; };
  type V = { k: string; label: string; o: string; n: string };
  let view: V[];
  if (r.kind === "field_change") {
    const col = Object.keys(now)[0] ?? "", sh = (r.evidence as { shown?: { old: string | null; new: string | null } } | null)?.shown;
    view = [{ k: col, label: col, o: show(sh ? sh.old : old[col]), n: show(sh ? sh.new : now[col]) }];
  } else if (r.kind === "result_change") {
    const e = (r.evidence ?? {}) as { shown?: { old: string; new: string }; totals?: { name: string; old: Record<string, unknown>; new: Record<string, unknown> }[] };
    view = [{ k: "result", label: t("Result"), o: e.shown?.old ?? "–", n: e.shown?.new ?? "–" },
      ...["round_time", "vendor_scores", "kd_red", "kd_blue", "status"].filter((c) => c in now && old[c] !== now[c]).map((c) => ({ k: c, label: c, o: show(old[c]), n: show(now[c]) })),
      ...(e.totals ?? []).map((x) => ({ k: `t-${x.name}`, label: `${x.name}: ${t("Career totals")}`, o: record(x.old), n: record(x.new) }))];
  } else if (r.kind.startsWith("result_set")) {
    view = [{ k: "method", label: t("Method"), o: show(old.method), n: show(now.method) }, { k: "winner", label: t("Winner"), o: show(old.winner), n: now.winner ? String(now.winner) : t("No winner (draw or no contest)") }, { k: "round", label: t("Ended in round"), o: show(old.endRound), n: show(now.endRound) }];
  } else if (r.kind === "team_added") {
    view = [{ k: "role", label: t("Role"), o: "–", n: show(now.role === "head_trainer" ? t("Trainer") : now.role === "manager" ? t("Manager") : now.role === "gym" ? t("Gym") : t("Promoter")) }, { k: "name", label: t("Name"), o: "–", n: show(now.name) }];
  } else if (r.kind === "list_change") {
    const names = (rows: unknown) => (Array.isArray(rows) ? (rows as { kind: string; rank: number | null; who?: string | null; name?: string | null; vacant?: number }[]) : []);
    const fmt = (rows: unknown, kind: string) => names(rows).filter((x) => x.kind === kind).map((x) => (x.vacant ? t("Vacant") : `${kind === "contender" && x.rank ? `${x.rank}. ` : ""}${x.who ?? x.name ?? "?"}`)).join(", ") || "–";
    view = [{ k: "champion", label: t("Champion"), o: fmt(old.rows, "champion"), n: fmt(now.rows, "champion") }, { k: "contenders", label: t("Contenders"), o: fmt(old.rows, "contender"), n: fmt(now.rows, "contender") }];
  } else {
    const fields = [...new Set([...Object.keys(old), ...Object.keys(now)])].filter((k) => KNOWN.includes(k));
    view = fields.map((k) => ({ k, label: fieldLabel(t, k), o: r.kind === "reign_added" ? "–" : show(old[k]), n: r.kind === "reign_removed" ? t("Not on the page") : show(now[k]) }));
  }
  const wiki = r.source.startsWith("wikipedia:") && ev.page;
  const btn = "rounded-xl border border-line bg-panel2 px-4 py-2 transition hover:border-white/30 disabled:opacity-60";
  return (
    <li className="card space-y-3 p-5 text-sm">
      <div {...(r.kind.startsWith("result_set") || r.kind === "team_added" ? { lang: "en", dir: "ltr" as const } : {})} className="font-display text-xl font-bold">{r.kind === "reign_changed" ? r.label.split(": ").slice(0, -1).join(": ") : r.label}</div>
      <table className="w-full text-start">
        <caption className="sr-only">{r.label}</caption>
        <thead><tr className="text-xs uppercase tracking-widest text-muted"><th scope="col" className="py-1 pe-3 text-start font-normal">{t("Detail")}</th><th scope="col" className="py-1 pe-3 text-start font-normal">{t("Held now")}</th><th scope="col" className="py-1 text-start font-normal">{t("Source says")}</th></tr></thead>
        <tbody>
          {view.map((v) => <tr key={v.k} className="border-t border-line"><th scope="row" className="py-1 pe-3 text-start font-normal text-muted">{v.label}</th><td className="py-1 pe-3 [overflow-wrap:anywhere]">{v.o}</td><td className="py-1 font-semibold [overflow-wrap:anywhere]">{v.n}</td></tr>)}
        </tbody>
      </table>
      {wiki && <p className="text-muted">{t("Read on")} <a href={`https://en.wikipedia.org/wiki/${encodeURIComponent(ev.page!)}`} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted hover:text-gold">{ev.page!.replace(/_/g, " ")}</a>{ev.revision && <> · <a href={`https://en.wikipedia.org/w/index.php?oldid=${encodeURIComponent(ev.revision)}`} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted hover:text-gold">{t("revision {n}", { n: ev.revision })}</a></>}</p>}
      {r.kind === "team_added" && ev.quote && <p className="text-xs text-muted"><span dir="ltr" lang="en" className="[overflow-wrap:anywhere]">{ev.quote}</span> · {t("Read from a sentence of the fighter's own article, which can be about someone else (an opponent's trainer, a former one): approve it only if the sentence says it.")}</p>}
      {r.kind.startsWith("result_set") && ev.quote && <p className="text-xs text-muted"><span dir="ltr" lang="en" className="[overflow-wrap:anywhere]">{ev.quote}</span>{ev.corroboration && <> · {t("Single unofficial source: a result is the commission's or the sanctioning body's to state, so approve it only if you can check it.")}</>}{ev.notes && <> · <span dir="ltr" lang="en">{ev.notes}</span></>}{ev.vendor?.outcome && <> · {t("The vendor's own copy says: {outcome}", { outcome: ev.vendor.outcome })}</>}</p>}
      <p className="text-xs text-muted">{t("First seen {date}", { date: r.firstSeen.slice(0, 10) })}{r.lastSeen !== r.firstSeen ? ` · ${t("last seen {date}", { date: r.lastSeen.slice(0, 10) })}` : ""}</p>
      {pending ? (
        <div className="flex flex-wrap items-end gap-3 border-t border-line pt-3">
          <button className="rounded-xl bg-red-btn px-4 py-2 font-bold text-white hover:brightness-90 disabled:opacity-60" disabled={busy} onClick={() => decide([r.id], "approved", note, t("Approved."))}>{t("Approve")}</button>
          <div className="min-w-[12rem] flex-1">
            <label htmlFor={`un-${r.id}`} className="mb-1 block text-xs uppercase tracking-widest text-muted">{t("Note (needed to reject)")}</label>
            <input id={`un-${r.id}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className="w-full rounded-xl border border-line bg-panel2 px-3 py-2 outline-none focus:border-gold/60" />
          </div>
          <button className={`${btn} hover:!border-red/60`} disabled={busy} onClick={() => decide([r.id], "rejected", note, t("Not accepted. It will not be raised again unless the source says something different."))}>{t("Reject")}</button>
        </div>
      ) : r.decidedAt ? (
        <p className="border-t border-line pt-3 text-xs text-muted">{t("Decided by {name} on {date}", { name: r.decidedBy ?? "?", date: r.decidedAt.slice(0, 10) })}{r.note ? ` · ${r.note}` : ""}</p>
      ) : null}
    </li>
  );
}
