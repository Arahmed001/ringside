"use client";
import { useId, useState, type ReactNode } from "react";

/**
 * One line of a fighter's fight record that opens to show more about the fight. The line's cells and the details are made on the server and passed in, so
 * the words are in the page whether or not the details are open (the details are only hidden, not left out, which keeps them for a reader without scripts
 * and for a search); the button names the fight it opens, says whether it is open (`aria-expanded`) and is 32 px square, far above the 24 px minimum.
 */
export function FightRow({ cells, details, label, columns }: { cells: ReactNode; details: ReactNode; label: string; columns: number }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      <tr className="border-t border-line/60 text-sm">
        {cells}
        <td className="w-9 py-1 text-end">
          <button type="button" aria-expanded={open} aria-controls={id} aria-label={label} onClick={() => setOpen((v) => !v)}
            className="inline-grid h-8 w-8 cursor-pointer place-items-center rounded-md text-muted transition hover:bg-white/10 hover:text-ink">
            <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden className={`transition-transform ${open ? "rotate-180" : ""}`}><path d="M2 4.2 6 8l4-3.8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        </td>
      </tr>
      <tr id={id} hidden={!open}>
        <td colSpan={columns} className="pb-3 pt-0">{details}</td>
      </tr>
    </>
  );
}
