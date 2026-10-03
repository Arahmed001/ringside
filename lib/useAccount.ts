"use client";
import { useEffect, useSyncExternalStore } from "react";

export interface Me { id: number; username: string; role: "user" | "editor" | "admin"; createdAt: string; picksPublic: boolean }
interface State { user: Me | null | undefined } // undefined = not asked yet

const SERVER: State = { user: undefined };
let state: State = SERVER;
let asked = false;
const listeners = new Set<() => void>();
const set = (user: Me | null) => { state = { user }; listeners.forEach((l) => l()); };

/** One small request per page load tells the header and the pick'em who is signed in. Pages never read the cookie themselves, so they stay cacheable. */
export function refreshAccount(): Promise<Me | null> {
  return fetch("/api/account/me", { credentials: "same-origin" })
    .then((r) => (r.ok ? r.json() : { user: null }))
    .then((j: { user: Me | null }) => { set(j.user ?? null); return j.user ?? null; })
    .catch(() => { if (state.user === undefined) set(null); return null; });
}
export const setSignedIn = (u: Me | null) => set(u);

export function useAccount(): Me | null | undefined {
  const s = useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; }, () => state, () => SERVER);
  useEffect(() => { if (!asked) { asked = true; void refreshAccount(); } }, []);
  return s.user;
}

export interface ApiResult<T = Record<string, unknown>> { ok: boolean; status: number; data: T & { error?: string } }
/** JSON to the account API. Never throws: a network failure comes back as `{ok:false, error:"network"}`. */
export async function api<T = Record<string, unknown>>(path: string, method = "POST", body?: unknown): Promise<ApiResult<T>> {
  try {
    const r = await fetch(path, { method, credentials: "same-origin", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data } as ApiResult<T>;
  } catch { return { ok: false, status: 0, data: { error: "network" } as never }; }
}
