/** A Map that forgets its least recently used entry once it holds `max`. Keeps per-day caches from growing for as long as the server runs. */
export class Lru<K, V> {
  private m = new Map<K, V>();
  constructor(private max: number) {}
  get(k: K): V | undefined {
    const v = this.m.get(k);
    if (v === undefined) return undefined;
    this.m.delete(k); this.m.set(k, v); // most recently used goes last
    return v;
  }
  set(k: K, v: V): void {
    this.m.delete(k); this.m.set(k, v);
    while (this.m.size > this.max) this.m.delete(this.m.keys().next().value as K);
  }
  get size(): number { return this.m.size; }
}
