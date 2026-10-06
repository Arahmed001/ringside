// Preloaded into a child process (NODE_OPTIONS=--import) to give it a wrong system clock: UF_SKEW_MS is added to Date.now() and to new Date().
const off = Number(process.env.UF_SKEW_MS || 0);
if (off) {
  const D = Date;
  globalThis.Date = class extends D { constructor(...a) { if (a.length === 0) super(D.now() + off); else super(...a); } static now() { return D.now() + off; } };
}
