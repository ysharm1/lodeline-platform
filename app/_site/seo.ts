import type { Metadata } from "next";

/** Canonical origin. Set APP_BASE_URL=https://lodeline.org in production. */
export function siteUrl(): string {
  return (process.env.APP_BASE_URL || "https://lodeline.org").replace(/\/+$/, "");
}

export const SITE_NAME = "Lodeline";

/** Public pages for sitemap.xml (marketing + public platform pages). */
export const PUBLIC_PATHS = [
  "/",
  "/sample-evidence-pack",
  "/readiness-checklist",
  "/privacy",
  "/industries/motors-actuators",
  "/industries/uas-components",
  "/industries/aerospace-assemblies",
  "/industries/power-generation",
  "/demo",
  "/pack",
  "/suppliers",
  "/for-suppliers",
  "/audit",
] as const;

export function pageMetadata(meta: { title: string; description: string; ogImage?: string }, path: string): Metadata {
  return {
    metadataBase: new URL(siteUrl()),
    title: meta.title,
    description: meta.description,
    alternates: { canonical: path },
    openGraph: {
      title: meta.title,
      description: meta.description,
      url: path,
      siteName: SITE_NAME,
      type: "website",
      images: [{ url: meta.ogImage ?? "/assets/img/hero-magnetic-field.jpg" }],
    },
    twitter: { card: "summary_large_image", title: meta.title, description: meta.description, images: [meta.ogImage ?? "/assets/img/hero-magnetic-field.jpg"] },
    icons: { icon: "/assets/mark.svg" },
  };
}
