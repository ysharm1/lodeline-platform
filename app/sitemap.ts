import type { MetadataRoute } from "next";
import { PUBLIC_PATHS, siteUrl } from "./_site/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  return PUBLIC_PATHS.map((p) => ({
    url: `${base}${p === "/" ? "/" : p}`,
    changeFrequency: p === "/" ? "weekly" : "monthly",
    priority: p === "/" ? 1 : p.startsWith("/industries") ? 0.6 : 0.7,
  }));
}
