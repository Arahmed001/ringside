"use client";
import { useState, type FormEvent } from "react";
import Link from "@/components/L";
import { useT } from "@/components/i18n";
import { api, refreshAccount, setSignedIn, useAccount, type Me } from "@/lib/useAccount";
import { PICKS_KEY } from "@/lib/usePicks";
import { explain } from "@/components/accountText";

const input = "w-full rounded-xl border border-line bg-panel2 px-3 py-2.5 text-sm outline-none placeholder:text-muted focus:border-gold/60";
const primary = "rounded-xl bg-red-btn px-5 py-2.5 font-display text-lg font-bold uppercase text-white transition hover:brightness-90 disabled:opacity-60";
const secondary = "rounded-xl border border-line bg-panel2 px-4 py-2 text-sm transition hover:border-white/30 disabled:opacity-60";

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs uppercase tracking-widest text-muted">{label}</label>
      {children}
      {hint && <p id={`${id}-hint`} className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

/** Sign in, create an account, reset a password with an operator's code, and (signed in) manage the account. */
export function AccountPanel() {
  const t = useT();
  const me = useAccount();
  if (me === undefined) return <p className="text-sm text-muted">{t("Loading…")}</p>;
  return me ? <Signed me={me} /> : <SignedOut />;
}

/** The picks a visitor made before signing in move onto the account (open fights only; the server never overwrites an existing pick). */
async function moveLocalPicks(): Promise<number> {
  let local: Record<string, number> = {};
  try { local = JSON.parse(localStorage.getItem(PICKS_KEY) ?? "{}"); } catch { /* none */ }
  if (!Object.keys(local).length) return 0;
  const r = await api<{ added: number }>("/api/account/picks/import", "POST", { picks: local });
  return r.ok ? r.data.added ?? 0 : 0;
}

function SignedOut() {
  const t = useT();
  const [tab, setTab] = useState<"in" | "up" | "reset">("in");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const val = (k: string) => String(f.get(k) ?? "");
    setBusy(true); setMsg(null);
    if (tab === "up" && val("password") !== val("again")) { setBusy(false); setMsg({ text: t("The two passwords are not the same."), bad: true }); return; }
    const r = tab === "reset"
      ? await api("/api/account/reset", "POST", { username: val("username"), code: val("code"), password: val("password") })
      : await api(tab === "in" ? "/api/account/login" : "/api/account/signup", "POST", { username: val("username"), password: val("password") });
    if (!r.ok) { setBusy(false); setMsg({ text: explain(t, r.data.error), bad: true }); return; }
    const moved = await moveLocalPicks();
    await refreshAccount();
    setBusy(false);
    if (moved) setMsg({ text: t("{n} of the picks saved in this browser were added to your account.", { n: moved }), bad: false });
  }

  const tabs: ["in" | "up" | "reset", string][] = [["in", t("Sign in")], ["up", t("Create account")], ["reset", t("Forgot password")]];
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
      <form onSubmit={submit} className="card space-y-4 p-5" aria-label={tabs.find(([k]) => k === tab)![1]}>
        <div role="tablist" aria-label={t("Account")} className="flex flex-wrap gap-2">
          {tabs.map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setMsg(null); }}
              className={`rounded-full border px-3 py-1 text-sm ${tab === k ? "border-gold/60 text-ink" : "border-line text-muted hover:text-ink"}`}>{label}</button>
          ))}
        </div>
        {tab === "reset" && <p className="text-sm text-muted">{t("There is no email on file to send a reset link to. Ask whoever runs this site for a one-time code, then enter it here with your name and a new password.")}</p>}
        <Field id="acc-user" label={t("Name")} hint={tab === "up" ? t("3 to 24 letters, digits or underscores. This is what others see on the leaderboard.") : undefined}>
          <input id="acc-user" name="username" required minLength={3} maxLength={24} autoComplete="username" autoCapitalize="none" spellCheck={false} className={input} aria-describedby={tab === "up" ? "acc-user-hint" : undefined} />
        </Field>
        {tab === "reset" && <Field id="acc-code" label={t("One-time code")}><input id="acc-code" name="code" required autoComplete="one-time-code" autoCapitalize="none" spellCheck={false} className={input} /></Field>}
        <Field id="acc-pass" label={tab === "reset" ? t("New password") : t("Password")} hint={tab !== "in" ? t("At least 10 characters. A few words make a good password.") : undefined}>
          <input id="acc-pass" name="password" type="password" required minLength={tab === "in" ? 1 : 10} maxLength={200} autoComplete={tab === "in" ? "current-password" : "new-password"} className={input} aria-describedby={tab !== "in" ? "acc-pass-hint" : undefined} />
        </Field>
        {tab === "up" && <Field id="acc-again" label={t("Password again")}><input id="acc-again" name="again" type="password" required maxLength={200} autoComplete="new-password" className={input} /></Field>}
        <div className="flex items-center gap-3">
          <button className={primary} disabled={busy}>{tab === "in" ? t("Sign in") : tab === "up" ? t("Create account") : t("Set new password")}</button>
          <span role="status" aria-live="polite" className={`text-sm ${msg?.bad ? "text-red-ink" : "text-win"}`}>{msg?.text}</span>
        </div>
      </form>
      <div className="space-y-3 text-sm text-muted">
        <h2 className="font-display text-2xl font-bold uppercase text-ink">{t("What an account is for")}</h2>
        <ul className="list-disc space-y-1.5 ps-5">
          <li>{t("Your pick’em picks follow you across devices and count on the leaderboard.")}</li>
          <li>{t("You can propose corrections to a fighter’s team history, with a source an editor can check.")}</li>
        </ul>
        <p>{t("We keep a name, a scrambled copy of your password, your picks and the edits you propose. No email, no tracking. You can download all of it, or delete it, from this page once you are signed in.")}</p>
        <p>{t("Names are shown on the leaderboard unless you turn that off. Do not use your real name if you would rather not be found.")}</p>
      </div>
    </div>
  );
}

