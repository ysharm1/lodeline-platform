import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testPrisma } from "../../test/db";
import { makeDeps } from "../../test/deps";
import { makePdf } from "../../test/pdf-fixture";
import type { AuthContext } from "@/domain/types";
import { hashToken } from "@/infra/token-crypto";
import { extractPdfPages } from "@/infra/pdf-text";
import { FreeAuditService } from "./free-audit";
import { PackService } from "./packs";
import { SupplierService } from "./suppliers";
import { EvidenceIntakeService } from "./evidence-intake";
import { ReviewService } from "./review";
import { loadPackPdfData } from "./pack-pdf-data";
import { renderPackPdf, PDF_DISCLAIMER } from "./pack-pdf";
import { handleEmailWebhook, signSvix } from "./email-webhook";

const db = testPrisma();
beforeEach(resetDb);

let clock = new Date("2026-10-01T16:00:00Z");
const now = () => clock;

async function setup() {
  clock = new Date("2026-10-01T16:00:00Z");
  const t = makeDeps(db, { now });
  const packs = new PackService(t.deps);
  const suppliers = new SupplierService(t.deps, packs);
  const intake = new EvidenceIntakeService(t.deps, suppliers);
  const review = new ReviewService(t.deps);
  const fa = new FreeAuditService({ repo: t.repo, storage: t.storage, audit: t.deps.audit, llm: t.deps.llm });
  const csv = new TextEncoder().encode("Part Number,Description,Supplier\nM-1,BLDC motor,Example Motors\nB-2,Hex bolt,Fastco\n");
  const { auditId, accessToken } = await fa.run({ fileName: "bom.csv", bytes: csv, leadEmail: "buyer@example.com", companyName: "Example Buyer Inc" });
  const buyerUser = await db.user.create({ data: { email: "buyer@example.com", role: "buyer" } });
  const adminUser = await db.user.create({ data: { email: "admin@example.com", role: "admin" } });
  const buyer: AuthContext = { userId: buyerUser.id, role: "buyer", orgId: null, email: buyerUser.email };
  const admin: AuthContext = { userId: adminUser.id, role: "admin", orgId: null, email: adminUser.email };
  return { ...t, packs, suppliers, intake, review, auditId, accessToken, buyer, admin };
}

async function paidPack(s: Awaited<ReturnType<typeof setup>>) {
  const { packId } = await s.packs.create(s.buyer, { auditId: s.auditId, accessToken: s.accessToken });
  const buyer = { ...s.buyer, orgId: (await db.user.findUniqueOrThrow({ where: { id: s.buyer.userId } })).orgId };
  return { packId, buyer };
}

