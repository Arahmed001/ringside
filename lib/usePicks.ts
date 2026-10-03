"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocal } from "./useLocal";
import { api, useAccount } from "./useAccount";

export const PICKS_KEY = "ringside:picks";
const EMPTY: Record<number, number> = {};

/**
 * The visitor's pick'em picks, wherever they live: on the account when signed in (so they follow the person across devices and count on the
 * leaderboard), in this browser otherwise. `choose` returns an error code when the server refuses (locked, rate limited...), after undoing
 * the optimistic change, so the page can say why.
 */
export function usePicks() {
  const me = useAccount();
  const [local, setLocal] = useLocal<Record<number, number>>(PICKS_KEY, EMPTY);
  const [remote, setRemote] = useState<{ for: number; picks: Record<number, number> } | null>(null);
  const user = me?.id ?? null;
  const loading = me === undefined || (user !== null && remote?.for !== user);
  const reload = useRef<() => void>(() => {});

  useEffect(() => {
    if (user === null) return;
    let live = true;
    const load = () => api<{ picks: Record<number, number> }>("/api/account/picks", "GET").then((r) => { if (live && r.ok) setRemote({ for: user, picks: r.data.picks ?? {} }); });
    reload.current = load;
    void load();
    return () => { live = false; };
  }, [user]);

  const picks = user !== null ? (remote?.for === user ? remote.picks : EMPTY) : local;

  const mirror = useRef<Record<number, number>>({}); // the latest picks, so two quick clicks do not overwrite each other
  const update = useCallback((next: Record<number, number>) => { mirror.current = next; if (user !== null) setRemote({ for: user, picks: next }); }, [user]);
  useEffect(() => { mirror.current = picks; });

  const choose = useCallback(async (boutId: number, boxerId: number): Promise<string | null> => {
    if (user === null) {
      let fresh: Record<number, number> = {};
      try { fresh = JSON.parse(localStorage.getItem(PICKS_KEY) ?? "{}"); } catch { /* start again */ }
      setLocal({ ...fresh, [boutId]: boxerId });
      return null;
    }
    const was = mirror.current[boutId];
    update({ ...mirror.current, [boutId]: boxerId });
    const r = await api("/api/account/picks", "POST", { boutId, boxerId });
    if (!r.ok) {
      const back = { ...mirror.current };
      if (was === undefined) delete back[boutId]; else back[boutId] = was;
      update(back);
      return r.data.error ?? "network";
    }
    return null;
  }, [user, setLocal, update]);

  const clearLocal = useCallback(() => setLocal({}), [setLocal]);
  return { picks, choose, clearLocal, mode: (user !== null ? "account" : "local") as "account" | "local", loading, reload: () => reload.current() };
}
