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

export interface ListingRow extends ListingForAnswer {
  website: string | null;
  verifiedAt: Date | null;
  rank: number;
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
    excludeCountries: arr("excludeCountry").map((c) => toIso2(c)).filter((c): c is string => !!c),
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
      { id: string; name: string; summary: string; website: string | null; city: string | null; countryIso: string | null; stages: string[]; materials: string[]; verifiedAt: Date | null; isExample: boolean; rank: number }[]
    >`SELECT "id", "name", "summary", "website", "city", "countryIso", "stages"::text[] AS "stages", "materials"::text[] AS "materials",
             "verifiedAt", "isExample", ${rank}::float8 AS "rank"
      FROM "SupplierListing"
      ${where.length ? Prisma.sql`WHERE ${Prisma.join(where, " AND ")}` : Prisma.empty}
      ORDER BY "rank" DESC, "verifiedAt" DESC NULLS LAST, "name" ASC
      LIMIT ${opts.limit ?? 50}`;
    return rows.map((r) => ({ ...r, verified: !!r.verifiedAt, rank: Number(r.rank) }));
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
      countries: [] as string[],
      published: input.published === true || input.published === "true" || input.published === "on",
      isExample: input.isExample === true || input.isExample === "true" || input.isExample === "on",
    };
  }

  async create(ctx: AuthContext, input: Record<string, unknown>) {
    const admin = requireAdmin(ctx);
    const data = this.parseListingInput(input);
    const row = await this.d.db.supplierListing.create({ data: { ...data, countries: data.countryIso ? [data.countryIso] : [] } });
    await this.d.audit.append({ action: "listing.created", actorUserId: admin.userId, subjectId: row.id, payload: { name: row.name } });
    return row;
  }

  async update(ctx: AuthContext, id: string, input: Record<string, unknown>) {
    const admin = requireAdmin(ctx);
    const data = this.parseListingInput(input);
    const row = await this.d.db.supplierListing.update({ where: { id }, data: { ...data, countries: data.countryIso ? [data.countryIso] : [] } }).catch(() => null);
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
    const docs = await this.d.db.evidenceDocument.findMany({ where: { id: { in: ids } }, include: { claims: { where: { reviewStatus: "accepted" } } } });
    const bad = ids.filter((i) => {
      const doc = docs.find((x) => x.id === i);
      return !doc || doc.status !== "accepted" || doc.claims.length === 0;
    });
    if (bad.length) throw new ValidationError("EVIDENCE_NOT_ACCEPTED", `Documents without accepted evidence: ${bad.join(", ")}`);
    const row = await this.d.db.supplierListing.update({
      where: { id },
      data: { verifiedAt: nowOf(this.d), verifiedFromDocumentIds: ids, verifiedFromClaimIds: docs.flatMap((x) => x.claims.map((c) => c.id)) },
    });
    await this.d.audit.append({ action: "listing.verified", actorUserId: admin.userId, subjectId: id, payload: { documentIds: ids } });
    return row;
  }
}
