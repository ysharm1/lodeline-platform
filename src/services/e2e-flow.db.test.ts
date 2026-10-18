/**
 * The end-to-end additions, against real Postgres: Custom quotes, deterministic
 * claim extraction when the LLM is blocked, per-stage uploads, forwarding up the
 * chain, one-click release, per-part PDF data, matchmaker, buyers listing their
 * own supplies.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testPrisma } from "../../test/db";
import { makeDeps } from "../../test/deps";
import { makePdf } from "../../test/pdf-fixture";
import type { AuthContext } from "@/domain/types";
import { LlmClient } from "@/infra/llm";
import { FreeAuditService } from "./free-audit";
import { PackService } from "./packs";
import { SupplierService } from "./suppliers";
import { EvidenceIntakeService } from "./evidence-intake";
import { ReviewService } from "./review";
import { DirectoryService } from "./directory";
import { releasePack } from "./pack-release";
import { loadPackPdfData, packPdfDataForPart } from "./pack-pdf-data";

const db = testPrisma();
beforeEach(resetDb);

const BIG = ["Part Number,Description,Supplier", ...Array.from({ length: 10 }, (_, i) => `N-${i},NdFeB magnet N42 disc,Supplier ${i}`)].join("\n");

async function setup(csv = BIG, opts: { llmBlocked?: boolean } = {}) {
  const t = makeDeps(db);
  if (opts.llmBlocked) t.deps.llm = new LlmClient({ zdrConfirmed: false, model: "m", provider: "p", baseUrl: "x" }, () => {});
  const packs = new PackService(t.deps);
  const suppliers = new SupplierService(t.deps, packs);
  const intake = new EvidenceIntakeService(t.deps, suppliers);
  const review = new ReviewService(t.deps);
  const directory = new DirectoryService(t.deps);
  const fa = new FreeAuditService({ repo: t.repo, storage: t.storage, audit: t.deps.audit, llm: t.deps.llm });
  const { auditId, accessToken } = await fa.run({ fileName: "bom.csv", bytes: new TextEncoder().encode(csv), leadEmail: "buyer@example.test", companyName: "Example Buyer" });
  const bu = await db.user.create({ data: { email: "buyer@example.test", role: "buyer" } });
  const au = await db.user.create({ data: { email: "admin@example.test", role: "admin" } });
  const buyer: AuthContext = { userId: bu.id, role: "buyer", orgId: null, email: bu.email };
  const admin: AuthContext = { userId: au.id, role: "admin", orgId: null, email: au.email };
  return { ...t, packs, suppliers, intake, review, directory, auditId, accessToken, buyer, admin };
}
type S = Awaited<ReturnType<typeof setup>>;
const orgCtx = async (s: S): Promise<AuthContext> => ({ ...s.buyer, orgId: (await db.user.findUniqueOrThrow({ where: { id: s.buyer.userId } })).orgId });
const tokenFor = (s: S, to: string) => s.email.sent.filter((m) => m.to === to).at(-1)!.text.match(/\/s\/([A-Za-z0-9_-]{43})/)![1];

async function uploadPdf(s: S, token: string, lines: string[], stage?: string) {
  const pdf = await makePdf([lines]);
  const up = await s.intake.createUpload(token, { fileName: "cert.pdf", sizeBytes: pdf.byteLength, stage });
  await s.storage.put({ key: (await db.evidenceDocument.findUniqueOrThrow({ where: { id: up.documentId } })).fileKey, body: pdf, contentType: "application/pdf" });
  return s.intake.completeUpload(token, up.documentId);
}

describe("Custom quote", () => {
  it("a scope larger than Standard needs a staff quote, then sells at the quoted price with the quoted supplier limit", async () => {
    const s = await setup();
    await expect(s.packs.create(s.buyer, { auditId: s.auditId, accessToken: s.accessToken })).rejects.toMatchObject({ code: "QUOTE_REQUIRED" });
    await expect(s.packs.setQuote(s.buyer, s.auditId, { priceCents: 800000 })).rejects.toMatchObject({ code: "ROLE_FORBIDDEN" });
    await expect(s.packs.setQuote(s.admin, s.auditId, { priceCents: 100 })).rejects.toMatchObject({ code: "PRICE_INVALID" });
    expect((await s.packs.quoteQueue(s.admin)).map((a) => a.id)).toEqual([s.auditId]);
    await s.packs.setQuote(s.admin, s.auditId, { priceCents: 800000, maxSuppliers: 1 });
    const { packId } = await s.packs.create(s.buyer, { auditId: s.auditId, accessToken: s.accessToken });
    expect(await db.evidencePack.findUniqueOrThrow({ where: { id: packId } })).toMatchObject({ tier: "custom", priceCents: 800000, status: "collecting" });
    const buyer = await orgCtx(s);
    const parts = await db.auditPart.findMany({ where: { auditId: s.auditId } });
    await s.suppliers.addRequest(buyer, packId, { name: "S0", contactEmail: "s0@example.test", partIds: [parts[0].id] });
    await expect(s.suppliers.addRequest(buyer, packId, { name: "S1", contactEmail: "s1@example.test", partIds: [parts[1].id] })).rejects.toMatchObject({ code: "TIER_SUPPLIER_LIMIT" });
    expect(await s.packs.quoteQueue(s.admin)).toEqual([]);
  });
});

describe("supplier portal: deterministic extraction, per-stage uploads, forwarding, release", () => {
  it("extracts claims without an LLM (ZDR not confirmed), forwards a stage upstream, releases and narrows the PDF per part", async () => {
    const s = await setup("Part Number,Description,Supplier\nM-1,NdFeB magnet N42,Example Magnets\nT-1,Tantalum capacitor,Example Caps\n", { llmBlocked: true });
    const { packId } = await s.packs.create(s.buyer, { auditId: s.auditId, accessToken: s.accessToken });
    const buyer = await orgCtx(s);
    const m1 = await db.auditPart.findFirstOrThrow({ where: { auditId: s.auditId, partNumber: "M-1" } });
    const { requestId } = await s.suppliers.addRequest(buyer, packId, { name: "Example Magnets", contactEmail: "mag@example.test", partIds: [m1.id] });
    const token = tokenFor(s, "mag@example.test");

    const portal = await s.suppliers.resolveToken(token);
    expect(portal.stages.map((x) => x.stage)).toEqual(["mine", "separation", "metal_alloy", "magnet"]);
    await expect(s.intake.createUpload(token, { fileName: "a.pdf", sizeBytes: 10, stage: "component" })).rejects.toMatchObject({ code: "STAGE_INVALID" });

    const r = await uploadPdf(s, token, ["Issuer: Example Magnets", "Stage: sintered magnet manufacture", "Facility: Example Plant", "Address: 1 Example St, Osaka, Japan", "Country: Japan"], "magnet");
    expect(r).toMatchObject({ status: "in_review", claims: 1 });
    const claim = await db.evidenceClaim.findFirstOrThrow({ where: { document: { requestId } }, include: { document: true } });
    expect(claim).toMatchObject({ stage: "magnet", countryIso: "JP", coveredCountry: false, confidence: 0.95 });
    expect(claim.document.declaredStage).toBe("magnet");

    // Forward metal/alloy upstream; refused for unrequested stages.
    await expect(s.suppliers.forward(token, { stages: ["component"], name: "X", contactEmail: "x@example.test" })).rejects.toMatchObject({ code: "STAGES_REQUIRED" });
    const fw = await s.suppliers.forward(token, { stages: ["metal_alloy"], name: "Example Alloy", contactEmail: "alloy@example.test" });
    expect(fw.emailed).toBe(true);
    const fwMail = s.email.sent.at(-1)!;
    expect(fwMail.text).toContain("Example Magnets forwarded this request");
    const child = await db.supplierRequest.findUniqueOrThrow({ where: { id: fw.requestId } });
    expect(child).toMatchObject({ packId, parentRequestId: requestId, stagesRequested: ["metal_alloy"], partIds: [m1.id] });
    const childToken = tokenFor(s, "alloy@example.test");
    expect((await s.suppliers.resolveToken(childToken)).request.parent?.supplier.name).toBe("Example Magnets");
    expect((await s.suppliers.resolveToken(token)).stages.find((x) => x.stage === "metal_alloy")!.forwardedTo[0].supplierName).toBe("Example Alloy");
    await uploadPdf(s, childToken, ["Issuer: Example Alloy", "Stage: NdPr alloy smelting", "Facility: Alloy Works", "Address: 9 Road, Baotou, China", "Country: China"]);
    const cn = await db.evidenceClaim.findFirstOrThrow({ where: { document: { requestId: fw.requestId } } });
    expect(cn).toMatchObject({ coveredCountry: true, countryIso: "CN" });

    await expect(releasePack(s.deps, s.packs, s.admin, packId)).rejects.toMatchObject({ code: "REVIEW_PENDING" });
    await expect(releasePack(s.deps, s.packs, buyer, packId)).rejects.toMatchObject({ code: "ROLE_FORBIDDEN" });
    for (const c of await db.evidenceClaim.findMany()) await s.review.decide(s.admin, c.id, { action: "accept" });

    // Matchmaker: the covered-country alloy stage gets a non-covered suggestion.
    await db.supplierListing.createMany({
      data: [
        { name: "Alloy JP", countryIso: "JP", stages: ["metal_alloy"], materials: ["ndfeb"], published: true },
        { name: "Alloy CN", countryIso: "CN", stages: ["metal_alloy"], materials: ["ndfeb"], published: true },
      ],
    });
    const { matrix } = await s.packs.view(packId);
    const mm = await s.directory.matchesForMatrix(matrix);
    const alloyNeed = mm.find((m) => m.partId === m1.id)!.needs.find((n) => n.stage === "metal_alloy")!;
    expect(alloyNeed.reason).toBe("covered_country");
    expect(alloyNeed.suggestions.map((x) => x.name)).toEqual(["Alloy JP"]);

    const rel = await releasePack(s.deps, s.packs, s.admin, packId);
    expect(rel).toMatchObject({ status: "delivered", emailed: true });
    expect(s.email.sent.at(-1)!).toMatchObject({ to: "buyer@example.test", subject: "Your Lodeline evidence pack is ready" });
    expect((await db.evidencePack.findUniqueOrThrow({ where: { id: packId } })).releasedAt).not.toBeNull();

    const data = await loadPackPdfData(s.packs, packId);
    const one = packPdfDataForPart(data, m1.id)!;
    expect(one.matrix.map((r) => r.part.id)).toEqual([m1.id]);
    expect(one.claims).toHaveLength(2);
    expect(one.partLabel).toContain("M-1");
    expect(packPdfDataForPart(data, "nope")).toBeNull();
  });
});

describe("buyers list their own supplies", () => {
  it("adds the seller role to the org and membership; the listing starts unpublished and unverified", async () => {
    const s = await setup("Part Number,Description\nM-1,NdFeB magnet\n");
    await expect(s.directory.submitOwn(s.buyer, { name: "Own", country: "US" })).rejects.toMatchObject({ code: "SCOPE_REQUIRED" });
    const row = await s.directory.submitOwn(s.buyer, { name: "Own Magnets", country: "US", city: "Phoenix", stages: ["component"], materials: ["ndfeb"], published: true });
    expect(row).toMatchObject({ published: false, verifiedAt: null, isExample: false });
    expect(row.latitude).not.toBeNull();
    const u = await db.user.findUniqueOrThrow({ where: { id: s.buyer.userId }, include: { org: true, memberships: true } });
    expect(u.org!.roles.sort()).toEqual(["buyer", "seller"]);
    expect(u.memberships[0].roles.sort()).toEqual(["buyer", "seller"]);
    expect((await s.directory.listOwn({ ...s.buyer, orgId: u.orgId })).map((l) => l.id)).toEqual([row.id]);
    expect((await s.directory.search({ q: "", materials: [], stages: [], countries: [], excludeCountries: [], verifiedOnly: false })).some((l) => l.id === row.id)).toBe(false);
    // A buyer org that already exists keeps its buyer role and gains seller.
    const { packId } = await s.packs.create({ ...s.buyer, orgId: u.orgId }, { auditId: s.auditId, accessToken: s.accessToken });
    expect(packId).toBeTruthy();
  });
});