function Signed({ me }: { me: Me }) {
  const t = useT();
  const role = me.role === "admin" ? t("Admin") : me.role === "editor" ? t("Editor") : t("Member");
  return (
    <div className="space-y-6">
      <section className="card flex flex-wrap items-center justify-between gap-4 p-5">
        <div>
          <div className="eyebrow">{t("Signed in")}</div>
          <div className="font-display text-3xl font-bold">{me.username} <span className="chip align-middle">{role}</span></div>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <Link href="/picks" className="chip hover:!text-gold">{t("My picks")}</Link>
          <Link href="/leaderboard" className="chip hover:!text-gold">{t("Leaderboard")}</Link>
          <Link href="/contribute" className="chip hover:!text-gold">{t("Suggest an edit")}</Link>
          {(me.role === "editor" || me.role === "admin") && <Link href="/review" className="chip hover:!text-gold">{t("Review queue")}</Link>}
        </div>
      </section>
      <div className="grid gap-6 lg:grid-cols-2">
        <Settings me={me} />
        <Password />
      </div>
      <Danger />
    </div>
  );
}

function Settings({ me }: { me: Me }) {
  const t = useT();
  const [msg, setMsg] = useState("");
  async function toggle(on: boolean) {
    const r = await api("/api/account/settings", "POST", { picksPublic: on });
    if (r.ok) { setSignedIn({ ...me, picksPublic: on }); setMsg(on ? t("Your picks count on the leaderboard.") : t("Your picks are hidden from the leaderboard.")); } else setMsg(explain(t, r.data.error));
  }
  return (
    <section className="card space-y-3 p-5">
      <h2 className="font-display text-2xl font-bold uppercase">{t("Privacy")}</h2>
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" className="mt-1 h-4 w-4" checked={me.picksPublic} onChange={(e) => void toggle(e.target.checked)} />
        <span>{t("Show me on the leaderboard")}<span className="block text-xs text-muted">{t("Only your name and your pick’em score are shown, never your individual picks.")}</span></span>
      </label>
      <p>{/* an API download, not a page: it has no /ar version */}<a download href="/api/account/export" className="text-sm underline decoration-dotted hover:text-gold">{t("Download everything we hold about me")}</a></p>
      <p role="status" aria-live="polite" className="text-xs text-muted">{msg}</p>
    </section>
  );
}

