/**
 * Supplier verification: a supplier pays a flat annual fee for Lodeline to
 * review the supplier's own upstream evidence.
 *
 * Flow:
 *   1. An admin starts a verification for a directory listing (usually one
 *      created from a supplier application). The tier and fee come from the
 *      number of facilities (src/services/pricing.ts).
 *   2. The supplier gets an email with a Stripe Checkout link and pays.
 *   3. On payment, the supplier gets a private upload link (same portal and
 *      review queue as buyer packs).
 *   4. A Lodeline reviewer accepts or rejects each claim as usual.
 *   5. If accepted evidence supports it, an admin marks the listing verified
 *      through DirectoryService.verify. That is a separate step.
 *   6. The admin closes the verification as complete, whatever the outcome.
 *
 * Conflict-of-interest rule: the fee pays for the review, not for passing.
 * Nothing in this file sets SupplierListing.verifiedAt, and completing a
 * verification does not depend on what the review found.
 */
import type { Prisma } from "@prisma/client";
import { ConflictError, NotFoundError, ValidationError } from "@/domain/errors";
import type { AuthContext } from "@/domain/types";
import { requireAdmin } from "./authorization";
import { normalizeEmail } from "./magic-link";
import { VERIFICATION_PERIOD_DAYS, usd, verificationTierFor } from "./pricing";
import { nowOf, type PlatformDeps } from "./deps";
import type { SupplierService } from "./suppliers";

const DAY = 86_400_000;

export class VerificationService {
  constructor(private readonly d: PlatformDeps, private readonly suppliers: SupplierService) {}

  /** Admin starts a paid verification for a listing and emails the supplier the payment link. */
  async create(ctx: AuthContext, listingId: string, input: { contactEmail?: unknown; contactName?: unknown; facilities?: unknown }) {
    const admin = requireAdmin(ctx);
    const listing = await this.d.db.supplierListing.findUnique({ where: { id: listingId } });
    if (!listing) throw new NotFoundError("LISTING_NOT_FOUND", "Listing not found.");
    if (listing.isExample) throw new ConflictError("LISTING_IS_EXAMPLE", "Example listings cannot be verified.");
    const contactEmail = normalizeEmail(input.contactEmail);
    const facilities = Number(input.facilities);
    const tier = verificationTierFor(facilities);
    if (!tier) throw new ValidationError("FACILITIES_INVALID", "Enter 1 to 8 facilities. More than 8 needs a quote.", "facilities");
    const open = await this.d.db.supplierVerification.findFirst({ where: { listingId, status: { in: ["pending_payment", "collecting"] } } });
    if (open) throw new ConflictError("VERIFICATION_OPEN", "This listing already has an open verification.");

    const v = await this.d.db.supplierVerification.create({
      data: {
        listingId,
        contactEmail,
        contactName: typeof input.contactName === "string" ? input.contactName.trim().slice(0, 120) || null : null,
        facilities,
        tier: tier.id,
        priceCents: tier.priceCents,
        createdById: admin.userId,
      },
    });
    await this.d.audit.append({ action: "verification.created", actorUserId: admin.userId, subjectId: v.id, payload: { listingId, tier: tier.id, priceCents: tier.priceCents } });

    const base = this.d.baseUrl.replace(/\/$/, "");
    const checkout = await this.d.billing.createCheckout({
      kind: "verification",
      refId: v.id,
      priceCents: tier.priceCents,
      productName: `Lodeline supplier verification: ${tier.label}, one year (${usd(tier.priceCents)})`,
      customerEmail: contactEmail,
      successUrl: `${base}/for-suppliers?verification=paid`,
      cancelUrl: `${base}/for-suppliers?verification=cancelled`,
    });
    await this.d.db.supplierVerification.update({ where: { id: v.id }, data: { stripeCheckoutId: checkout.id, checkoutUrl: checkout.url } });
    await this.d.audit.append({ action: "verification.checkout_started", actorUserId: admin.userId, subjectId: v.id, payload: { checkoutId: checkout.id, mode: this.d.billing.mode } });

    if (this.d.billing.mode === "dev") {
      await this.markPaid(v.id, checkout.id, tier.priceCents, `dev:verification:${v.id}`);
    } else {
      await this.d.email.send({
        to: contactEmail,
        subject: `Lodeline supplier verification for ${listing.name}`,
        text:
          `Hello ${v.contactName ?? listing.name},\n\n` +
          `Here is the payment link for your Lodeline supplier verification (${tier.label}, ${usd(tier.priceCents)} for one year):\n${checkout.url}\n\n` +
          `After payment you will get a private link to upload your origin documents. A Lodeline reviewer checks each one.\n\n` +
          `The fee covers the review, whatever it finds. It does not buy a verified status or a higher place in the directory.\n\n` +
          `Lodeline provides supply-chain documentation and analysis, not legal advice or government certification.\nQuestions: info@lodeline.org\n`,
      });
    }
    return { verificationId: v.id, checkoutUrl: checkout.url, tier: tier.id, priceCents: tier.priceCents };
  }

