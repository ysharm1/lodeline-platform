/**
 * Supplier directory: Postgres full-text search + structured filters, an
 * "Ask" box (LLM -> filters -> DB rows -> answer citing only those rows), and
 * admin CRUD with verification tied to accepted evidence documents.
 */
import { Prisma } from "@prisma/client";
import { NotFoundError, ValidationError } from "@/domain/errors";
import { MATERIALS, STAGES, type AuthContext } from "@/domain/types";
import { requireAdmin } from "./authorization";
import { toIso2 } from "./countries";
import { directoryFiltersSchema, keywordParseDirectoryQuery, leftoverKeywords, type DirectoryFilters, type ListingForAnswer } from "./directory-query";
import { nowOf, type PlatformDeps } from "./deps";
import { hasActiveReuseConsent } from "./suppliers";
import { COVERED_COUNTRIES } from "./countries";
import { listingPosition } from "./geocoder";
import { ensureOrg, grantOrgRole } from "./orgs";
import { AuthorizationError } from "@/domain/errors";
import { matchPackRows, rankListings, type MatchListing, type PartMatches } from "./matchmaker";
import type { MatrixRow } from "./pack-matrix";
import type { Material, Stage } from "@/domain/types";
import { ACTIVITIES, type MarketplaceFilters } from "./marketplace";

export interface MarketplaceRow extends ListingRow {
  countries: string[];
  activities: string[];
  region: string | null;
  hqCountry: string | null;
  productionStatus: string | null;
  listingStatus: string;
}

export interface ListingRow extends ListingForAnswer {
  website: string | null;
  verifiedAt: Date | null;
  rank: number;
  latitude: number | null;
  longitude: number | null;
}

const FTS = Prisma.sql`to_tsvector('english', coalesce("name", '') || ' ' || coalesce("summary", '') || ' ' || coalesce("city", ''))`;

export function parseFilterParams(sp: Record<string, string | string[] | undefined>): DirectoryFilters {
  const arr = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v : v ? v.split(",") : []).map((x) => x.trim()).filter(Boolean);
  };
  return directoryFiltersSchema.parse({
    q: typeof sp.q === "string" ? sp.q.slice(0, 200) : "",
    materials: arr("material").filter((m) => (MATERIALS as readonly string[]).includes(m)),
    stages: arr("stage").filter((s) => (STAGES as readonly string[]).includes(s)),
    countries: arr("country").map((c) => toIso2(c)).filter((c): c is string => !!c),
    // excludeCovered=1: "China-free", i.e. outside every DFARS covered country (CN, RU, IR, KP).
    excludeCountries: [...new Set([...arr("excludeCountry").map((c) => toIso2(c)).filter((c): c is string => !!c), ...(sp.excludeCovered === "1" || sp.excludeCovered === "true" ? COVERED_COUNTRIES : [])])],
    verifiedOnly: sp.verified === "1" || sp.verified === "true",
  });
}

export class DirectoryService {
  constructor(private readonly d: PlatformDeps) {}

