/**
 * Business model update (docs/business-model.md), end to end against Postgres:
 * pack tiers, supplier reuse consent, supplier-paid verification and buyer
 * refresh plans. Uses DevBilling, which completes checkouts immediately.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testPrisma } from "../../test/db";
import { makeDeps } from "../../test/deps";
import type { AuthContext } from "@/domain/types";
import { FreeAuditService } from "./free-audit";
import { PackService } from "./packs";
import { SupplierService } from "./suppliers";
import { DirectoryService } from "./directory";
import { VerificationService } from "./verifications";
import { RefreshService } from "./refresh";

const db = testPrisma();
beforeEach(resetDb);

let clock = new Date("2026-10-18T16:00:00Z");
const now = () => clock;
const DAY = 86_400_000;

async function setup(rows: string[]) {
  clock = new Date("2026-10-18T16:00:00Z");
  const t = makeDeps(db, { now });
  const packs = new PackService(t.deps);
  const suppliers = new SupplierService(t.deps, packs);
  const directory = new DirectoryService(t.deps);
  const verifications = new VerificationService(t.deps, suppliers);
  const refresh = new RefreshService(t.deps, packs);
  const fa = new FreeAuditService({ repo: t.repo, storage: t.storage, audit: t.deps.audit, llm: t.deps.llm });
  const csv = new TextEncoder().encode(["Part Number,Description,Supplier", ...rows].join("\n") + "\n");
  const { auditId, accessToken } = await fa.run({ fileName: "bom.csv", bytes: csv, leadEmail: "buyer@example.com", companyName: "Example Buyer Inc" });
  const buyerUser = await db.user.create({ data: { email: "buyer@example.com", role: "buyer" } });
  const adminUser = await db.user.create({ data: { email: "admin@example.com", role: "admin" } });
  const buyer: AuthContext = { userId: buyerUser.id, role: "buyer", orgId: null, email: buyerUser.email };
  const admin: AuthContext = { userId: adminUser.id, role: "admin", orgId: null, email: adminUser.email };
  return { ...t, packs, suppliers, directory, verifications, refresh, auditId, accessToken, buyer, admin };
}

const motorRows = (n: number, suppliers = 1) => Array.from({ length: n }, (_, i) => `M-${i + 1},BLDC motor,Example Motors ${i % suppliers}`);
const tokenFrom = (text: string) => text.match(/\/s\/([A-Za-z0-9_-]{43})/)![1];

describe("pack tiers (Postgres)", () => {
  it("a small audit is a $2,500 Starter pack limited to 3 suppliers", async () => {
    const s = await setup(motorRows(2));
    const { packId } = await s.packs.create(s.buyer, { auditId: s.auditId, accessToken: s.accessToken });
    expect(await db.evidencePack.findUniqueOrThrow({ where: { id: packId } })).toMatchObject({ tier: "starter", priceCents: 250000, status: "collecting" });
    const buyer = { ...s.buyer, orgId: (await db.user.findUniqueOrThrow({ where: { id: s.buyer.userId } })).orgId };
    const motor = await db.auditPart.findFirstOrThrow({ where: { auditId: s.auditId, partNumber: "M-1" } });
    for (const n of ["A", "B", "C"]) await s.suppliers.addRequest(buyer, packId, { name: n, contactEmail: `${n}@x.test`, partIds: [motor.id] });
    await expect(s.suppliers.addRequest(buyer, packId, { name: "D", contactEmail: "d@x.test", partIds: [motor.id] })).rejects.toMatchObject({ code: "TIER_SUPPLIER_LIMIT" });
    // Revoking a link frees the slot.
    const first = await db.supplierRequest.findFirstOrThrow({ where: { packId } });
    await s.suppliers.revoke(buyer, first.id);
    await s.suppliers.addRequest(buyer, packId, { name: "D", contactEmail: "d@x.test", partIds: [motor.id] });
  });

  it("6 to 15 parts is a $5,000 Standard pack", async () => {
    const s = await setup(motorRows(8, 2));
    const { packId } = await s.packs.create(s.buyer, { auditId: s.auditId, accessToken: s.accessToken });
    expect(await db.evidencePack.findUniqueOrThrow({ where: { id: packId } })).toMatchObject({ tier: "standard", priceCents: 500000 });
  });

  it("more than 15 parts needs a quote and creates no pack", async () => {
    const s = await setup(motorRows(16));
    await expect(s.packs.create(s.buyer, { auditId: s.auditId, accessToken: s.accessToken })).rejects.toMatchObject({ code: "QUOTE_REQUIRED" });
    expect(await db.evidencePack.count()).toBe(0);
    expect(await db.auditEntry.count({ where: { action: "pack.quote_required" } })).toBe(1);
  });
});

describe("supplier reuse consent (Postgres)", () => {
  it("is off by default; the supplier can give it with a name and withdraw it", async () => {
    const s = await setup(motorRows(1));
    const { packId } = await s.packs.create(s.buyer, { auditId: s.auditId, accessToken: s.accessToken });
    const buyer = { ...s.buyer, orgId: (await db.user.findUniqueOrThrow({ where: { id: s.buyer.userId } })).orgId };
    const motor = await db.auditPart.findFirstOrThrow({ where: { auditId: s.auditId } });
    const { requestId } = await s.suppliers.addRequest(buyer, packId, { name: "X", contactEmail: "x@x.test", partIds: [motor.id] });
    const token = tokenFrom(s.email.sent.at(-1)!.text);

    expect((await s.suppliers.resolveToken(token)).reuseConsent).toBe(false);
    await expect(s.suppliers.setReuseConsent(token, { consent: true, name: "" })).rejects.toMatchObject({ code: "CONSENT_NAME_REQUIRED" });
    expect(await s.suppliers.setReuseConsent(token, { consent: true, name: "Sam Supplier" })).toEqual({ reuseConsent: true });
    expect(await db.supplierRequest.findUniqueOrThrow({ where: { id: requestId } })).toMatchObject({ reuseConsentName: "Sam Supplier", reuseConsentWithdrawnAt: null });
    expect((await s.suppliers.resolveToken(token)).reuseConsent).toBe(true);

    expect(await s.suppliers.setReuseConsent(token, { consent: false })).toEqual({ reuseConsent: false });
    expect((await s.suppliers.resolveToken(token)).reuseConsent).toBe(false);
    expect(await db.auditEntry.count({ where: { action: { in: ["supplier.reuse_consent_given", "supplier.reuse_consent_withdrawn"] } } })).toBe(2);
  });
});

describe("supplier verification (Postgres)", () => {
  it("supplier pays, gets an upload link, and payment alone never verifies the listing", async () => {
    const s = await setup(motorRows(1));
    const listing = await s.directory.create(s.admin, { name: "Example Alloy Works", country: "Japan", stages: ["metal_alloy", "magnet"], materials: ["ndfeb"] });

    await expect(s.verifications.create(s.admin, listing.id, { contactEmail: "ops@alloy.test", facilities: 9 })).rejects.toMatchObject({ code: "FACILITIES_INVALID" });
    await expect(s.verifications.create(s.buyer, listing.id, { contactEmail: "ops@alloy.test", facilities: 1 })).rejects.toMatchObject({ code: "ROLE_FORBIDDEN" });

    const r = await s.verifications.create(s.admin, listing.id, { contactEmail: "Ops@Alloy.test", contactName: "Kenji", facilities: 2 });
    expect(r).toMatchObject({ tier: "multi", priceCents: 300000 });
    const v = await db.supplierVerification.findUniqueOrThrow({ where: { id: r.verificationId }, include: { requests: true } });
    expect(v).toMatchObject({ status: "collecting", contactEmail: "ops@alloy.test" });
    expect(v.periodEndsAt!.getTime() - v.paidAt!.getTime()).toBe(365 * DAY);

    // One upload request with no buyer pack, asking about the listing's upstream stages.
    expect(v.requests).toHaveLength(1);
    expect(v.requests[0]).toMatchObject({ packId: null, stagesRequested: ["metal_alloy", "magnet"] });
    const mail = s.email.sent.at(-1)!;
    expect(mail.to).toBe("ops@alloy.test");
    expect(mail.subject).toContain("verification");
    expect(mail.text).toContain("whatever it finds");
    const resolved = await s.suppliers.resolveToken(tokenFrom(mail.text));
    expect(resolved).toMatchObject({ purpose: "verification", buyerName: "Lodeline", parts: [] });

    // Paid, but not verified.
    expect((await db.supplierListing.findUniqueOrThrow({ where: { id: listing.id } })).verifiedAt).toBeNull();
    // A replayed payment event does nothing.
    expect(await s.verifications.markPaid(r.verificationId, "cs", 300000, `dev:verification:${r.verificationId}`)).toBe(false);
    await expect(s.verifications.create(s.admin, listing.id, { contactEmail: "ops@alloy.test", facilities: 1 })).rejects.toMatchObject({ code: "VERIFICATION_OPEN" });

    // Evidence from the supplier's own verification can verify its listing once accepted (no separate consent needed).
    const doc = await db.evidenceDocument.create({ data: { requestId: v.requests[0].id, fileKey: "k", fileName: "c.pdf", mime: "application/pdf", sha256: "x", status: "accepted" } });
    await db.evidenceClaim.create({ data: { documentId: doc.id, stage: "metal_alloy", citations: [], reviewStatus: "accepted" } });
    expect((await s.directory.verify(s.admin, listing.id, [doc.id])).verifiedAt).not.toBeNull();
    // ...but not some other listing.
    const other = await s.directory.create(s.admin, { name: "Other Co", stages: ["magnet"], materials: ["ndfeb"] });
    await expect(s.directory.verify(s.admin, other.id, [doc.id])).rejects.toMatchObject({ code: "REUSE_CONSENT_REQUIRED" });

    // Closing the verification does not depend on the outcome.
    expect((await s.verifications.complete(s.admin, r.verificationId)).status).toBe("complete");
    await expect(s.verifications.complete(s.admin, r.verificationId)).rejects.toMatchObject({ code: "VERIFICATION_NOT_COLLECTING" });
  });

  it("an unpaid verification can be cancelled; a paid one cannot; underpayment is refused", async () => {
    const s = await setup(motorRows(1));
    const billing = { mode: "stripe" as const, createCheckout: async () => ({ id: "cs_v", url: "https://checkout.test/v" }), parseWebhook: async () => ({ id: "x", type: "ignored" as const }) };
    const t = makeDeps(db, { now, billing });
    const verifications = new VerificationService(t.deps, new SupplierService(t.deps, new PackService(t.deps)));

    const mine = await s.directory.create(s.admin, { name: "Example Mine", stages: ["mine"], materials: ["ndfeb"] });
    const r1 = await verifications.create(s.admin, mine.id, { contactEmail: "mine@x.test", facilities: 1 });
    expect(r1.checkoutUrl).toBe("https://checkout.test/v");
    expect(t.email.sent.at(-1)!.text).toContain("https://checkout.test/v");
    expect(await db.supplierRequest.count()).toBe(0); // no upload link before payment
    expect((await verifications.cancel(s.admin, r1.verificationId)).status).toBe("cancelled");

    const smelter = await s.directory.create(s.admin, { name: "Example Smelter", stages: ["metal_alloy"], materials: ["ndfeb"] });
    const r2 = await verifications.create(s.admin, smelter.id, { contactEmail: "smelt@x.test", facilities: 1 });
    await expect(verifications.markPaid(r2.verificationId, "cs_v", 100, "evt_low")).rejects.toMatchObject({ code: "AMOUNT_MISMATCH" });
    expect(await verifications.markPaid(r2.verificationId, "cs_v", 150000, "evt_ok")).toBe(true);
    expect(await db.supplierRequest.count({ where: { verificationId: r2.verificationId } })).toBe(1);
    await expect(verifications.cancel(s.admin, r2.verificationId)).rejects.toMatchObject({ code: "VERIFICATION_PAID" });
  });
});

describe("refresh plans (Postgres)", () => {
  it("activates on payment, sets due dates, and ends when the subscription is cancelled", async () => {
    const s = await setup(motorRows(2));
    const { packId } = await s.packs.create(s.buyer, { auditId: s.auditId, accessToken: s.accessToken });
    const buyer = { ...s.buyer, orgId: (await db.user.findUniqueOrThrow({ where: { id: s.buyer.userId } })).orgId };

    const { refreshId } = await s.refresh.start(buyer, packId);
    const r = await db.refreshSubscription.findUniqueOrThrow({ where: { id: refreshId } });
    expect(r).toMatchObject({ status: "active", tier: "starter", monthlyCents: 25000, intervalDays: 90, stripeSubscriptionId: `dev_sub_${refreshId}` });
    expect(r.nextRefreshDueAt!.getTime() - clock.getTime()).toBe(90 * DAY);
    await expect(s.refresh.start(buyer, packId)).rejects.toMatchObject({ code: "REFRESH_ACTIVE" });

    clock = new Date(clock.getTime() + 91 * DAY);
    await expect(s.refresh.markRefreshed(buyer, refreshId)).rejects.toMatchObject({ code: "ROLE_FORBIDDEN" });
    const done = await s.refresh.markRefreshed(s.admin, refreshId);
    expect(done.lastRefreshedAt).toEqual(clock);
    expect(done.nextRefreshDueAt!.getTime() - clock.getTime()).toBe(90 * DAY);

    expect(await s.refresh.end(`dev_sub_${refreshId}`, "evt_end")).toBe(true);
    expect(await s.refresh.end(`dev_sub_${refreshId}`, "evt_end")).toBe(false);
    expect(await db.refreshSubscription.findUniqueOrThrow({ where: { id: refreshId } })).toMatchObject({ status: "cancelled", nextRefreshDueAt: null });
    // A cancelled plan can be restarted.
    expect((await s.refresh.start(buyer, packId)).refreshId).toBe(refreshId);
    expect((await db.refreshSubscription.findUniqueOrThrow({ where: { id: refreshId } })).status).toBe("active");
  });

  it("is not offered before payment", async () => {
    const s = await setup(motorRows(1));
    const billing = { mode: "stripe" as const, createCheckout: async () => ({ id: "cs_1", url: "https://checkout.test" }), parseWebhook: async () => ({ id: "x", type: "ignored" as const }) };
    const t = makeDeps(db, { now, billing });
    const packs = new PackService(t.deps);
    const { packId } = await packs.create(s.buyer, { auditId: s.auditId, accessToken: s.accessToken });
    const buyer = { ...s.buyer, orgId: (await db.user.findUniqueOrThrow({ where: { id: s.buyer.userId } })).orgId };
    await expect(new RefreshService(t.deps, packs).start(buyer, packId)).rejects.toMatchObject({ code: "PACK_NOT_PAID" });
  });
});
