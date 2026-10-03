export function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
/** Deterministic pick helper: seed + salt → stable choice. */
export const pickBy = <T,>(seed: number, salt: number, list: T[]) => list[Math.abs(Math.imul(seed ^ (salt * 2654435761), 2246822519) >>> 0) % list.length];
export const frac = (seed: number, salt: number) => (Math.abs(Math.imul(seed ^ (salt * 40503), 2654435761) >>> 0) % 1000) / 1000;
