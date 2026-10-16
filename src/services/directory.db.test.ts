import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testPrisma } from "../../test/db";
import { makeDeps } from "../../test/deps";
import type { AuthContext } from "@/domain/types";
import { CachingGeocoder, PrismaGeocodeCache } from "./geocoder";
import { DirectoryService, parseFilterParams } from "./directory";

const db = testPrisma();
beforeEach(resetDb);
const admin: AuthContext = { userId: "00000000-0000-0000-0000-000000000001", role: "admin", orgId: null, email: "a@x" };

async function seed(dir: DirectoryService) {
  await dir.create(admin, { name: "Example Magnet Works (sample)", summary: "Sintered NdFeB magnet manufacturing for motors", city: "Example City", country: "United States", stages: ["magnet"], materials: ["ndfeb"], published: true, isExample: true });
  await dir.create(admin, { name: "Example Separation Co (sample)", summary: "Rare earth oxide separation and refining", country: "Estonia", stages: ["separation"], materials: ["ndfeb", "smco"], published: true, isExample: true });
  await dir.create(admin, { name: "Example Tungsten Refinery (sample)", summary: "APT and tungsten powder", country: "China", stages: ["separation", "metal_alloy"], materials: ["tungsten"], published: true, isExample: true });
  await dir.create(admin, { name: "Hidden Draft Listing", summary: "magnet", country: "US", stages: ["magnet"], materials: ["ndfeb"], published: false });
}

describe("supplier directory (Postgres FTS)", () => {
  it("full-text + filters + published-only", async () => {
    const { deps } = makeDeps(db);
    const dir = new DirectoryService(deps);
    await seed(dir);
    expect((await dir.search(parseFilterParams({ q: "sintered magnets" }))).map((r) => r.name)).toEqual(["Example Magnet Works (sample)"]);
    expect((await dir.search(parseFilterParams({ material: "tungsten" }))).map((r) => r.countryIso)).toEqual(["CN"]);
    expect((await dir.search(parseFilterParams({ stage: "separation", excludeCountry: "CN" }))).map((r) => r.name)).toEqual(["Example Separation Co (sample)"]);
    expect((await dir.search(parseFilterParams({ country: "us" }))).map((r) => r.name)).toEqual(["Example Magnet Works (sample)"]);
    expect(await dir.search(parseFilterParams({ q: "draft" }))).toEqual([]);
    expect((await dir.search(parseFilterParams({ q: "draft" }), { includeUnpublished: true })).length).toBe(1);
    expect(await dir.search(parseFilterParams({ verified: "1" }))).toEqual([]);
    // Injection-shaped input is just text.
    expect(await dir.search(parseFilterParams({ q: "'); DROP TABLE \"SupplierListing\"; --" }))).toEqual([]);
    expect(await db.supplierListing.count()).toBe(4);
  });

  it("Ask: keyword fallback -> filters -> answer cites only returned rows", async () => {
    const { deps } = makeDeps(db);
    const dir = new DirectoryService(deps);
    await seed(dir);
    const r = await dir.ask("Which NdFeB separation suppliers are outside China?");
    expect(r.filters).toMatchObject({ materials: ["ndfeb"], stages: ["separation"], excludeCountries: ["CN"] });
    expect(r.rows.map((x) => x.name)).toEqual(["Example Separation Co (sample)"]);
    expect(r.citedIds).toEqual([r.rows[0].id]);
    expect(r.answer).toContain("Example Separation Co (sample)");
    expect(r.answer).not.toMatch(/Tungsten|Hidden/);
    const none = await dir.ask("tantalum suppliers in Japan");
    expect(none.rows).toEqual([]);
    expect(none.citedIds).toEqual([]);
  });

  it("verification requires accepted evidence documents", async () => {
    const { deps } = makeDeps(db);
    const dir = new DirectoryService(deps);
    const l = await dir.create(admin, { name: "Example Listing", country: "EE", stages: ["separation"], materials: ["ndfeb"], published: true });
    const org = await db.organization.create({ data: { name: "B", kind: "buyer" } });
    const audit = await db.partsAudit.create({ data: { leadEmail: "a@b.co", sourceFileKey: "k", sourceFileName: "f", sourceSha256: "s", rowCount: 0, status: "classified" } });
    const pack = await db.evidencePack.create({ data: { auditId: audit.id, orgId: org.id, priceCents: 250000 } });
    const sup = await db.supplier.create({ data: { name: "S" } });
    const req = await db.supplierRequest.create({ data: { packId: pack.id, supplierId: sup.id, partIds: [], stagesRequested: [], tokenHash: "h", tokenExpiresAt: new Date() } });
    const doc = await db.evidenceDocument.create({ data: { requestId: req.id, fileKey: "k", fileName: "c.pdf", mime: "application/pdf", sha256: "x", status: "in_review" } });
    const claim = await db.evidenceClaim.create({ data: { documentId: doc.id, stage: "separation", citations: [] } });
    await expect(dir.verify(admin, l.id, [doc.id])).rejects.toMatchObject({ code: "EVIDENCE_NOT_ACCEPTED" });
    await db.evidenceClaim.update({ where: { id: claim.id }, data: { reviewStatus: "accepted" } });
    await db.evidenceDocument.update({ where: { id: doc.id }, data: { status: "accepted" } });
    const v = await dir.verify(admin, l.id, [doc.id]);
    expect(v.verifiedAt).not.toBeNull();
    expect(v.verifiedFromClaimIds).toEqual([claim.id]);
    expect((await dir.search(parseFilterParams({ verified: "1" }))).map((r) => r.id)).toEqual([l.id]);
    expect((await dir.verify(admin, l.id, [])).verifiedAt).toBeNull();
    await expect(dir.create({ ...admin, role: "buyer" }, { name: "x" })).rejects.toMatchObject({ code: "ROLE_FORBIDDEN" });
  });

  it("geocode cache persists in Postgres across geocoder instances", async () => {
    let calls = 0;
    const inner = { provider: "fake", geocode: async () => (calls++, { latitude: 1, longitude: 2, countryIso: "EE", displayName: "x" }) };
    await new CachingGeocoder(inner, new PrismaGeocodeCache(db)).geocode("100 Industrial Rd, Tallinn");
    const r = await new CachingGeocoder(inner, new PrismaGeocodeCache(db)).geocode("100 INDUSTRIAL RD,  tallinn");
    expect(calls).toBe(1);
    expect(r).toMatchObject({ countryIso: "EE" });
    expect(await db.geocodeCache.count()).toBe(1);
  });
});
