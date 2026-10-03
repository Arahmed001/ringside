"use client";
import { useCallback, useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** localStorage-backed state that is SSR-safe (server snapshot = fallback) and syncs across components. */
export function useLocal<T>(key: string, fallback: T): [T, (v: T) => void] {
  const raw = useSyncExternalStore(
    (cb) => { listeners.add(cb); window.addEventListener("storage", cb); return () => { listeners.delete(cb); window.removeEventListener("storage", cb); }; },
    () => { try { return localStorage.getItem(key); } catch { return null; } },
    () => null,
  );
  let value = fallback;
  if (raw) { try { value = JSON.parse(raw) as T; } catch { /* keep fallback */ } }
  const set = useCallback((v: T) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage unavailable */ } emit(); }, [key]);
  return [value, set];
}
