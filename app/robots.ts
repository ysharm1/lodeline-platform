import type { MetadataRoute } from "next";
import { siteUrl } from "./_site/seo";

/** Public marketing + directory pages are crawlable; app, token and API routes are not. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/admin/", "/buyer/", "/supplier", "/s/", "/login", "/audit/"] }],
    sitemap: `${siteUrl()}/sitemap.xml`,
    host: siteUrl(),
  };
}
