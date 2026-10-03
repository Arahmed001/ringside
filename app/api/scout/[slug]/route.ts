import { NextResponse } from "next/server";
import { getWorld } from "@/lib/world";
import { scoutingReport } from "@/lib/ai";

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const w = await getWorld();
  const b = w.bySlug.get(slug);
  if (!b) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(await scoutingReport(b, w));
}
