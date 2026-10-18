/**
 * Evidence packs: create from a free audit (buyer must hold the audit link
 * token), Stripe Checkout, webhook-driven payment, buyer view data.
 *
 * Pricing (src/services/pricing.ts): the tier is picked from the audit's
 * scope when the pack is ordered. Starter and Standard are sold through
 * checkout; a scope larger than Standard needs a quote from the team.
 */
import type { Prisma } from "@prisma/client";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "@/domain/errors";
import type { AuthContext, Material, Stage } from "@/domain/types";
import { packTier, scopeOfParts, tierForScope, usd } from "./pricing";
import { requireAdmin } from "./authorization";
import { ensureOrg } from "./orgs";
import { hashSessionToken } from "@/session/store";
import { buildPackMatrix, type MatrixClaim } from "./pack-matrix";
import { nowOf, type PlatformDeps } from "./deps";

export class PackService {
  constructor(private readonly d: PlatformDeps) {}

  /** Ensures the buyer has an Organization (created lazily on first pack). */
  private async orgFor(ctx: AuthContext, companyName: string | null): Promise<string> {
    return ensureOrg(this.d, ctx, companyName, ["buyer"]);
  }

  async create(ctx: AuthContext, input: { auditId: unknown; accessToken: unknown }) {
    if (ctx.role !== "buyer" && ctx.role !== "admin") throw new AuthorizationError("ROLE_FORBIDDEN", "Only buyers can order evidence packs.");
    if (typeof input.auditId !== "string" || typeof input.accessToken !== "string") throw new ValidationError("AUDIT_REQUIRED", "auditId and accessToken are required.");
    const audit = await this.d.db.partsAudit.findUnique({ where: { id: input.auditId }, include: { pack: true, parts: { select: { coverage: true, supplierName: true } } } });
    if (!audit || audit.accessTokenHash !== hashSessionToken(input.accessToken)) throw new NotFoundError("AUDIT_NOT_FOUND", "Audit not found.");
    if (audit.status !== "classified") throw new ConflictError("AUDIT_NOT_READY", "The audit has not finished.");

    // Pick the smallest tier that fits the parts and suppliers in this audit.
    // A scope larger than Standard is Custom: sold at the fixed price staff quoted for this audit.
    const tier = tierForScope(scopeOfParts(audit.parts));
    const priceCents = tier.priceCents ?? audit.quotedPriceCents ?? null;
    if (priceCents === null && !audit.pack) {
      await this.d.audit.append({ action: "pack.quote_required", actorUserId: ctx.userId, subjectId: audit.id, payload: scopeOfParts(audit.parts) });
      throw new ConflictError(
        "QUOTE_REQUIRED",
        `This parts list is larger than the Standard pack (${packTier("standard").maxParts} parts, ${packTier("standard").maxSuppliers} suppliers). Request a readiness call and we will send a fixed quote.`
      );
    }

    const orgId = await this.orgFor(ctx, audit.companyName);
    const existing = audit.pack;
    if (existing && existing.orgId !== orgId) throw new ConflictError("PACK_EXISTS", "A pack already exists for this audit.");
    const pack =
      existing ??
      (await this.d.db.evidencePack.create({ data: { auditId: audit.id, orgId, tier: tier.id, priceCents: priceCents!, status: "pending_payment", createdById: ctx.userId } }));
    if (!audit.orgId) await this.d.db.partsAudit.update({ where: { id: audit.id }, data: { orgId } });
    if (pack.paidAt) return { packId: pack.id, checkoutUrl: `${this.d.baseUrl}/buyer/packs/${pack.id}` };

    return this.startCheckout(ctx, pack);
  }

