import v8 from "node:v8";
import vm from "node:vm";

/**
 * A full garbage collection on request, for the moments the process knows a lot has just become garbage: the old world right after a swap (several hundred megabytes at the
 * real size), and the build's leftovers once the pages are warm. V8 does collect that garbage on its own, but lazily: its default heap limit is a few gigabytes, so it is happy to
 * leave 700 MB of dead world sitting there while the process is measured at 2 GB (docs/capacity.md). Asking is not a stall: the collection is asked to run as a task of its own
 * (`execution: "async"`, marking in slices), and it is not asked for at all when the heap is small (a demo league, the tests).
 *
 * `gc` is not exposed unless the process was started with --expose-gc, so it is switched on at run time the way the Node documentation allows for tooling. If that is not
 * possible (another engine, a locked-down flag set) this does nothing, and the process behaves as it did before.
 */
type Gc = (opts?: { type?: "major" | "minor"; execution?: "sync" | "async" }) => void | Promise<void>;
let gc: Gc | null | undefined;

const MIN_HEAP_BYTES = 64 * 1024 * 1024;
let running: Promise<void> | null = null;

export function collectGarbage(): Promise<void> {
  if (running) return running;
  if (v8.getHeapStatistics().used_heap_size < MIN_HEAP_BYTES) return Promise.resolve();
  if (gc === undefined) {
    gc = (globalThis as unknown as { gc?: Gc }).gc ?? null;
    if (!gc) {
      try { v8.setFlagsFromString("--expose-gc"); gc = vm.runInNewContext("gc") as Gc; } catch { gc = null; }
    }
  }
  const run = gc;
  if (!run) return Promise.resolve();
  running = (async () => {
    try { await run({ type: "major", execution: "async" }); } catch { /* a collection is an optimisation: never fail what asked for it */ }
  })().finally(() => { running = null; });
  return running;
}
