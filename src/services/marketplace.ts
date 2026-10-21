/**
 * Customer-dashboard marketplace helpers. Pure, no I/O.
 *
 * - Listing status labels (what a listing's record says, never a compliance finding).
 * - Marketplace filter parsing (stage, material, region, country, status).
 * - Coverage gaps from a pack matrix, linked to a China-free marketplace search.
 * - Stage x country summary for the supply-chain map.
 */
import { MATERIALS, STAGES, type Material, type Stage } from "@/domain/types";
import { COVERED_COUNTRIES, isCoveredIso, toIso2 } from "./countries";
import type { MatrixRow } from "./pack-matrix";

/** Supplier activities outside the DFARS mine-to-component chain. */
export const ACTIVITIES = ["recycling", "distribution"] as const;
export type Activity = (typeof ACTIVITIES)[number];
export const ACTIVITY_LABELS: Record<Activity, string> = { recycling: "Recycling", distribution: "Distribution" };

export const REGIONS = ["US", "Canada", "Taiwan", "Allied-Europe", "Allied-APAC", "LatAm", "Africa", "Other"] as const;

export const LISTING_STATUSES = ["verified", "unverified", "prospect"] as const;
export type ListingStatusFilter = (typeof LISTING_STATUSES)[number];

/** The chain shown on the supply-chain map (mine -> refine -> alloy -> magnet). */
export const MAP_STAGES: readonly Stage[] = ["mine", "separation", "metal_alloy", "magnet"];
export const STAGE_COLORS: Record<Stage, string> = {
  mine: "#c4783f",
  separation: "#d9b44a",
  metal_alloy: "#6fa3c9",
  magnet: "#9b7fd1",
  component: "#8a8f98",
};

export const PROSPECT_LABEL = "Unverified, from public sources";

export interface StatusInput {
  verifiedAt: Date | string | null;
  listingStatus: "prospect" | "listed" | "hidden" | string;
  isExample: boolean;
}

export type StatusTone = "ok" | "muted" | "accent";

/** One label per listing. "Verified" only ever comes from accepted evidence (verifiedAt). */
export function listingStatusLabel(l: StatusInput): { label: string; tone: StatusTone } {
  if (l.isExample) return { label: "Example listing (fictional)", tone: "accent" };
  if (l.verifiedAt) return { label: "Verified from evidence", tone: "ok" };
  if (l.listingStatus === "prospect") return { label: PROSPECT_LABEL, tone: "muted" };
  return { label: "Not verified", tone: "muted" };
}

export interface MarketplaceFilters {
  q: string;
  stages: Stage[];
  activities: Activity[];
  materials: Material[];
  regions: string[];
  countries: string[];
  excludeCovered: boolean;
  status: ListingStatusFilter | null;
}

type Sp = Record<string, string | string[] | undefined>;
const arr = (sp: Sp, k: string) => {
  const v = sp[k];
  return (Array.isArray(v) ? v : v ? v.split(",") : []).map((x) => x.trim()).filter(Boolean);
};

/** `stage` accepts chain stages and the two activities (recycling, distribution). */
export function parseMarketplaceParams(sp: Sp): MarketplaceFilters {
  const stageVals = arr(sp, "stage");
  const status = typeof sp.status === "string" && (LISTING_STATUSES as readonly string[]).includes(sp.status) ? (sp.status as ListingStatusFilter) : null;
  return {
    q: typeof sp.q === "string" ? sp.q.trim().slice(0, 200) : "",
    stages: stageVals.filter((s): s is Stage => (STAGES as readonly string[]).includes(s)),
    activities: stageVals.filter((s): s is Activity => (ACTIVITIES as readonly string[]).includes(s)),
    materials: arr(sp, "material").filter((m): m is Material => (MATERIALS as readonly string[]).includes(m)),
    regions: arr(sp, "region").filter((r) => (REGIONS as readonly string[]).includes(r)),
    countries: arr(sp, "country").map((c) => toIso2(c)).filter((c): c is string => !!c),
    excludeCovered: sp.excludeCovered === "1" || sp.excludeCovered === "true",
    status,
  };
}

/** Rebuilds a query string from filters (for links such as "find a supplier"). */
export function marketplaceHref(f: Partial<MarketplaceFilters>): string {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  const stage = [...(f.stages ?? []), ...(f.activities ?? [])];
  if (stage.length) p.set("stage", stage.join(","));
  if (f.materials?.length) p.set("material", f.materials.join(","));
  if (f.regions?.length) p.set("region", f.regions.join(","));
  if (f.countries?.length) p.set("country", f.countries.join(","));
  if (f.excludeCovered) p.set("excludeCovered", "1");
  if (f.status) p.set("status", f.status);
  const qs = p.toString();
  return `/app/marketplace${qs ? `?${qs}` : ""}`;
}

export interface CoverageGap {
  partId: string;
  partLabel: string;
  stage: Stage;
  materials: Material[];
  reason: "covered_country" | "no_document";
  href: string;
}

/**
 * Open stages in a trace: no accepted document yet, or an accepted record in a
 * covered country. Each gap links to a China-free marketplace search for that
 * stage and material.
 */
export function coverageGaps(rows: MatrixRow[]): CoverageGap[] {
  const out: CoverageGap[] = [];
  for (const r of rows) {
    const mats = r.part.materials.filter((m) => m !== "other");
    for (const c of r.cells) {
      if (c.status === "documented" || c.stage === "component") continue;
      out.push({
        partId: r.part.id,
        partLabel: r.part.partNumber ?? r.part.description,
        stage: c.stage,
        materials: mats,
        reason: c.status === "covered_country" ? "covered_country" : "no_document",
        href: marketplaceHref({ stages: [c.stage], materials: mats, excludeCovered: true }),
      });
    }
  }
  return out;
}

export interface MapListing {
  id: string;
  name: string;
  countryIso: string | null;
  stages: string[];
}

/** Rows: map stages. Columns: countries. Cells: supplier names. Covered countries are flagged. */
export function stageCountrySummary(listings: MapListing[], stages: readonly Stage[] = MAP_STAGES) {
  return stages.map((stage) => {
    const byCountry = new Map<string, string[]>();
    for (const l of listings) {
      if (!l.stages.includes(stage)) continue;
      const k = l.countryIso ?? "??";
      byCountry.set(k, [...(byCountry.get(k) ?? []), l.name]);
    }
    const countries = [...byCountry.entries()]
      .map(([countryIso, suppliers]) => ({ countryIso, suppliers: suppliers.sort(), covered: isCoveredIso(countryIso) }))
      .sort((a, b) => b.suppliers.length - a.suppliers.length || a.countryIso.localeCompare(b.countryIso));
    return { stage, total: countries.reduce((n, c) => n + c.suppliers.length, 0), countries };
  });
}

export { COVERED_COUNTRIES };
