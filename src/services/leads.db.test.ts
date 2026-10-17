import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testPrisma } from "../../test/db";
import { makeDeps } from "../../test/deps";
import type { AuthContext } from "@/domain/types";
import { PostgresRateLimiter } from "@/http/rate-limit";
import { LeadService } from "./leads";
import { SupplierApplicationService } from "./supplier-applications";
import { DirectoryService, parseFilterParams } from "./directory";

const db = testPrisma();
beforeEach(resetDb);
const admin: AuthContext = { userId: "00000000-0000-0000-0000-000000000001", role: "admin", orgId: null, email: "a@x" };
const buyer: AuthContext = { userId: "00000000-0000-0000-0000-000000000002", role: "buyer", orgId: null, email: "b@x" };

const call = {
  kind: "readiness_call",
  name: "Pat Example",
  company: "Example Motion Co",
  email: "Pat@Example.com",
  phone: "",
  supplies: "Motors / actuators",
  message: "A prime asked about magnet origin for two motor part numbers",
  sourcePath: "/",
};

describe("website leads", () => {
  it("stores a readiness-call lead, emails info@lodeline.org, audits ids only", async () => {
    const { deps, email } = makeDeps(db);
    const r = await new LeadService(deps).submit(call, { ip: "203.0.113.9" });
    expect(r).toMatchObject({ kind: "readiness_call", notified: true });
    const row = await db.lead.findUniqueOrThrow({ where: { id: r.id } });
    expect(row).toMatchObject({ email: "pat@example.com", phone: null, supplies: "Motors / actuators", status: "new" });
    expect(row.notifiedAt).not.toBeNull();
    expect(row.ipHash).toMatch(/^[0-9a-f]{32}$/);
    expect(row.ipHash).not.toContain("203.0.113.9");
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]).toMatchObject({ to: "info@lodeline.org", subject: "Lodeline inquiry: Example Motion Co" });
    expect(email.sent[0].text).toContain("magnet origin");
    const entries = await db.auditEntry.findMany({ where: { subjectId: r.id } });
    expect(entries.map((e) => e.action)).toEqual(["lead.created"]);
    expect(JSON.stringify(entries[0].payload)).not.toMatch(/pat|example/i);
  });

  it("checklist lead + validation messages match the site", async () => {
    const { deps, email } = makeDeps(db);
    const svc = new LeadService(deps, "team@example.test");
    await svc.submit({ kind: "checklist", email: "q@example.org", company: "Acme" });
    expect(email.sent[0]).toMatchObject({ to: "team@example.test", subject: "Lodeline checklist request: Acme" });
    await expect(svc.submit({ ...call, email: "nope" })).rejects.toMatchObject({ message: "Please enter a valid work email.", field: "email" });
    await expect(svc.submit({ ...call, supplies: "Spaceships" })).rejects.toMatchObject({ message: "Please select what you supply." });
    await expect(svc.submit({ ...call, name: " " })).rejects.toMatchObject({ message: "Please fill in your name and company." });
    await expect(svc.submit({ kind: "checklist", email: "q@example.org", company: "" })).rejects.toMatchObject({ message: "Please enter your company." });
    await expect(svc.submit({ kind: "other" })).rejects.toMatchObject({ code: "LEAD_INVALID" });
    expect(await db.lead.count()).toBe(1);
  });

  it("keeps the lead when the notification fails", async () => {
    const { deps } = makeDeps(db);
    deps.email = { name: "broken", send: async () => { throw new Error("smtp down"); } };
    const r = await new LeadService(deps).submit(call);
    expect(r.notified).toBe(false);
    expect((await db.lead.findUniqueOrThrow({ where: { id: r.id } })).notifiedAt).toBeNull();
    expect((await db.auditEntry.findMany({ where: { subjectId: r.id } })).map((e) => e.action).sort()).toEqual(["lead.created", "lead.notify_failed"]);
  });

  it("admin-only listing and status changes", async () => {
    const { deps } = makeDeps(db);
    const svc = new LeadService(deps);
    const r = await svc.submit(call);
    await expect(svc.list(buyer)).rejects.toMatchObject({ category: "authorization" });
    expect(await svc.list(admin)).toHaveLength(1);
    expect((await svc.setStatus(admin, r.id, "contacted")).status).toBe("contacted");
    await expect(svc.setStatus(admin, r.id, "deleted")).rejects.toMatchObject({ code: "LEAD_STATUS_INVALID" });
  });

  it("lead rate limit is shared through Postgres", async () => {
    const rl = new PostgresRateLimiter(db, "lead", 5, 3_600_000);
    const results = [];
    for (let i = 0; i < 6; i++) results.push((await rl.check("lead:198.51.100.1")).ok);
    expect(results).toEqual([true, true, true, true, true, false]);
  });
});