  /**
   * Staff set a fixed Custom-tier quote for an audit larger than Standard.
   * The buyer can then order the pack from the results page at that price.
   */
  async setQuote(ctx: AuthContext, auditId: string, input: { priceCents?: unknown; maxSuppliers?: unknown }) {
    const admin = requireAdmin(ctx);
    const audit = await this.d.db.partsAudit.findUnique({ where: { id: auditId }, include: { pack: true, parts: { select: { coverage: true, supplierName: true } } } });
    if (!audit) throw new NotFoundError("AUDIT_NOT_FOUND", "Audit not found.");
    if (audit.pack) throw new ConflictError("PACK_EXISTS", "A pack was already ordered for this audit.");
    const scope = scopeOfParts(audit.parts);
    if (tierForScope(scope).id !== "custom") throw new ConflictError("QUOTE_NOT_NEEDED", "This audit fits a standard tier; no quote is needed.");
    const priceCents = Number(input.priceCents);
    if (!Number.isInteger(priceCents) || priceCents < 500_000 || priceCents > 100_000_000) throw new ValidationError("PRICE_INVALID", "Quote must be a whole number of cents, at least the Standard price.", "priceCents");
    const maxSuppliers = input.maxSuppliers === undefined || input.maxSuppliers === null || input.maxSuppliers === "" ? Math.max(scope.suppliers, 1) : Number(input.maxSuppliers);
    if (!Number.isInteger(maxSuppliers) || maxSuppliers < 1 || maxSuppliers > 500) throw new ValidationError("MAX_SUPPLIERS_INVALID", "Supplier limit must be 1 to 500.", "maxSuppliers");
    const row = await this.d.db.partsAudit.update({ where: { id: auditId }, data: { quotedPriceCents: priceCents, quotedMaxSuppliers: maxSuppliers, quotedAt: nowOf(this.d), quotedById: admin.userId } });
    await this.d.audit.append({ action: "pack.quoted", actorUserId: admin.userId, subjectId: auditId, payload: { priceCents, maxSuppliers, ...scope } });
    return { auditId: row.id, quotedPriceCents: priceCents, quotedMaxSuppliers: maxSuppliers };
  }

  /** Audits too large for Standard with no pack yet: the staff quote queue. */
  async quoteQueue(ctx: AuthContext) {
    requireAdmin(ctx);
    const audits = await this.d.db.partsAudit.findMany({
      where: { status: "classified", pack: null },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { parts: { select: { coverage: true, supplierName: true } } },
    });
    return audits
      .map((a) => ({ id: a.id, leadEmail: a.leadEmail, companyName: a.companyName, sourceFileName: a.sourceFileName, createdAt: a.createdAt, quotedPriceCents: a.quotedPriceCents, quotedMaxSuppliers: a.quotedMaxSuppliers, scope: scopeOfParts(a.parts) }))
      .filter((a) => tierForScope(a.scope).id === "custom");
  }

  /** Most suppliers a pack may contact: the tier limit, or the quoted limit for Custom. */
  async supplierLimit(pack: { tier: string; auditId: string }): Promise<number> {
    const tier = packTier(pack.tier as "starter");
    if (Number.isFinite(tier.maxSuppliers)) return tier.maxSuppliers;
    const audit = await this.d.db.partsAudit.findUnique({ where: { id: pack.auditId }, select: { quotedMaxSuppliers: true } });
    return audit?.quotedMaxSuppliers ?? Number.POSITIVE_INFINITY;
  }

  /** (Re)starts Checkout for an unpaid pack the caller can access. */
  async checkout(ctx: AuthContext, packId: string) {
    const pack = await this.assertAccess(ctx, packId);
    if (pack.paidAt) return { packId: pack.id, checkoutUrl: `${this.d.baseUrl}/buyer/packs/${pack.id}` };
    return this.startCheckout(ctx, pack);
  }

  private async startCheckout(ctx: AuthContext, pack: { id: string; priceCents: number; tier: string }) {
    const base = this.d.baseUrl.replace(/\/$/, "");
    const checkout = await this.d.billing.createCheckout({
      kind: "pack",
      refId: pack.id,
      priceCents: pack.priceCents,
      productName: `Lodeline evidence pack: ${packTier(pack.tier as "starter").label} (${usd(pack.priceCents)} fixed fee)`,
      customerEmail: ctx.email,
      successUrl: `${base}/buyer/packs/${pack.id}?paid=1`,
      cancelUrl: `${base}/buyer/packs/${pack.id}?cancelled=1`,
    });
    await this.d.db.evidencePack.update({ where: { id: pack.id }, data: { stripeCheckoutId: checkout.id } });
    await this.d.audit.append({ action: "pack.checkout_started", actorUserId: ctx.userId, subjectId: pack.id, payload: { checkoutId: checkout.id, tier: pack.tier, priceCents: pack.priceCents, mode: this.d.billing.mode } });
    if (this.d.billing.mode === "dev") await this.markPaid(pack.id, checkout.id, pack.priceCents, `dev:${pack.id}:${checkout.id}`);
    return { packId: pack.id, checkoutUrl: checkout.url };
  }

