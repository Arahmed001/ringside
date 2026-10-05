"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocal } from "./useLocal";
import { api, useAccount } from "./useAccount";

export const WATCH_KEY = "ringside:watchlist";
const EMPTY: string[] = [];

/** Whatever is in this browser's storage, as a list of slugs: anything else (an edited, truncated or foreign value) is treated as no list at all. */
export function cleanList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return EMPTY;
  const out = [...new Set(raw.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length < 120))].slice(0, 100);
  return out.length === raw.length ? (raw as string[]) : out;
}

/**
 * The visitor's watchlist, wherever it lives: on the account when signed in (so it follows the person across devices), in this browser otherwise.
 * When someone signs in, the list already in this browser is added to the account (never removing anything there) and then cleared from the browser.
 * `toggle` changes the list at once and undoes the change if the server refuses. `loading` is true until the account's own list has arrived.
 */
export function useWatchlist() {
  const me = useAccount();
  const [stored, setLocal] = useLocal<unknown>(WATCH_KEY, EMPTY);
  const local = useMemo(() => cleanList(stored), [stored]);
  const [remote, setRemote] = useState<{ for: number; slugs: string[] } | null>(null);
  const user = me?.id ?? null;
  const merging = useRef<number | null>(null);

  useEffect(() => {
    if (user === null) return;
    let live = true;
    void (async () => {
      let mine: string[] | null = null;
      let had: string[] = [];
      try { const raw = JSON.parse(localStorage.getItem(WATCH_KEY) ?? "[]"); if (Array.isArray(raw)) had = raw.filter((x) => typeof x === "string"); } catch { /* none */ }
      if (had.length && merging.current !== user) {
        merging.current = user;
        const r = await api<{ slugs: string[] }>("/api/account/watchlist/import", "POST", { slugs: had });
        if (r.ok) { mine = r.data.slugs ?? []; setLocal([]); }
      }
      if (mine === null) { const r = await api<{ slugs: string[] }>("/api/account/watchlist", "GET"); if (r.ok) mine = r.data.slugs ?? []; }
      if (live && mine) setRemote({ for: user, slugs: mine });
    })();
    return () => { live = false; };
  }, [user, setLocal]);

  const list = user !== null ? (remote?.for === user ? remote.slugs : EMPTY) : local;
  const loading = me === undefined || (user !== null && remote?.for !== user);

  const mirror = useRef<string[]>(EMPTY); // the latest list, so two quick clicks do not overwrite each other
  useEffect(() => { mirror.current = list; });

  const setOne = useCallback(async (slug: string, on: boolean): Promise<boolean> => {
    if (user === null) {
      let fresh: string[] = [];
      try { const raw = JSON.parse(localStorage.getItem(WATCH_KEY) ?? "[]"); if (Array.isArray(raw)) fresh = raw; } catch { /* start again */ }
      setLocal(on ? (fresh.includes(slug) ? fresh : [...fresh, slug]) : fresh.filter((s) => s !== slug));
      return true;
    }
    const was = mirror.current;
    const next = on ? (was.includes(slug) ? was : [...was, slug]) : was.filter((s) => s !== slug);
    mirror.current = next; setRemote({ for: user, slugs: next });
    const r = await api("/api/account/watchlist", on ? "POST" : "DELETE", { slug });
    if (!r.ok) {
      const back = mirror.current.filter((s) => s !== slug);
      if (was.includes(slug)) back.push(slug);
      mirror.current = back; setRemote({ for: user, slugs: back });
      return false;
    }
    return true;
  }, [user, setLocal]);

  return { list, loading, mode: (user !== null ? "account" : "local") as "account" | "local", add: (s: string) => setOne(s, true), remove: (s: string) => setOne(s, false) };
}
