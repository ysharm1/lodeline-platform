/**
 * Refresh plans: a buyer pays monthly to keep one evidence pack current.
 * Supplier documents go stale, suppliers change and new parts come in, so
 * Lodeline re-checks the pack on a fixed interval (quarterly by default).
 *
 * Flow:
 *   1. On a paid pack, the buyer chooses "Keep this pack current".
 *   2. Stripe Checkout runs in subscription mode at the plan's monthly price.
 *   3. The webhook activates the plan and sets the first due date.
 *   4. The admin "Refresh plans" page lists plans that are due. After
 *      re-checking a pack, the admin marks it refreshed, which sets the next date.
 *   5. If the buyer cancels in Stripe, the webhook marks the plan cancelled.
 * Prices: src/services/pricing.ts (REFRESH_PLANS). Custom packs get a quoted plan.
 */
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { ConflictError, NotFoundError } from "@/domain/errors";
import type { AuthContext } from "@/domain/types";
import { requireAdmin } from "./authorization";
import { refreshPlanFor, usd } from "./pricing";
import { nowOf, type PlatformDeps } from "./deps";
import type { PackService } from "./packs";

const DAY = 86_400_000;

export class RefreshService {
  constructor(private readonly d: PlatformDeps, private readonly packs: PackService) {}

  /** Buyer starts (or restarts) a refresh plan for a paid pack. Returns the checkout URL. */
  async start(ctx: AuthContext, packId: string) {
    const pack = await this.packs.assertAccess(ctx, packId);
    if (!pack.paidAt) throw new ConflictError("PACK_NOT_PAID", "Pay for the pack before adding a refresh plan.");
    const plan = refreshPlanFor(pack.tier);
    if (!plan) throw new ConflictError("QUOTE_REQUIRED", "Refresh for a custom pack is quoted. Contact info@lodeline.org.");
    const existing = await this.d.db.refreshSubscription.findUnique({ where: { packId } });
    if (existing?.status === "active") throw new ConflictError("REFRESH_ACTIVE", "This pack already has an active refresh plan.");

    const row = existing
      ? await this.d.db.refreshSubscription.update({ where: { id: existing.id }, data: { status: "pending", monthlyCents: plan.monthlyCents, intervalDays: plan.intervalDays, cancelledAt: null } })
      : await this.d.db.refreshSubscription.create({
          data: { packId, orgId: pack.orgId, tier: pack.tier, monthlyCents: plan.monthlyCents, intervalDays: plan.intervalDays, createdById: ctx.userId },
        });
    const base = this.d.baseUrl.replace(/\/$/, "");
    const checkout = await this.d.billing.createCheckout({
      kind: "refresh",
      refId: row.id,
      priceCents: plan.monthlyCents,
      monthly: true,
      productName: `Lodeline ${plan.label} (${usd(plan.monthlyCents)}/month)`,
      customerEmail: ctx.email,
      successUrl: `${base}/buyer/packs/${packId}?refresh=1`,
      cancelUrl: `${base}/buyer/packs/${packId}`,
    });
    await this.d.db.refreshSubscription.update({ where: { id: row.id }, data: { stripeCheckoutId: checkout.id } });
    await this.d.audit.append({ action: "refresh.checkout_started", actorUserId: ctx.userId, subjectId: row.id, payload: { packId, monthlyCents: plan.monthlyCents, mode: this.d.billing.mode } });
    // Dev billing has no real events; each start gets its own id so a restarted plan is not treated as a replay.
    if (this.d.billing.mode === "dev") await this.activate(row.id, checkout.id, checkout.subscriptionId, `dev:refresh:${row.id}:${randomUUID()}`);
    return { refreshId: row.id, checkoutUrl: checkout.url };
  }

  /** Webhook (or dev billing): first payment received. Idempotent by event id. */
  async activate(refreshId: string, checkoutId: string, subscriptionId: string | undefined, eventId: string): Promise<boolean> {
    return this.d.db.$transaction(async (tx) => {
      if (await tx.webhookEvent.findUnique({ where: { id: eventId } })) return false;
      await tx.webhookEvent.create({ data: { id: eventId, source: "stripe" } });
      const r = await tx.refreshSubscription.findUnique({ where: { id: refreshId } });
      if (!r) throw new NotFoundError("REFRESH_NOT_FOUND", "Refresh plan not found.");
      if (r.status === "active") return false;
      const now = nowOf(this.d);
      await tx.refreshSubscription.update({
        where: { id: refreshId },
        data: { status: "active", startedAt: now, stripeCheckoutId: checkoutId, stripeSubscriptionId: subscriptionId ?? null, nextRefreshDueAt: new Date(now.getTime() + r.intervalDays * DAY) },
      });
      await tx.auditEntry.create({ data: { action: "refresh.activated", subjectId: refreshId, payload: { checkoutId, subscriptionId: subscriptionId ?? null, eventId } as Prisma.InputJsonValue, createdAt: now } });
      return true;
    });
  }

  /** Webhook: the buyer cancelled (or Stripe ended) the subscription. Idempotent. */
  async end(subscriptionId: string, eventId: string): Promise<boolean> {
    return this.d.db.$transaction(async (tx) => {
      if (await tx.webhookEvent.findUnique({ where: { id: eventId } })) return false;
      await tx.webhookEvent.create({ data: { id: eventId, source: "stripe" } });
      const r = await tx.refreshSubscription.findUnique({ where: { stripeSubscriptionId: subscriptionId } });
      if (!r || r.status === "cancelled") return false;
      const now = nowOf(this.d);
      await tx.refreshSubscription.update({ where: { id: r.id }, data: { status: "cancelled", cancelledAt: now, nextRefreshDueAt: null } });
      await tx.auditEntry.create({ data: { action: "refresh.cancelled", subjectId: r.id, payload: { subscriptionId, eventId } as Prisma.InputJsonValue, createdAt: now } });
      return true;
    });
  }

  /** Admin: the pack was re-checked. Sets the next due date one interval from now. */
  async markRefreshed(ctx: AuthContext, refreshId: string) {
    const admin = requireAdmin(ctx);
    const r = await this.d.db.refreshSubscription.findUnique({ where: { id: refreshId } });
    if (!r) throw new NotFoundError("REFRESH_NOT_FOUND", "Refresh plan not found.");
    if (r.status !== "active") throw new ConflictError("REFRESH_NOT_ACTIVE", "Only an active plan can be marked refreshed.");
    const now = nowOf(this.d);
    const row = await this.d.db.refreshSubscription.update({ where: { id: refreshId }, data: { lastRefreshedAt: now, nextRefreshDueAt: new Date(now.getTime() + r.intervalDays * DAY) } });
    await this.d.audit.append({ action: "refresh.completed", actorUserId: admin.userId, subjectId: refreshId, payload: { packId: r.packId } });
    return row;
  }

  async forPack(packId: string) {
    return this.d.db.refreshSubscription.findUnique({ where: { packId } });
  }

  /** Admin list: grouped by status (pending, active, cancelled), soonest due first. */
  async list(ctx: AuthContext) {
    requireAdmin(ctx);
    return this.d.db.refreshSubscription.findMany({
      orderBy: [{ status: "asc" }, { nextRefreshDueAt: "asc" }],
      take: 200,
      include: { pack: { include: { org: { select: { name: true } }, audit: { select: { sourceFileName: true } } } } },
    });
  }
}
