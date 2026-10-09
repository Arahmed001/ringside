"use client";
import { useRef, useState, type FormEvent } from "react";
import Link from "@/components/L";
import { useT } from "@/components/i18n";
import { useAccount } from "@/lib/useAccount";

const input = "w-full rounded-xl border border-line bg-panel-2 px-3 py-2.5 text-sm outline-none placeholder:text-muted focus:border-gold/60";
const label = "mb-1 block text-xs uppercase tracking-widest text-muted";

/**
 * "Send a photo" on a fighter's page: for the fighter, their team or the photographer. Signed-in people only. The picture waits for an editor and is shown only after approval, with the
 * credit written here beside it. We do not take pictures from social media or other websites: the person sending must have taken it or have the owner's permission.
 */
export function PhotoSubmit({ slug, name, hasPhoto }: { slug: string; name: string; hasPhoto: boolean }) {
  const t = useT();
  const me = useAccount();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);
  const status = useRef<HTMLParagraphElement>(null);
  const explain = (c: unknown) => c === "too_large" ? t("The picture is larger than 4 MB. Send a smaller file.") : c === "not_image" || c === "broken_image" || c === "empty" ? t("Send a JPEG or PNG picture.") : c === "too_small" ? t("The picture is too small. It needs at least 300 pixels on each side.") : c === "too_big_pixels" ? t("The picture is too large in pixels. Send one up to 8000 pixels on each side.") : c === "no_credit" ? t("Write the credit that goes with the picture.") : c === "no_confirm" ? t("Tick the box to confirm you have the right to send this picture.") : c === "too_many_yours" ? t("You already have three pictures waiting. Wait for an editor to decide on them first.") : c === "too_many_for_fighter" ? t("Several pictures of this fighter are already waiting for an editor.") : c === "duplicate" ? t("This picture was already sent for this fighter.") : c === "rate_limited" ? t("Too many tries. Wait a little and try again.") : c === "unauthorized" ? t("Sign in first.") : t("Something went wrong. Try again.");

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    f.set("slug", slug);
    f.set("confirm", f.get("confirm") ? "true" : "");
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/photos/submit", { method: "POST", credentials: "same-origin", body: f });
      const data = (await r.json().catch(() => ({}))) as { error?: string };
      if (r.ok) { form.reset(); setMsg({ text: t("Thank you. An editor will look at your picture. It appears on the page only after they approve it."), bad: false }); }
      else setMsg({ text: explain(data.error), bad: true });
    } catch { setMsg({ text: t("Something went wrong. Try again."), bad: true }); }
    setBusy(false);
    status.current?.focus();
  }

  return (
    <details className="mt-2 text-xs text-muted">
      <summary className="inline-block cursor-pointer py-1 underline decoration-dotted hover:text-ink">{hasPhoto ? t("Send a better photo of this fighter") : t("Is this you or your fighter? Send a photo")}</summary>
      <div className="card mt-2 p-4 text-sm">
        {me === undefined ? <p className="text-muted">{t("Loading…")}</p> : !me ? (
          <p className="text-muted">{t("Sign in to send a photo.")} <Link href="/account" className="underline decoration-dotted hover:text-ink">{t("Sign in or create an account")}</Link></p>
        ) : (
          <form onSubmit={submit} className="grid gap-3 md:grid-cols-2">
            <p className="md:col-span-2 text-muted">{t("Send a picture of {name} that you took, or that its owner has said we may show. Photos taken from social media or other websites cannot be used. An editor checks it before it appears, with your credit beside it.", { name })}</p>
            <label className="md:col-span-2"><span className={label}>{t("Picture (JPEG or PNG, up to 4 MB)")}</span><input name="file" type="file" accept="image/jpeg,image/png" required className={input} /></label>
            <label><span className={label}>{t("You are")}</span>
              <select name="relation" defaultValue="self" className={input}>
                <option value="self">{t("The fighter")}</option><option value="team">{t("The fighter's team or promoter")}</option><option value="photographer">{t("The photographer")}</option><option value="other">{t("Someone else with permission")}</option>
              </select>
            </label>
            <label><span className={label}>{t("Credit shown beside the picture")}</span><input name="credit" required minLength={3} maxLength={160} className={input} /></label>
            <label className="md:col-span-2"><span className={label}>{t("Anything the editor should know (optional)")}</span><input name="note" maxLength={500} className={input} /></label>
            <label className="md:col-span-2 flex items-start gap-2"><input name="confirm" type="checkbox" required className="mt-1 h-4 w-4" /><span>{t("I took this picture, or its owner has given me permission to let Ringside show it on this fighter's page with the credit above.")}</span></label>
            <div className="md:col-span-2"><button type="submit" disabled={busy} className="btn min-h-11 cursor-pointer">{busy ? t("Sending…") : t("Send the picture")}</button></div>
          </form>
        )}
        <p ref={status} tabIndex={-1} role="status" className={`mt-2 text-sm outline-none ${msg?.bad ? "text-red-ink" : "text-muted"}`}>{msg?.text ?? ""}</p>
      </div>
    </details>
  );
}