  async search(f: DirectoryFilters, opts: { includeUnpublished?: boolean; limit?: number } = {}): Promise<ListingRow[]> {
    const where: Prisma.Sql[] = [];
    if (!opts.includeUnpublished) where.push(Prisma.sql`"published" = true`);
    const q = f.q.trim();
    if (q) where.push(Prisma.sql`${FTS} @@ websearch_to_tsquery('english', ${q})`);
    if (f.materials.length) where.push(Prisma.sql`"materials" && ${f.materials}::"Material"[]`);
    if (f.stages.length) where.push(Prisma.sql`"stages" && ${f.stages}::"Stage"[]`);
    if (f.countries.length) where.push(Prisma.sql`"countryIso" = ANY(${f.countries}::text[])`);
    if (f.excludeCountries.length) where.push(Prisma.sql`("countryIso" IS NULL OR NOT ("countryIso" = ANY(${f.excludeCountries}::text[])))`);
    if (f.verifiedOnly) where.push(Prisma.sql`"verifiedAt" IS NOT NULL`);
    const rank = q ? Prisma.sql`ts_rank(${FTS}, websearch_to_tsquery('english', ${q}))` : Prisma.sql`0`;
    const rows = await this.d.db.$queryRaw<
      { id: string; name: string; summary: string; website: string | null; city: string | null; countryIso: string | null; stages: string[]; materials: string[]; verifiedAt: Date | null; isExample: boolean; rank: number; latitude: number | null; longitude: number | null }[]
    >`SELECT "id", "name", "summary", "website", "city", "countryIso", "stages"::text[] AS "stages", "materials"::text[] AS "materials",
             "verifiedAt", "isExample", "latitude", "longitude", ${rank}::float8 AS "rank"
      FROM "SupplierListing"
      ${where.length ? Prisma.sql`WHERE ${Prisma.join(where, " AND ")}` : Prisma.empty}
      -- Order by search relevance, then verified, then name. Never by payment:
      -- a supplier's verification fee must not affect its place (docs/business-model.md).
      ORDER BY "rank" DESC, "verifiedAt" DESC NULLS LAST, "name" ASC
      LIMIT ${opts.limit ?? 50}`;
    return rows.map((r) => ({ ...r, verified: !!r.verifiedAt, rank: Number(r.rank) }));
  }

  /**
   * Signed-in marketplace (/app/marketplace). Unlike `search`, it also returns
   * imported prospects (listingStatus = prospect), which are labelled
   * "Unverified, from public sources". Hidden rows never appear.
   */
  async marketplace(f: MarketplaceFilters, opts: { limit?: number } = {}): Promise<MarketplaceRow[]> {
    const where: Prisma.Sql[] = [Prisma.sql`"listingStatus" <> 'hidden'`, Prisma.sql`("published" = true OR "listingStatus" = 'prospect')`];
    const q = f.q.trim();
    if (q) where.push(Prisma.sql`${FTS} @@ websearch_to_tsquery('english', ${q})`);
    if (f.materials.length) where.push(Prisma.sql`"materials" && ${f.materials}::"Material"[]`);
    const stageOr: Prisma.Sql[] = [];
    if (f.stages.length) stageOr.push(Prisma.sql`"stages" && ${f.stages}::"Stage"[]`);
    if (f.activities.length) stageOr.push(Prisma.sql`"activities" && ${f.activities}::text[]`);
    if (stageOr.length) where.push(Prisma.sql`(${Prisma.join(stageOr, " OR ")})`);
    if (f.regions.length) where.push(Prisma.sql`"region" = ANY(${f.regions}::text[])`);
    if (f.countries.length) where.push(Prisma.sql`("countryIso" = ANY(${f.countries}::text[]) OR "countries" && ${f.countries}::text[])`);
    if (f.excludeCovered) where.push(Prisma.sql`("countryIso" IS NULL OR NOT ("countryIso" = ANY(${[...COVERED_COUNTRIES]}::text[]))) AND NOT ("countries" && ${[...COVERED_COUNTRIES]}::text[])`);
    if (f.status === "verified") where.push(Prisma.sql`"verifiedAt" IS NOT NULL`);
    if (f.status === "unverified") where.push(Prisma.sql`"verifiedAt" IS NULL`);
    if (f.status === "prospect") where.push(Prisma.sql`"listingStatus" = 'prospect' AND "verifiedAt" IS NULL`);
    const rank = q ? Prisma.sql`ts_rank(${FTS}, websearch_to_tsquery('english', ${q}))` : Prisma.sql`0`;
    const rows = await this.d.db.$queryRaw<(Omit<MarketplaceRow, "verified">)[]>`
      SELECT "id", "name", "summary", "website", "city", "countryIso", COALESCE("countries", ARRAY[]::text[]) AS "countries", "stages"::text[] AS "stages", "materials"::text[] AS "materials",
             COALESCE("activities", ARRAY[]::text[]) AS "activities", "region", "hqCountry", "productionStatus", "listingStatus"::text AS "listingStatus",
             "verifiedAt", "isExample", "latitude", "longitude", ${rank}::float8 AS "rank"
      FROM "SupplierListing"
      WHERE ${Prisma.join(where, " AND ")}
      ORDER BY "rank" DESC, "verifiedAt" DESC NULLS LAST, "isExample" ASC, "name" ASC
      LIMIT ${opts.limit ?? 300}`;
    return rows.map((r) => ({ ...r, verified: !!r.verifiedAt, rank: Number(r.rank) }));
  }

