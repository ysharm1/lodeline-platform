import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testPrisma } from "../../test/db";
import { PrismaRepository } from "./prisma";
import { PrismaSessionStore } from "@/session/prisma-store";
import { PostgresRateLimiter } from "@/http/rate-limit";
import { AuditService } from "@/services/audit";
import { FreeAuditService } from "@/services/free-audit";
import { MagicLinkService } from "@/services/magic-link";
import { LlmClient } from "@/infra/llm";
import { ConsoleEmailSender } from "@/infra/email";
import { MemoryDocumentStorage } from "@/services/storage";

const db = testPrisma();
beforeEach(resetDb);

describe("Postgres smoke", () => {
  it("migrations applied: every model table exists", async () => {
    const rows = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public'`;
    const names = rows.map((r) => r.tablename);
    for (const t of ["PartsAudit", "AuditPart", "EvidencePack", "Supplier", "SupplierRequest", "OutreachEmail", "EvidenceDocument", "EvidenceClaim", "SupplierListing", "Referral", "CommissionInvoice", "MagicLink", "User", "Session", "AuditEntry", "DocumentPage", "GeocodeCache", "RateLimitBucket", "Membership"]) {
      expect(names).toContain(t);
    }
  });

  it("free audit + magic link + sessions run against Prisma", async () => {
    const repo = new PrismaRepository(db);
    const audit = new AuditService(repo);
    const fa = new FreeAuditService({ repo, storage: new MemoryDocumentStorage(), audit, llm: new LlmClient({ zdrConfirmed: true, model: "m", provider: "p", baseUrl: "x" }, () => {}) });
    const csv = new TextEncoder().encode("PN,Description,Qty\nA,BLDC motor,2.5\nB,bolt,\n");
    const { auditId, accessToken } = await fa.run({ fileName: "b.csv", bytes: csv, leadEmail: "x@y.co" });
    const r = await fa.results(auditId, accessToken);
    expect(r.summary).toEqual({ total: 2, flagged: 1 });
    expect(r.parts[0].quantity).toBe(2.5);

    const email = new ConsoleEmailSender(true);
    const sessions = new PrismaSessionStore(db);
    const ml = new MagicLinkService({ repo, sessions, email, baseUrl: "http://t" });
    await ml.request("x@y.co");
    const token = new URL(email.sent[0].text.match(/http\S+/)![0]).searchParams.get("token")!;
    const { user } = await ml.consume(token);
    await expect(ml.consume(token)).rejects.toMatchObject({ code: "MAGIC_LINK_USED" });
    expect(await db.session.count({ where: { userId: user.id } })).toBe(1);
    expect(await db.auditEntry.count()).toBe(2);
  });

  it("Postgres rate limiter is atomic across concurrent calls and resets", async () => {
    const rl = new PostgresRateLimiter(db, "t", 5, 60_000);
    const now = new Date("2026-10-16T00:00:00Z");
    const results = await Promise.all(Array.from({ length: 12 }, () => rl.check("1.2.3.4", now)));
    expect(results.filter((r) => r.ok)).toHaveLength(5);
    expect(results.find((r) => !r.ok)!.retryAfterSec).toBe(60);
    expect((await rl.check("1.2.3.4", new Date(now.getTime() + 60_000))).ok).toBe(true);
    expect((await rl.check("5.6.7.8", now)).ok).toBe(true);
  });
});