function Password() {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget, f = new FormData(form);
    if (f.get("next") !== f.get("again")) { setMsg({ text: t("The two passwords are not the same."), bad: true }); return; }
    setBusy(true); setMsg(null);
    const r = await api("/api/account/password", "POST", { current: f.get("current"), next: f.get("next") });
    setBusy(false);
    if (!r.ok) { setMsg({ text: explain(t, r.data.error), bad: true }); return; }
    form.reset();
    setMsg({ text: t("Password changed. Your other devices were signed out."), bad: false });
  }
  return (
    <form onSubmit={submit} className="card space-y-3 p-5" aria-label={t("Change password")}>
      <h2 className="font-display text-2xl font-bold uppercase">{t("Change password")}</h2>
      <Field id="pw-cur" label={t("Current password")}><input id="pw-cur" name="current" type="password" required autoComplete="current-password" maxLength={200} className={input} /></Field>
      <Field id="pw-new" label={t("New password")} hint={t("At least 10 characters. A few words make a good password.")}><input id="pw-new" name="next" type="password" required minLength={10} autoComplete="new-password" maxLength={200} className={input} aria-describedby="pw-new-hint" /></Field>
      <Field id="pw-again" label={t("New password again")}><input id="pw-again" name="again" type="password" required autoComplete="new-password" maxLength={200} className={input} /></Field>
      <div className="flex items-center gap-3"><button className={secondary} disabled={busy}>{t("Change password")}</button><span role="status" aria-live="polite" className={`text-sm ${msg?.bad ? "text-red-ink" : "text-win"}`}>{msg?.text}</span></div>
    </form>
  );
}

function Danger() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  async function out() { setBusy(true); await api("/api/account/logout", "POST", {}); setSignedIn(null); }
  async function del(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setMsg("");
    const r = await api("/api/account/delete", "POST", { password: new FormData(e.currentTarget).get("password") });
    setBusy(false);
    if (!r.ok) { setMsg(explain(t, r.data.error)); return; }
    setSignedIn(null);
  }
  return (
    <section className="card space-y-3 p-5">
      <div className="flex flex-wrap items-center gap-3">
        <button className={secondary} onClick={() => void out()} disabled={busy}>{t("Sign out")}</button>
        <button className="text-sm text-muted underline decoration-dotted hover:text-red-ink" aria-expanded={open} onClick={() => setOpen(!open)}>{t("Delete my account")}</button>
      </div>
      {open && (
        <form onSubmit={del} className="max-w-md space-y-3 border-t border-line pt-3" aria-label={t("Delete my account")}>
          <p className="text-sm text-muted">{t("This removes your name, your picks and your sign-ins for good. Edits you proposed stay in the record without your name. Enter your password to confirm.")}</p>
          <Field id="del-pw" label={t("Password")}><input id="del-pw" name="password" type="password" required autoComplete="current-password" maxLength={200} className={input} /></Field>
          <div className="flex items-center gap-3"><button className="rounded-xl bg-red-btn px-4 py-2 text-sm font-bold text-white hover:brightness-90 disabled:opacity-60" disabled={busy}>{t("Delete for good")}</button><span role="status" aria-live="polite" className="text-sm text-red-ink">{msg}</span></div>
        </form>
      )}
    </section>
  );
}
