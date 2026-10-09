"use client";
import { useState } from "react";

export interface SocialCard { id: number; provider: string; providerName: string; url: string; embed: string; account: string | null; note: string | null }

/**
 * Public posts that an editor chose, each shown as a card of text and a button. Nothing is requested from the platform until the visitor presses the button; then the
 * platform's own embed opens in a sandboxed frame. The account and the note are the editor's words; the address in the frame was rebuilt on the server from checked parts.
 */
export function SocialPosts({ items, show, open }: { items: SocialCard[]; show: string; open: string }) {
  const [on, setOn] = useState<number | null>(null);
  return (
    <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {items.map((p) => (
        <li key={p.id} className="card p-4">
          <div className="text-xs text-muted"><span lang="en" dir="ltr">{p.providerName}{p.account ? ` · ${p.account}` : ""}</span></div>
          {p.note && <p className="mt-1 text-sm">{p.note}</p>}
          {on === p.id ? (
            <div className="mt-3 overflow-hidden rounded-lg bg-black">
              <iframe
                title={`${p.providerName}${p.account ? ` ${p.account}` : ""}`} src={p.embed} loading="lazy" referrerPolicy="strict-origin-when-cross-origin" className="h-[480px] w-full"
                sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation"
              />
            </div>
          ) : (
            <button type="button" onClick={() => setOn(p.id)} className="btn mt-3 min-h-11 cursor-pointer">{show} ({p.providerName})</button>
          )}
          <div className="mt-2 text-xs text-muted"><a href={p.url} target="_blank" rel="noopener noreferrer nofollow" className="inline-block py-1 hover:text-ink">{open} ↗</a></div>
        </li>
      ))}
    </ul>
  );
}
