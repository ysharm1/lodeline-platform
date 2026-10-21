import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testPrisma } from "../../test/db";
import { makeDeps } from "../../test/deps";
import type { AuthContext } from "@/domain/types";
import { DirectoryService, parseFilterParams } from "./directory";
import { IntroService } from "./intros";
import { parseMarketplaceParams } from "./marketplace";
import { orgSummary, setupOrg } from "./orgs";
import { importSeed, parseSeed } from "./seed-import";

const db = testPrisma();
beforeEach(resetDb);
const fixture = () => JSON.parse(readFileSync(join(__dirname, "..", "..", "test", "fixtures", "seed-example.json"), "utf8"));
const admin: AuthContext = { userId: "00000000-0000-0000-0000-0000000000aa", role: "admin", orgId: null, email: "admin@x.test" };

async function buyer(email = "buyer@x.test"): Promise<AuthContext> {
  const u = await db.user.create({ data: { email, role: "buyer" } });
  return { userId: u.id, role: "buyer", orgId: null, email };
}

describe("seed import", () => {
  it("is idempotent, keyed on the export id, unpublished prospects with country-level coordinates", async () => {
    const first = await importSeed(db, parseSeed(fixture()));
    expect(first).toMatchObject({ created: 3, updated: 0, hidden: 0 });
    expect(first.rejected).toHaveLength(2);
    const again = await importSeed(db, parseSeed(fixture()));
    expect(again).toMatchObject({ created: 0, updated: 3 });
    expect(await db.supplierListing.count()).toBe(3);
    const rows = await db.supplierListing.findMany();
    expect(rows.every((r) => r.listingStatus === "prospect" && !r.published && !r.verifiedAt && r.latitude != null && r.geocodeProvider === "country-centroid")).toBe(true);
  });

  it("never overwrites claimed or verified rows; hides rows dropped from the export", async () => {
    await importSeed(db, parseSeed(fixture()));
    const org = await db.organization.create({ data: { name: "Seller", kind: "buyer", roles: ["buyer", "seller"] } });
    await db.supplierListing.update({ where: { sourceKey: "example-magnet-co" }, data: { orgId: org.id, name: "Claimed name" } });
    const f = fixture();
    f.suppliers = f.suppliers.filter((s: { id: string }) => s.id !== "example-recycler-ca");
    const s = await importSeed(db, parseSeed(f));
    expect(s).toMatchObject({ protectedSkipped: 1, updated: 1, hidden: 1 });
    expect((await db.supplierListing.findUniqueOrThrow({ where: { sourceKey: "example-magnet-co" } })).name).toBe("Claimed name");
    expect((await db.supplierListing.findUniqueOrThrow({ where: { sourceKey: "example-recycler-ca" } })).listingStatus).toBe("hidden");
  });
});

describe("marketplace search", () => {
  it("shows prospects to signed-in users only; filters by stage, activity, region, country, status", async () => {
    const { deps } = makeDeps(db);
    const dir = new DirectoryService(deps);
    await importSeed(db, parseSeed(fixture()));
    await dir.create(admin, { name: "Example Magnet Works (sample)", summary: "Sintered NdFeB", country: "US", stages: ["magnet"], materials: ["ndfeb"], published: true, isExample: true });
    await dir.create(admin, { name: "Draft", country: "US", stages: ["magnet"], materials: ["ndfeb"], published: false });
    // Public directory: published only.
    expect((await dir.search(parseFilterParams({}))).map((r) => r.name)).toEqual(["Example Magnet Works (sample)"]);
    const all = await dir.marketplace(parseMarketplaceParams({}));
    expect(all.map((r) => r.name).sort()).toEqual(["Example Magnet Works (sample)", "Example Prospect Magnets (fictional)", "Example Prospect Recycler (fictional)", "Example Prospect Separation (fictional)"]);
    expect((await dir.marketplace(parseMarketplaceParams({ stage: "recycling" }))).map((r) => r.name)).toEqual(["Example Prospect Recycler (fictional)"]);
    expect((await dir.marketplace(parseMarketplaceParams({ region: "Taiwan" }))).map((r) => r.countryIso)).toEqual(["TW"]);
    expect((await dir.marketplace(parseMarketplaceParams({ country: "CA" }))).length).toBe(1);
    expect((await dir.marketplace(parseMarketplaceParams({ status: "prospect" }))).length).toBe(3);
    expect((await dir.marketplace(parseMarketplaceParams({ status: "verified" }))).length).toBe(0);
    expect((await dir.marketplace(parseMarketplaceParams({ stage: "magnet", material: "ndfeb" }))).length).toBe(2);
    const hidden = await db.supplierListing.update({ where: { sourceKey: "example-recycler-ca" }, data: { listingStatus: "hidden" } });
    expect(await dir.marketplaceListing(hidden.id)).toBeNull();
  });
});

describe("customer accounts and Request intro", () => {
  it("names the company once (org + admin membership), then renames it", async () => {
    const { deps } = makeDeps(db);
    let ctx = await buyer();
    const r = await setupOrg(deps, ctx, "Example Motors (test)");
    expect(r.created).toBe(true);
    ctx = { ...ctx, orgId: r.orgId };
    expect(await orgSummary(deps, ctx)).toMatchObject({ name: "Example Motors (test)", roles: ["buyer"], isOrgAdmin: true, isSeller: false });
    expect((await setupOrg(deps, ctx, "Example Motors Inc (test)")).created).toBe(false);
    await expect(setupOrg(deps, ctx, " ")).rejects.toThrow(/company name/);
  });

  it("stores the request, emails Lodeline (not the supplier), dedupes open requests, refuses example rows", async () => {
    const { deps, email } = makeDeps(db);
    await importSeed(db, parseSeed(fixture()));
    const listing = await db.supplierListing.findUniqueOrThrow({ where: { sourceKey: "example-separation-tw" } });
    const intros = new IntroService(deps, "team@x.test");
    const ctx = await buyer();
    const r = await intros.request(ctx, listing.id, "NdPr metal for sintered magnets");
    expect(r).toMatchObject({ duplicate: false, emailed: true });
    const sent = (email as unknown as { sent: { to: string; subject: string; text: string }[] }).sent;
    expect(sent.at(-1)).toMatchObject({ to: "team@x.test", subject: "Intro request: Example Prospect Separation (fictional)" });
    const u = await db.user.findUniqueOrThrow({ where: { id: ctx.userId } });
    expect(u.orgId).toBeTruthy();
    const again = await intros.request({ ...ctx, orgId: u.orgId }, listing.id, "again");
    expect(again.duplicate).toBe(true);
    expect(await db.contactRequest.count()).toBe(1);
    expect((await intros.listForOrg({ ...ctx, orgId: u.orgId }))[0].listing.name).toBe(listing.name);
    const ex = await new DirectoryService(deps).create(admin, { name: "Example (sample)", country: "US", stages: ["magnet"], materials: ["ndfeb"], published: true, isExample: true });
    await expect(intros.request({ ...ctx, orgId: u.orgId }, ex.id, "")).rejects.toThrow(/fictional/);
    await expect(intros.request({ ...ctx, orgId: u.orgId }, "not-an-id", "")).rejects.toThrow(/not found/i);
    const adminUser = await db.user.create({ data: { email: "staff@x.test", role: "admin" } });
    const row = await intros.setStatus({ ...admin, userId: adminUser.id }, r.request.id, "introduced");
    expect(row.status).toBe("introduced");
    await expect(intros.setStatus(ctx, r.request.id, "closed")).rejects.toThrow();
  });
});