  /** One marketplace listing (published or prospect; never hidden). */
  async marketplaceListing(id: string) {
    if (!/^[0-9a-f-]{36}$/.test(id)) return null;
    return this.d.db.supplierListing.findFirst({ where: { id, listingStatus: { not: "hidden" }, OR: [{ published: true }, { listingStatus: "prospect" }] } });
  }

  /** Published listings outside the covered countries, for the matchmaker. */
  async matchCandidates(materials: string[]): Promise<MatchListing[]> {
    const mats = [...new Set(materials.filter((m) => (MATERIALS as readonly string[]).includes(m) && m !== "other"))];
    if (!mats.length) return [];
    const rows = await this.search({ q: "", materials: mats as DirectoryFilters["materials"], stages: [], countries: [], excludeCountries: [...COVERED_COUNTRIES], verifiedOnly: false }, { limit: 500 });
    return rows.map((r) => ({ id: r.id, name: r.name, city: r.city, countryIso: r.countryIso, stages: r.stages, materials: r.materials, verified: r.verified, isExample: r.isExample }));
  }

  /** Matchmaker suggestions for a pack's open stages (see matchmaker.ts). */
  async matchesForMatrix(rows: MatrixRow[]): Promise<PartMatches[]> {
    const candidates = await this.matchCandidates([...rows.flatMap((r) => r.part.materials), ...(rows.some((r) => !r.part.materials.filter((m) => m !== "other").length) ? ["ndfeb", "smco"] : [])]);
    return matchPackRows(rows, candidates);
  }

  /** Suggestions per material x stage (free-audit results, before a pack exists). */
  async matchesForNeeds(needs: { material: Material; stage: Stage }[]) {
    const candidates = await this.matchCandidates(needs.map((n) => n.material));
    return needs.map((n) => ({ ...n, suggestions: rankListings(candidates, n.material, n.stage) }));
  }

  /** The Ask box. The answer can only cite listings returned by the DB query. */
  async ask(question: unknown) {
    if (typeof question !== "string" || !question.trim()) throw new ValidationError("QUESTION_REQUIRED", "Ask a question.");
    const qn = question.trim().slice(0, 500);
    let filters: DirectoryFilters;
    try {
      filters = await this.d.llm.parseDirectoryQuery(qn);
    } catch {
      filters = keywordParseDirectoryQuery(qn); // LLM disabled/unavailable
    }
    if (!filters.q) filters = { ...filters, q: "" };
    let rows = await this.search(filters, { limit: 10 });
    const kw = leftoverKeywords(qn);
    if (rows.length === 0 && filters.q) rows = await this.search({ ...filters, q: "" }, { limit: 10 });
    let answer: { answer: string; citedIds: string[]; mode: string };
    try {
      answer = await this.d.llm.answerFromListings(qn, rows);
    } catch {
      const { templateAnswer } = await import("./directory-query");
      answer = rows.length ? { ...templateAnswer(rows), mode: "mock" } : { answer: "No listings in the directory match that question.", citedIds: [], mode: "mock" };
    }
    const allowed = new Set(rows.map((r) => r.id));
    return { filters, keywords: kw, rows, answer: answer.answer, citedIds: answer.citedIds.filter((id) => allowed.has(id)), mode: answer.mode };
  }

