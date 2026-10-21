/**
 * "Request intro": a signed-in buyer asks Lodeline to introduce it to a
 * marketplace listing. The request is stored as a ContactRequest and emailed
 * to the Lodeline team (LEADS_NOTIFY_EMAIL, default info@lodeline.org). The
 * buyer never sees supplier contact details; staff make the introduction.
 */
import { AuthorizationError, NotFoundError, ValidationError } from "@/domain/errors";
import type { AuthContext } from "@/domain/types";
import { requireAdmin } from "./authorization";
import { nowOf, type PlatformDeps } from "./deps";
import { ensureOrg } from "./orgs";

export const MAX_INTROS_PER_ORG_PER_DAY = 20;
const STATUSES = ["new", "introduced", "closed"] as const;

export class IntroService {
  constructor(
    private readonly d: PlatformDeps,
    private readonly notifyTo: string = process.env.LEADS_NOTIFY_EMAIL || "info@lodeline.org"
  ) {}

  async request(ctx: AuthContext, listingId: unknown, rawMessage: unknown) {
    if (ctx.role !== "buyer" && ctx.role !== "admin") throw new AuthorizationError("ROLE_FORBIDDEN", "Sign in with a company account to request an introduction.");
    if (typeof listingId !== "string" || !/^[0-9a-f-]{36}$/.test(listingId)) throw new NotFoundError("LISTING_NOT_FOUND", "Listing not found.");
    const listing = await this.d.db.supplierListing.findFirst({ where: { id: listingId, listingStatus: { not: "hidden" }, OR: [{ published: true }, { listingStatus: "prospect" }] } });
    if (!listing) throw new NotFoundError("LISTING_NOT_FOUND", "Listing not found.");
    if (listing.isExample) throw new ValidationError("EXAMPLE_LISTING", "This is a fictional example listing; there is no one to introduce.");
    const message = typeof rawMessage === "string" ? rawMessage.trim().slice(0, 2000) : "";
    const orgId = await ensureOrg(this.d, ctx, null, ["buyer"]);
    if (listing.orgId && listing.orgId === orgId) throw new ValidationError("OWN_LISTING", "This is your own listing.");
    const now = nowOf(this.d);
    const since = new Date(now.getTime() - 86_400_000);
    if ((await this.d.db.contactRequest.count({ where: { orgId, createdAt: { gte: since } } })) >= MAX_INTROS_PER_ORG_PER_DAY) {
      throw new ValidationError("INTRO_LIMIT", "Daily limit reached. Email info@lodeline.org for more introductions.");
    }
    const open = await this.d.db.contactRequest.findFirst({ where: { orgId, listingId, status: "new" } });
    if (open) return { request: open, duplicate: true, emailed: false };
    const row = await this.d.db.contactRequest.create({ data: { listingId, orgId, userId: ctx.userId, message } });
    await this.d.audit.append({ action: "intro.requested", actorUserId: ctx.userId, subjectId: row.id, payload: { listingId, orgId } });
    let emailed = false;
    try {
      const org = await this.d.db.organization.findUnique({ where: { id: orgId } });
      await this.d.email.send({
        to: this.notifyTo,
        subject: `Intro request: ${listing.name}`,
        text:
          `A buyer asked for an introduction through the marketplace.\n\n` +
          `Listing: ${listing.name} (${listing.listingStatus}${listing.verifiedAt ? ", verified" : ", unverified"})\n` +
          `Buyer org: ${org?.name ?? orgId}\nRequested by: ${ctx.email}\n\n` +
          `Message:\n${message || "(none)"}\n\n` +
          `Review: ${this.d.baseUrl.replace(/\/$/, "")}/admin/intros`,
      });
      emailed = true;
    } catch (e) {
      console.error(JSON.stringify({ event: "intro.notify_failed", requestId: row.id, error: (e as Error).message }));
    }
    return { request: row, duplicate: false, emailed };
  }

  async listForOrg(ctx: AuthContext) {
    if (!ctx.orgId) return [];
    return this.d.db.contactRequest.findMany({ where: { orgId: ctx.orgId }, orderBy: { createdAt: "desc" }, include: { listing: { select: { id: true, name: true } } } });
  }

  async listAll(ctx: AuthContext) {
    requireAdmin(ctx);
    return this.d.db.contactRequest.findMany({ orderBy: { createdAt: "desc" }, take: 200, include: { listing: { select: { id: true, name: true, listingStatus: true } }, org: { select: { name: true } }, user: { select: { email: true } } } });
  }

  async setStatus(ctx: AuthContext, id: string, status: unknown) {
    const admin = requireAdmin(ctx);
    if (typeof status !== "string" || !(STATUSES as readonly string[]).includes(status)) throw new ValidationError("STATUS_INVALID", "Unknown status.");
    const row = await this.d.db.contactRequest.update({ where: { id }, data: { status: status as (typeof STATUSES)[number], handledAt: status === "new" ? null : nowOf(this.d) } }).catch(() => null);
    if (!row) throw new NotFoundError("INTRO_NOT_FOUND", "Intro request not found.");
    await this.d.audit.append({ action: "intro.status", actorUserId: admin.userId, subjectId: id, payload: { status } });
    return row;
  }
}
