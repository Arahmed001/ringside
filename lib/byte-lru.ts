/**
 * A least-recently-used cache bounded by BYTES, not by entries: what it holds (a share image, a sitemap file) varies from 40 KB to 9 MB, so a count cannot
 * keep memory in check. An entry larger than the whole budget is not kept at all. `bytes` is read from the value (a Buffer's length, normally).
 */
export class ByteLru<K, V extends { byteLength: number }> {
  private m = new Map<K, V>();
  private used = 0;
  constructor(private maxBytes: number) {}
  get(k: K): V | undefined {
    const v = this.m.get(k);
    if (v === undefined) return undefined;
    this.m.delete(k); this.m.set(k, v); // most recently used goes last
    return v;
  }
  set(k: K, v: V): void {
    const old = this.m.get(k);
    if (old !== undefined) { this.used -= old.byteLength; this.m.delete(k); }
    if (v.byteLength > this.maxBytes) return;
    this.m.set(k, v); this.used += v.byteLength;
    while (this.used > this.maxBytes) {
      const first = this.m.keys().next().value as K;
      this.used -= this.m.get(first)!.byteLength; this.m.delete(first);
    }
  }
  get size(): number { return this.m.size; }
  get bytes(): number { return this.used; }
  clear(): void { this.m.clear(); this.used = 0; }
}

/** A megabyte budget from a setting's text (a number of MB), with a default, and never negative or not a number. */
export function budgetMb(raw: string | undefined, fallbackMb: number): number {
  const n = raw === undefined || raw === "" ? NaN : Number(raw);
  return (Number.isFinite(n) && n >= 0 ? n : fallbackMb) * 1024 * 1024;
}