  /** Webhook (or dev billing): payment received. Idempotent by event id. Starts document collection. */
  async markPaid(verificationId: string, checkoutId: string, amountCents: number | undefined, eventId: string): Promise<boolean> {
    const fresh = await this.d.db.$transaction(async (tx) => {
      if (await tx.webhookEvent.findUnique({ where: { id: eventId } })) return false;
      await tx.webhookEvent.create({ data: { id: eventId, source: "stripe" } });
      const v = await tx.supplierVerification.findUnique({ where: { id: verificationId } });
      if (!v) throw new NotFoundError("VERIFICATION_NOT_FOUND", "Verification not found.");
      if (v.paidAt) return false;
      if (amountCents !== undefined && amountCents < v.priceCents) throw new ValidationError("AMOUNT_MISMATCH", "Paid amount is below the verification fee.");
      const paidAt = nowOf(this.d);
      await tx.supplierVerification.update({
        where: { id: verificationId },
        data: { paidAt, status: "collecting", stripeCheckoutId: checkoutId, periodEndsAt: new Date(paidAt.getTime() + VERIFICATION_PERIOD_DAYS * DAY) },
      });
      await tx.auditEntry.create({ data: { action: "verification.paid", subjectId: verificationId, payload: { checkoutId, amountCents: amountCents ?? null, eventId } as Prisma.InputJsonValue, createdAt: paidAt } });
      return true;
    });
    if (fresh) await this.suppliers.addVerificationRequest(verificationId);
    return fresh;
  }

  /** Admin closes a paid verification. The outcome does not matter: the review was done. */
  async complete(ctx: AuthContext, id: string, note?: unknown) {
    const admin = requireAdmin(ctx);
    const v = await this.d.db.supplierVerification.findUnique({ where: { id } });
    if (!v) throw new NotFoundError("VERIFICATION_NOT_FOUND", "Verification not found.");
    if (v.status !== "collecting") throw new ConflictError("VERIFICATION_NOT_COLLECTING", `Verification is ${v.status.replace("_", " ")}.`);
    const row = await this.d.db.supplierVerification.update({
      where: { id },
      data: { status: "complete", completedAt: nowOf(this.d), completedNote: typeof note === "string" ? note.trim().slice(0, 1000) || null : null },
    });
    await this.d.audit.append({ action: "verification.completed", actorUserId: admin.userId, subjectId: id, payload: { listingId: v.listingId } });
    return row;
  }

  /** Admin cancels an unpaid verification (for example, the supplier changed their mind). */
  async cancel(ctx: AuthContext, id: string) {
    const admin = requireAdmin(ctx);
    const v = await this.d.db.supplierVerification.findUnique({ where: { id } });
    if (!v) throw new NotFoundError("VERIFICATION_NOT_FOUND", "Verification not found.");
    if (v.paidAt) throw new ConflictError("VERIFICATION_PAID", "A paid verification cannot be cancelled here. Complete it, or refund in Stripe.");
    const row = await this.d.db.supplierVerification.update({ where: { id }, data: { status: "cancelled" } });
    await this.d.audit.append({ action: "verification.cancelled", actorUserId: admin.userId, subjectId: id, payload: { listingId: v.listingId } });
    return row;
  }

  async list(ctx: AuthContext) {
    requireAdmin(ctx);
    return this.d.db.supplierVerification.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { listing: { select: { id: true, name: true, verifiedAt: true } }, requests: { include: { documents: { select: { id: true, status: true } } } } },
    });
  }
}