const application = {
  companyName: "Example Separation Works",
  contactName: "Sam Example",
  email: "sam@example.org",
  website: "https://example.org",
  city: "Tallinn",
  country: "Estonia",
  stages: ["separation", "metal_alloy"],
  materials: ["ndfeb"],
  summary: "Rare earth oxide separation and NdPr metal production for magnet makers.",
  documentsNote: "Refinery certificates per lot",
};

describe("supplier applications (For suppliers)", () => {
  it("submit -> pending -> admin approve creates an UNPUBLISHED, UNVERIFIED listing", async () => {
    const { deps, email } = makeDeps(db);
    const svc = new SupplierApplicationService(deps);
    const { id, status } = await svc.submit(application, { ip: "192.0.2.4" });
    expect(status).toBe("pending");
    expect(email.sent[0].subject).toBe("Lodeline supplier application: Example Separation Works");
    expect(email.sent[0].text).toContain("https://app.test/admin/applications");
    await expect(svc.approve(buyer, id)).rejects.toMatchObject({ category: "authorization" });

    const { listing, application: app } = await svc.approve(admin, id, "looks real");
    expect(app).toMatchObject({ status: "approved", listingId: listing.id, reviewedById: admin.userId, reviewNote: "looks real" });
    expect(listing).toMatchObject({ name: "Example Separation Works", countryIso: "EE", published: false, verifiedAt: null, isExample: false, stages: ["separation", "metal_alloy"] });
    await expect(svc.approve(admin, id)).rejects.toMatchObject({ code: "APPLICATION_DECIDED" });

    // Not visible in the public directory until verified + published.
    const dir = new DirectoryService(deps);
    expect(await dir.search(parseFilterParams({ q: "separation" }))).toEqual([]);
    expect((await dir.search(parseFilterParams({ q: "separation" }), { includeUnpublished: true })).map((r) => r.verified)).toEqual([false]);
    const actions = (await db.auditEntry.findMany({ orderBy: { createdAt: "asc" } })).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["supplier_application.submitted", "supplier_application.approved", "listing.created"]));
  });

  it("validation and reject", async () => {
    const { deps } = makeDeps(db);
    const svc = new SupplierApplicationService(deps);
    await expect(svc.submit({ ...application, stages: [] })).rejects.toMatchObject({ message: "Select at least one production stage." });
    await expect(svc.submit({ ...application, materials: ["unobtainium"] })).rejects.toMatchObject({ code: "APPLICATION_INVALID" });
    await expect(svc.submit({ ...application, website: "javascript:alert(1)" })).rejects.toMatchObject({ field: "website" });
    await expect(svc.submit({ ...application, country: "Atlantis" })).rejects.toMatchObject({ code: "COUNTRY_UNKNOWN" });
    await expect(svc.submit({ ...application, summary: "short" })).rejects.toMatchObject({ field: "summary" });
    const { id } = await svc.submit({ ...application, stages: "magnet" });
    const rejected = await svc.reject(admin, id, "no documents");
    expect(rejected).toMatchObject({ status: "rejected", listingId: null, reviewNote: "no documents" });
    expect(await db.supplierListing.count()).toBe(0);
    expect(await svc.list(admin, "pending")).toEqual([]);
  });
});
