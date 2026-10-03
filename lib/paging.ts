/** Which slice of a long list a `?page=` asks for: a missing, fractional, negative or out-of-range number lands on the nearest real page. */
export function paginate(total: number, param: string | undefined, size: number): { page: number; pages: number; first: number } {
  const pages = Math.max(1, Math.ceil(total / size));
  const n = Math.floor(Number(param));
  const page = Math.min(pages, Math.max(1, Number.isFinite(n) ? n : 1));
  return { page, pages, first: (page - 1) * size };
}