describe("evidence pack flow (Postgres)", () => {
  it("pack creation requires the audit token; dev billing marks paid once; replays are no-ops", async () => {
    const s = await setup();
    await expect(s.packs.create(s.buyer, { auditId: s.auditId, accessToken: "wrong" })).rejects.toMatchObject({ code: "AUDIT_NOT_FOUND" });
    const { packId } = await paidPack(s);
    const pack = await db.evidencePack.findUniqueOrThrow({ where: { id: packId } });
    expect(pack).toMatchObject({ status: "collecting", priceCents: 250000 });
    expect(await s.packs.markPaid(packId, "cs_x", 250000, "evt_again")).toBe(false); // already paid
    expect(await s.packs.markPaid(packId, "cs_x", 250000, "evt_again")).toBe(false); // duplicate event
    expect(await db.auditEntry.count({ where: { action: "pack.paid" } })).toBe(1);
  });

  it("supplier request -> tokenized link -> upload -> claims in review -> accept -> matrix + PDF", async () => {
    const s = await setup();
    const { packId, buyer } = await paidPack(s);
    const motor = await db.auditPart.findFirstOrThrow({ where: { auditId: s.auditId, partNumber: "M-1" } });
    const { requestId } = await s.suppliers.addRequest(buyer, packId, { name: "Example Motors", contactEmail: "Sales@Example-Motors.test", partIds: [motor.id] });

    // Outreach email carries the raw token; DB only has its hash.
    const mail = s.email.sent.at(-1)!;
    expect(mail.to).toBe("sales@example-motors.test");
    const token = mail.text.match(/\/s\/([A-Za-z0-9_-]{43})/)![1];
    const req = await db.supplierRequest.findUniqueOrThrow({ where: { id: requestId } });
    expect(req.tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(req)).not.toContain(token);
    expect(req.stagesRequested).toEqual(["mine", "separation", "metal_alloy", "magnet"]);
    expect(req.nextReminderAt?.toISOString()).toBe("2026-10-04T16:00:00.000Z");

    // Drawing is refused at preflight; CAD extension too.
    await expect(s.intake.createUpload(token, { fileName: "rotor.dwg", sizeBytes: 100 })).rejects.toMatchObject({ code: "DRAWING_REJECTED" });

    const pdf = await makePdf([
      ["Certificate of Origin", "Issuer: Example Separation Co.", "Date: 2026-03-14", "Stage: rare earth oxide separation", "Facility: Example Plant 2", "Address: 100 Industrial Rd, Tallinn, Estonia", "Country of origin: Estonia", "---", "Stage: NdPr metal smelting", "Facility: Example Metal Plant", "Address: 1 Rare Earth Ave, Baotou", "Country: Japan"],
    ]);
    const up = await s.intake.createUpload(token, { fileName: "cert.pdf", sizeBytes: pdf.byteLength });
    expect(up.upload.method).toBe("PUT");
    const doc = await db.evidenceDocument.findUniqueOrThrow({ where: { id: up.documentId } });
    await s.storage.put({ key: doc.fileKey, body: pdf, contentType: "application/pdf" });
    const done = await s.intake.completeUpload(token, up.documentId);
    expect(done).toMatchObject({ status: "in_review", claims: 2 });

    const claims = await db.evidenceClaim.findMany({ where: { documentId: up.documentId }, orderBy: { stage: "asc" } });
    expect(claims.every((c) => c.reviewStatus === "in_review")).toBe(true);
    const sep = claims.find((c) => c.stage === "separation")!;
    const metal = claims.find((c) => c.stage === "metal_alloy")!;
    expect(sep).toMatchObject({ countryIso: "EE", coveredCountry: false, latitude: 59.437 });
    // Stated Japan, but the address geocodes to China: deterministically flagged.
    expect(metal).toMatchObject({ countryIso: "CN", coveredCountry: true });
    expect(metal.coveredReason).toMatch(/differs/);
    expect(await db.supplierRequest.findUniqueOrThrow({ where: { id: requestId } })).toMatchObject({ outreachStatus: "responded", nextReminderAt: null });

    // Nothing reaches the pack before approval.
    let view = await s.packs.view(packId);
    expect(view.accepted).toHaveLength(0);
    expect(view.matrix[0].cells.find((c) => c.stage === "separation")!.status).toBe("in_review");

    await expect(s.review.decide(buyer, sep.id, { action: "accept" })).rejects.toMatchObject({ code: "ROLE_FORBIDDEN" });
    await s.review.decide(s.admin, sep.id, { action: "accept", note: "matches page 1" });
    await s.review.decide(s.admin, metal.id, { action: "accept" });
    view = await s.packs.view(packId);
    expect(view.matrix[0].cells.map((c) => [c.stage, c.status])).toEqual([["mine", "requested"], ["separation", "documented"], ["metal_alloy", "covered_country"], ["magnet", "requested"]]);
    expect((await db.evidenceDocument.findUniqueOrThrow({ where: { id: up.documentId } })).status).toBe("accepted");

    // Editing the address re-geocodes and re-flags.
    const edited = await s.review.decide(s.admin, metal.id, { action: "edit", edit: { address: "Osaka, Japan" } });
    expect(edited).toMatchObject({ countryIso: "JP", coveredCountry: false, reviewStatus: "accepted" });

    // PDF from DB only.
    const pdfBytes = await renderPackPdf(await loadPackPdfData(s.packs, packId, clock));
    const text = (await extractPdfPages(new Uint8Array(pdfBytes))).join("\n").replace(/\s+/g, " ");
    expect(text).toContain("Evidence pack");
    expect(text).toContain("Example Plant 2");
    expect(text).toContain("Document register");
    expect(text).toContain("Open questions");
    expect(text).toContain("Stated limits");
    expect(text).toContain(PDF_DISCLAIMER.slice(0, 60));
    expect(text).toContain("59.4370, 24.7536");
  });

  it("revoked and expired tokens are refused", async () => {
    const s = await setup();
    const { packId, buyer } = await paidPack(s);
    const motor = await db.auditPart.findFirstOrThrow({ where: { auditId: s.auditId, partNumber: "M-1" } });
    const { requestId } = await s.suppliers.addRequest(buyer, packId, { name: "X", contactEmail: "x@x.test", partIds: [motor.id] });
    const token = s.email.sent.at(-1)!.text.match(/\/s\/([A-Za-z0-9_-]{43})/)![1];
    await expect(s.suppliers.resolveToken(token)).resolves.toBeTruthy();
    clock = new Date(clock.getTime() + 30 * 86_400_000);
    await expect(s.suppliers.resolveToken(token)).rejects.toMatchObject({ code: "TOKEN_EXPIRED" });
    clock = new Date("2026-10-02T00:00:00Z");
    await s.suppliers.revoke(buyer, requestId);
    await expect(s.suppliers.resolveToken(token)).rejects.toMatchObject({ code: "TOKEN_REVOKED" });
    await expect(s.suppliers.resolveToken("x".repeat(43))).rejects.toMatchObject({ code: "TOKEN_INVALID" });
  });

  it("reminders fire on day 3, 7, 14 with the same link, then stop; bounce webhook stops them", async () => {
    const s = await setup();
    const { packId, buyer } = await paidPack(s);
    const motor = await db.auditPart.findFirstOrThrow({ where: { auditId: s.auditId, partNumber: "M-1" } });
    const { requestId } = await s.suppliers.addRequest(buyer, packId, { name: "X", contactEmail: "x@x.test", partIds: [motor.id] });
    const link = s.email.sent.at(-1)!.text.match(/https:\S+\/s\/\S+/)![0];
    const at = (d: number) => (clock = new Date(Date.parse("2026-10-01T16:00:00Z") + d * 86_400_000));
    at(2);
    expect(await s.suppliers.runReminders()).toEqual({ due: 0, sent: 0 });
    for (const d of [3, 7, 14]) {
      at(d);
      expect(await s.suppliers.runReminders()).toEqual({ due: 1, sent: 1 });
      expect(s.email.sent.at(-1)!.text).toContain(link);
    }
    at(30);
    expect(await s.suppliers.runReminders()).toEqual({ due: 0, sent: 0 });
    expect((await db.supplierRequest.findUniqueOrThrow({ where: { id: requestId } })).reminderCount).toBe(3);

    // A second request that bounces.
    const { requestId: r2 } = await s.suppliers.addRequest(buyer, packId, { name: "Y", contactEmail: "y@y.test", partIds: [motor.id] });
    await db.outreachEmail.updateMany({ where: { requestId: r2 }, data: { providerMessageId: "msg_bounce" } });
    const secret = "whsec_" + Buffer.from("k").toString("base64");
    const body = JSON.stringify({ type: "email.bounced", data: { email_id: "msg_bounce" } });
    const ts = String(Math.floor(Date.now() / 1000));
    const headers = new Headers({ "svix-id": "evt_b1", "svix-timestamp": ts, "svix-signature": signSvix(secret, "evt_b1", ts, body) });
    expect(await handleEmailWebhook(s.deps, headers, body, secret)).toEqual({ handled: true, kind: "bounced" });
    expect(await handleEmailWebhook(s.deps, headers, body, secret)).toMatchObject({ duplicate: true });
    expect(await db.supplierRequest.findUniqueOrThrow({ where: { id: r2 } })).toMatchObject({ outreachStatus: "bounced", nextReminderAt: null });
    await expect(handleEmailWebhook(s.deps, new Headers(), body, secret)).rejects.toMatchObject({ code: "WEBHOOK_SIGNATURE_INVALID" });
  });

  it("first pack creates a dual-role-ready organization and a buyer membership", async () => {
    const s = await setup();
    await s.packs.create(s.buyer, { auditId: s.auditId, accessToken: s.accessToken });
    const user = await db.user.findUniqueOrThrow({ where: { id: s.buyer.userId } });
    const org = await db.organization.findUniqueOrThrow({ where: { id: user.orgId! } });
    expect(org.roles).toEqual(["buyer"]);
    const m = await db.membership.findUniqueOrThrow({ where: { userId_orgId: { userId: user.id, orgId: org.id } } });
    expect(m).toMatchObject({ roles: ["buyer"], isOrgAdmin: true });
    // An organization can hold both roles (selling not built yet).
    const both = await db.organization.update({ where: { id: org.id }, data: { roles: { set: ["buyer", "seller"] } } });
    expect(both.roles).toEqual(["buyer", "seller"]);
  });

  it("suppliers cannot be contacted before payment; drawings uploaded as PDF are rejected after upload", async () => {
    const s = await setup();
    const billing = { mode: "stripe" as const, createCheckout: async () => ({ id: "cs_1", url: "https://checkout.test" }), parseWebhook: async () => ({ id: "x", type: "ignored" as const }) };
    const t = makeDeps(db, { now, billing });
    const packs = new PackService(t.deps);
    const { packId, checkoutUrl } = await packs.create(s.buyer, { auditId: s.auditId, accessToken: s.accessToken });
    expect(checkoutUrl).toBe("https://checkout.test");
    const buyer = { ...s.buyer, orgId: (await db.user.findUniqueOrThrow({ where: { id: s.buyer.userId } })).orgId };
    const suppliers = new SupplierService(t.deps, packs);
    const motor = await db.auditPart.findFirstOrThrow({ where: { auditId: s.auditId, partNumber: "M-1" } });
    await expect(suppliers.addRequest(buyer, packId, { name: "X", contactEmail: "x@x.test", partIds: [motor.id] })).rejects.toMatchObject({ code: "PACK_NOT_PAID" });
    expect(await packs.markPaid(packId, "cs_1", 250000, "evt_1")).toBe(true);
    await suppliers.addRequest(buyer, packId, { name: "X", contactEmail: "x@x.test", partIds: [motor.id] });
    const token = t.email.sent.at(-1)!.text.match(/\/s\/([A-Za-z0-9_-]{43})/)![1];
    const intake = new EvidenceIntakeService(t.deps, suppliers);
    const drawing = await makePdf([["HOUSING, ROTOR", "DRAWN BY JS CHECKED KL", "SCALE 2:1 SHEET 1 OF 1 REV C", "UNLESS OTHERWISE SPECIFIED"]]);
    const up = await intake.createUpload(token, { fileName: "cert.pdf", sizeBytes: drawing.byteLength });
    const doc = await db.evidenceDocument.findUniqueOrThrow({ where: { id: up.documentId } });
    await t.storage.put({ key: doc.fileKey, body: drawing, contentType: "application/pdf" });
    expect(await intake.completeUpload(token, up.documentId)).toMatchObject({ status: "rejected", rejectionReason: "technical_drawing" });
    expect(await db.documentPage.count({ where: { documentId: up.documentId } })).toBe(0);
  });
});