  /** Idempotent: replays of the same webhook event or a second payment are no-ops. */
  async markPaid(packId: string, checkoutId: string, amountCents: number | undefined, eventId: string): Promise<boolean> {
    return this.d.db.$transaction(async (tx) => {
      const seen = await tx.webhookEvent.findUnique({ where: { id: eventId } });
      if (seen) return false;
      await tx.webhookEvent.create({ data: { id: eventId, source: "stripe" } });
      const pack = await tx.evidencePack.findUnique({ where: { id: packId } });
      if (!pack) throw new NotFoundError("PACK_NOT_FOUND", "Pack not found.");
      if (pack.paidAt) return false;
      if (amountCents !== undefined && amountCents < pack.priceCents) throw new ValidationError("AMOUNT_MISMATCH", "Paid amount is below the pack price.");
      await tx.evidencePack.update({ where: { id: packId }, data: { paidAt: nowOf(this.d), status: "collecting", stripeCheckoutId: checkoutId } });
      await tx.auditEntry.create({ data: { action: "pack.paid", subjectId: packId, payload: { checkoutId, amountCents: amountCents ?? null, eventId } as Prisma.InputJsonValue, createdAt: nowOf(this.d) } });
      return true;
    });
  }

  async assertAccess(ctx: AuthContext, packId: string) {
    const pack = await this.d.db.evidencePack.findUnique({ where: { id: packId } });
    if (!pack || (ctx.role !== "admin" && pack.orgId !== ctx.orgId)) throw new NotFoundError("PACK_NOT_FOUND", "Pack not found.");
    return pack;
  }

  async listForBuyer(ctx: AuthContext) {
    if (!ctx.orgId && ctx.role !== "admin") return [];
    return this.d.db.evidencePack.findMany({
      where: ctx.role === "admin" ? {} : { orgId: ctx.orgId! },
      orderBy: { createdAt: "desc" },
      include: { audit: { select: { sourceFileName: true, rowCount: true } } },
    });
  }

  /** Everything the buyer page / PDF needs. Only ACCEPTED claims are exposed as evidence. */
  async view(packId: string) {
    const pack = await this.d.db.evidencePack.findUnique({
      where: { id: packId },
      include: {
        org: true,
        audit: { include: { parts: { orderBy: { rowIndex: "asc" } } } },
        requests: { include: { supplier: true, documents: { include: { claims: true } } } },
      },
    });
    if (!pack) throw new NotFoundError("PACK_NOT_FOUND", "Pack not found.");
    const claims = pack.requests.flatMap((r) => r.documents.flatMap((doc) => doc.claims.map((c) => ({ ...c, requestId: r.id, document: doc, supplier: r.supplier }))));
    const matrix = buildPackMatrix(
      pack.audit.parts.map((p) => ({ id: p.id, partNumber: p.partNumber, description: p.description, supplierName: p.supplierName, materials: p.materials as Material[], coverage: p.coverage })),
      pack.requests.map((r) => ({ id: r.id, partIds: r.partIds, stagesRequested: r.stagesRequested as Stage[], revoked: !!r.revokedAt })),
      claims.map((c): MatrixClaim => ({ id: c.id, requestId: c.requestId, partId: c.partId, stage: c.stage as Stage | null, reviewStatus: c.reviewStatus, coveredCountry: c.coveredCountry }))
    );
    const accepted = claims.filter((c) => c.reviewStatus === "accepted");
    return { pack, matrix, accepted, requests: pack.requests };
  }
}
