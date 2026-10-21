/**
 * Idempotent import of the supplier DB's buyer-facing export
 * (`platform-seed.json`) into SupplierListing, keyed on the export's supplier
 * `id` (stored as `sourceKey`).
 *
 * Rules (docs/plan/04-marketplace-data.md):
 * - Every imported row is a prospect: "Unverified, from public sources".
 *   The import never sets verifiedAt; only accepted evidence does.
 * - Rows import unpublished by default. The public /suppliers directory shows
 *   published rows only; the signed-in marketplace (/app/marketplace) also
 *   shows prospects with the unverified label. `publish: true` overrides.
 * - Rows a seller has claimed (orgId set) or that were verified are never
 *   overwritten.
 * - Rows that disappear from the export are hidden (unpublished), not deleted.
 * - Coordinates are country-level centroids (no network calls).
 * - Safety: rows carrying anything that looks like an email address, or a
 *   covered-country location, are rejected.
 *
 * The seed file is never committed; the script reads it at run time.
 */
import type { PrismaClient } from "@prisma/client";
import { MATERIALS, STAGES, type Material, type Stage } from "@/domain/types";
import { isCoveredIso, toIso2 } from "./countries";
import { COUNTRY_CENTROIDS } from "./geocoder";
import { ACTIVITIES } from "./marketplace";

export const DEFAULT_SEED_PATH = "/workspace/lodeline-docs/supplier-db/platform-seed.json";

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const KEY_RE = /^[a-z0-9][a-z0-9-]{0,119}$/;

export interface SeedListing {
  sourceKey: string;
  name: string;
  summary: string;
  website: string | null;
  countryIso: string | null;
  hqCountry: string | null;
  countries: string[];
  region: string | null;
  stages: Stage[];
  activities: string[];
  materials: Material[];
  productionStatus: string | null;
  publicSources: string[];
  published: boolean;
}

export interface ParseResult {
  rows: SeedListing[];
  rejected: { key: string; reason: string }[];
}

const str = (v: unknown, max = 2000) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim()) : []);
const url = (v: unknown) => {
  const s = str(v, 300);
  return s && /^https?:\/\//.test(s) ? s : null;
};

/** Validates and maps the export. Pure. */
export function parseSeed(input: unknown): ParseResult {
  const root = input as { suppliers?: unknown };
  if (!root || typeof root !== "object" || !Array.isArray(root.suppliers)) throw new Error("Seed file must be an object with a `suppliers` array.");
  const rows: SeedListing[] = [];
  const rejected: ParseResult["rejected"] = [];
  const seen = new Set<string>();
  for (const raw of root.suppliers as Record<string, unknown>[]) {
    const key = typeof raw?.id === "string" ? raw.id : "";
    if (!KEY_RE.test(key)) {
      rejected.push({ key: key || "(missing id)", reason: "invalid id" });
      continue;
    }
    if (seen.has(key)) {
      rejected.push({ key, reason: "duplicate id" });
      continue;
    }
    seen.add(key);
    if (EMAIL_RE.test(JSON.stringify(raw))) {
      rejected.push({ key, reason: "contains an email address" });
      continue;
    }
    const sl = (raw.supplierListing ?? {}) as Record<string, unknown>;
    const name = str(sl.name, 200) ?? str(raw.company, 200);
    if (!name) {
      rejected.push({ key, reason: "missing name" });
      continue;
    }
    const countryIso = toIso2(str(sl.countryIso, 60) ?? str(raw.hq_country, 60));
    const countries = [...new Set([...strs(sl.countries), ...strs(raw.facility_countries)].map((c) => toIso2(c)).filter((c): c is string => !!c))];
    if (isCoveredIso(countryIso) || countries.some((c) => isCoveredIso(c))) {
      rejected.push({ key, reason: "covered-country location" });
      continue;
    }
    const stages = [...new Set(strs(sl.stages).filter((s): s is Stage => (STAGES as readonly string[]).includes(s)))];
    const materials = [...new Set(strs(sl.materials).filter((m): m is Material => (MATERIALS as readonly string[]).includes(m)))];
    const activities = [...new Set(strs(raw.stages).filter((s) => (ACTIVITIES as readonly string[]).includes(s)))];
    rows.push({
      sourceKey: key,
      name,
      summary: str(sl.summary) ?? str(raw.products_summary) ?? "",
      website: url(sl.website ?? raw.website),
      countryIso,
      hqCountry: str(raw.hq_country, 100),
      countries,
      region: str(raw.region, 40),
      stages,
      activities,
      materials,
      productionStatus: str(raw.production_status, 40),
      publicSources: strs(raw.public_sources).filter((s) => /^https?:\/\//.test(s)).slice(0, 20),
      published: sl.published === true,
    });
  }
  return { rows, rejected };
}

export interface ImportSummary {
  created: number;
  updated: number;
  protectedSkipped: number;
  hidden: number;
  rejected: ParseResult["rejected"];
  byRegion: Record<string, number>;
}

export async function importSeed(db: PrismaClient, parsed: ParseResult, opts: { publish?: boolean; hideMissing?: boolean } = {}): Promise<ImportSummary> {
  const summary: ImportSummary = { created: 0, updated: 0, protectedSkipped: 0, hidden: 0, rejected: parsed.rejected, byRegion: {} };
  for (const r of parsed.rows) {
    summary.byRegion[r.region ?? "unknown"] = (summary.byRegion[r.region ?? "unknown"] ?? 0) + 1;
    const c = r.countryIso ? COUNTRY_CENTROIDS[r.countryIso] : undefined;
    const data = {
      name: r.name,
      summary: r.summary,
      website: r.website,
      city: null,
      countryIso: r.countryIso,
      hqCountry: r.hqCountry,
      countries: r.countries,
      region: r.region,
      stages: r.stages,
      activities: r.activities,
      materials: r.materials,
      productionStatus: r.productionStatus,
      publicSources: r.publicSources,
      latitude: c ? c[0] : null,
      longitude: c ? c[1] : null,
      geocodeProvider: c ? "country-centroid" : null,
      listingStatus: "prospect" as const,
      isExample: false,
    };
    const existing = await db.supplierListing.findUnique({ where: { sourceKey: r.sourceKey } });
    if (!existing) {
      await db.supplierListing.create({ data: { ...data, sourceKey: r.sourceKey, published: opts.publish ? true : r.published, verifiedAt: null } });
      summary.created++;
    } else if (existing.orgId || existing.verifiedAt) {
      summary.protectedSkipped++;
    } else {
      await db.supplierListing.update({ where: { id: existing.id }, data: { ...data, ...(opts.publish ? { published: true } : {}) } });
      summary.updated++;
    }
  }
  if (opts.hideMissing !== false) {
    const keys = parsed.rows.map((r) => r.sourceKey);
    const res = await db.supplierListing.updateMany({
      where: { sourceKey: { not: null, notIn: keys }, orgId: null, verifiedAt: null, listingStatus: { not: "hidden" } },
      data: { listingStatus: "hidden", published: false },
    });
    summary.hidden = res.count;
  }
  return summary;
}