  private parseListingInput(input: Record<string, unknown>) {
    const str = (k: string, max = 300) => (typeof input[k] === "string" && (input[k] as string).trim() ? (input[k] as string).trim().slice(0, max) : null);
    const list = (k: string, allowed: readonly string[]) => (Array.isArray(input[k]) ? (input[k] as unknown[]) : typeof input[k] === "string" ? (input[k] as string).split(",") : []).map((x) => String(x).trim()).filter((x) => allowed.includes(x));
    const name = str("name", 200);
    if (!name) throw new ValidationError("NAME_REQUIRED", "Name is required.", "name");
    const website = str("website", 300);
    if (website && !/^https?:\/\//.test(website)) throw new ValidationError("WEBSITE_INVALID", "Website must start with http(s)://", "website");
    return {
      name,
      summary: str("summary", 2000) ?? "",
      website,
      city: str("city", 100),
      countryIso: toIso2(str("country", 60)),
      stages: list("stages", STAGES) as (typeof STAGES)[number][],
      materials: list("materials", MATERIALS) as (typeof MATERIALS)[number][],
      // Only touched when the caller sends it, so admin edits keep imported activities.
      ...(input.activities !== undefined ? { activities: list("activities", ACTIVITIES) } : {}),
      countries: [] as string[],
      published: input.published === true || input.published === "true" || input.published === "on",
      isExample: input.isExample === true || input.isExample === "true" || input.isExample === "on",
    };
  }

  /**
   * A signed-in buyer lists what its own company supplies. The organization
   * gains the seller role (it keeps buying). The listing starts unpublished and
   * unverified: Lodeline staff publish it from /admin/suppliers, and only
   * accepted, reusable evidence can verify it.
   */
  async submitOwn(ctx: AuthContext, input: Record<string, unknown>) {
    if (ctx.role !== "buyer" && ctx.role !== "admin") throw new AuthorizationError("ROLE_FORBIDDEN", "Sign in with a company account to list your supplies.");
    const data = this.parseListingInput(input);
    if ((!data.stages.length && !data.activities?.length) || !data.materials.length) throw new ValidationError("SCOPE_REQUIRED", "Choose at least one stage (or recycling / distribution) and one material you supply.", "stages");
    const orgId = await ensureOrg(this.d, ctx, data.name, ["buyer", "seller"]);
    await grantOrgRole(this.d, ctx.userId, orgId, "seller");
    const count = await this.d.db.supplierListing.count({ where: { orgId } });
    if (count >= 20) throw new ValidationError("LISTING_LIMIT", "Contact info@lodeline.org to list more than 20 entries.");
    const pos = await listingPosition(this.d.geocoder, data.city, data.countryIso);
    const row = await this.d.db.supplierListing.create({
      data: { ...data, ...pos, orgId, published: false, isExample: false, verifiedAt: null, countries: data.countryIso ? [data.countryIso] : [] },
    });
    await this.d.audit.append({ action: "listing.submitted_by_org", actorUserId: ctx.userId, subjectId: row.id, payload: { orgId, name: row.name } });
    return row;
  }

  async listOwn(ctx: AuthContext) {
    if (!ctx.orgId) return [];
    return this.d.db.supplierListing.findMany({ where: { orgId: ctx.orgId }, orderBy: { createdAt: "desc" } });
  }

  async create(ctx: AuthContext, input: Record<string, unknown>) {
    const admin = requireAdmin(ctx);
    const data = this.parseListingInput(input);
    const pos = await listingPosition(this.d.geocoder, data.city, data.countryIso);
    const row = await this.d.db.supplierListing.create({ data: { ...data, ...pos, countries: data.countryIso ? [data.countryIso] : [] } });
    await this.d.audit.append({ action: "listing.created", actorUserId: admin.userId, subjectId: row.id, payload: { name: row.name } });
    return row;
  }

  async update(ctx: AuthContext, id: string, input: Record<string, unknown>) {
    const admin = requireAdmin(ctx);
    const data = this.parseListingInput(input);
    const pos = await listingPosition(this.d.geocoder, data.city, data.countryIso);
    const row = await this.d.db.supplierListing.update({ where: { id }, data: { ...data, ...pos, countries: data.countryIso ? [data.countryIso] : [] } }).catch(() => null);
    if (!row) throw new NotFoundError("LISTING_NOT_FOUND", "Listing not found.");
    await this.d.audit.append({ action: "listing.updated", actorUserId: admin.userId, subjectId: id, payload: { name: row.name, published: row.published } });
    return row;
  }

  async remove(ctx: AuthContext, id: string) {
    const admin = requireAdmin(ctx);
    await this.d.db.referral.deleteMany({ where: { listingId: id, status: "intro" } });
    const r = await this.d.db.supplierListing.deleteMany({ where: { id } });
    if (!r.count) throw new NotFoundError("LISTING_NOT_FOUND", "Listing not found.");
    await this.d.audit.append({ action: "listing.deleted", actorUserId: admin.userId, subjectId: id });
  }

  /**
   * Verification is only possible from ACCEPTED evidence documents (each with
   * >= 1 accepted claim). Passing [] clears verification.
   *
   * Each document must also be one Lodeline is allowed to reuse:
   *   - it came from this listing's own supplier verification, or
   *   - the supplier gave reuse consent on the upload page (and has not withdrawn it).
   * Documents collected for one buyer's pack without consent stay with that buyer.
   *
   * Payment plays no part here: a paid verification does not make a listing
   * verified, and an unpaid supplier can be verified from consented evidence.
   */
  async verify(ctx: AuthContext, id: string, documentIds: unknown) {
    const admin = requireAdmin(ctx);
    const ids = Array.isArray(documentIds) ? [...new Set(documentIds.filter((x): x is string => typeof x === "string"))] : [];
    const listing = await this.d.db.supplierListing.findUnique({ where: { id } });
    if (!listing) throw new NotFoundError("LISTING_NOT_FOUND", "Listing not found.");
    if (ids.length === 0) {
      const row = await this.d.db.supplierListing.update({ where: { id }, data: { verifiedAt: null, verifiedFromDocumentIds: [], verifiedFromClaimIds: [] } });
      await this.d.audit.append({ action: "listing.verified", actorUserId: admin.userId, subjectId: id, payload: { cleared: true } });
      return row;
    }
    const docs = await this.d.db.evidenceDocument.findMany({
      where: { id: { in: ids } },
      include: { claims: { where: { reviewStatus: "accepted" } }, request: { include: { verification: { select: { listingId: true } } } } },
    });
    const bad = ids.filter((i) => {
      const doc = docs.find((x) => x.id === i);
      return !doc || doc.status !== "accepted" || doc.claims.length === 0;
    });
    if (bad.length) throw new ValidationError("EVIDENCE_NOT_ACCEPTED", `Documents without accepted evidence: ${bad.join(", ")}`);
    const noConsent = docs.filter((doc) => doc.request.verification?.listingId !== id && !hasActiveReuseConsent(doc.request)).map((d) => d.id);
    if (noConsent.length) throw new ValidationError("REUSE_CONSENT_REQUIRED", `The supplier has not allowed these documents to be reused: ${noConsent.join(", ")}`);
    const row = await this.d.db.supplierListing.update({
      where: { id },
      data: { verifiedAt: nowOf(this.d), verifiedFromDocumentIds: ids, verifiedFromClaimIds: docs.flatMap((x) => x.claims.map((c) => c.id)) },
    });
    await this.d.audit.append({ action: "listing.verified", actorUserId: admin.userId, subjectId: id, payload: { documentIds: ids } });
    return row;
  }
}
