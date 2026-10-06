import type { MetadataRoute } from "next";
import { abs, indexable } from "@/lib/seo";

// read the environment per request, not at build time: a build made with one provider can be deployed with another
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  if (!indexable()) return { rules: { userAgent: "*", disallow: "/" } }; // demo data is fictional: keep it out of search results
  return { rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/embed/"] }, sitemap: abs("/sitemap.xml") };
}
