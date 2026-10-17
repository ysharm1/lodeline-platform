/**
 * Evidence packs: create from a free audit (buyer must hold the audit link
 * token), Stripe Checkout, webhook-driven payment, buyer view data.
 */
import type { Prisma } from "@prisma/client";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "@/domain/errors";
import type { AuthContext, Material, Stage } from "@/domain/types";
import { packPriceCents } from "@/infra/billing";
import { hashSessionToken } from "@/session/store";
import { buildPackMatrix, type MatrixClaim } from "./pack-matrix";
import { nowOf, type PlatformDeps } from "./deps";

export class PackService {
  constructor(private readonly d: PlatformDeps) {}

  /** Ensures the buyer has an Organization (created lazily on first pack). */
  private async orgFor(ctx: AuthContext, companyName: string | null): Promise<string> {
    if (ctx.orgId) return ctx.orgId;
    const org = await this.d.db.organization.create({ data: { name: companyName ?? ctx.email.split("@")[1], kind: "buyer", roles: ["buyer"] } });
    await this.d.db.user.update({ where: { id: ctx.userId }, data: { orgId: org.id } });
    // Dual-role ready: the creator is a buyer member and org admin; a seller role can be added later.
    await this.d.db.membership.create({ data: { userId: ctx.userId, orgId: org.id, roles: ["buyer"], isOrgAdmin: true } });
    return org.id;
  }

  async create(ctx: AuthContext, input: { auditId: unknown; accessToken: unknown }) {
    if (ctx.role !== "buyer" && ctx.role !== "admin") throw new AuthorizationError("ROLE_FORBIDDEN", "Only buyers can order evidence packs.");
    if (typeof input.auditId !== "string" || typeof input.accessToken !== "string") throw new ValidationError("AUDIT_REQUIRED", "auditId and accessToken are required.");
    const audit = await this.d.db.partsAudit.findUnique({ where: { id: input.auditId }, include: { pack: true } });
    if (!audit || audit.accessTokenHash !== hashSessionToken(input.accessToken)) throw new NotFoundError("AUDIT_NOT_FOUND", "Audit not found.");
    if (audit.status !== "classified") throw new ConflictError("AUDIT_NOT_READY", "The audit has not finished.");

    const orgId = await this.orgFor(ctx, audit.companyName);
    const existing = audit.pack;
    if (existing && existing.orgId !== orgId) throw new ConflictError("PACK_EXISTS", "A pack already exists for this audit.");
    const priceCents = this.d.packPriceCents ?? packPriceCents();
    const pack =
      existing ??
      (await this.d.db.evidencePack.create({ data: { auditId: audit.id, orgId, priceCents, status: "pending_payment", createdById: ctx.userId } }));
    if (!audit.orgId) await this.d.db.partsAudit.update({ where: { id: audit.id }, data: { orgId } });
    if (pack.paidAt) return { packId: pack.id, checkoutUrl: `${this.d.baseUrl}/buyer/packs/${pack.id}` };

    return this.startCheckout(ctx, pack);
  }

  /** (Re)starts Checkout for an unpaid pack the caller can access. */
  async checkout(ctx: AuthContext, packId: string) {
    const pack = await this.assertAccess(ctx, packId);
    if (pack.paidAt) return { packId: pack.id, checkoutUrl: `${this.d.baseUrl}/buyer/packs/${pack.id}` };
    return this.startCheckout(ctx, pack);
  }

  private async startCheckout(ctx: AuthContext, pack: { id: string; priceCents: number }) {
    const base = this.d.baseUrl.replace(/\/$/, "");
    const checkout = await this.d.billing.createCheckout({
      packId: pack.id,
      priceCents: pack.priceCents,
      customerEmail: ctx.email,
      successUrl: `${base}/buyer/packs/${pack.id}?paid=1`,
      cancelUrl: `${base}/buyer/packs/${pack.id}?cancelled=1`,
    });
    await this.d.db.evidencePack.update({ where: { id: pack.id }, data: { stripeCheckoutId: checkout.id } });
    await this.d.audit.append({ action: "pack.checkout_started", actorUserId: ctx.userId, subjectId: pack.id, payload: { checkoutId: checkout.id, priceCents: pack.priceCents, mode: this.d.billing.mode } });
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
