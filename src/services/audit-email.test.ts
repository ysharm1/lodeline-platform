import { describe, expect, it } from "vitest";
import { ConsoleEmailSender } from "@/infra/email";
import { InMemoryRepository } from "@/repository/in-memory";
import { AuditService } from "./audit";
import { emailAuditResults } from "./audit-email";

describe("audit results email", () => {
  it("sends the tokenized link and logs without content", async () => {
    const repo = new InMemoryRepository();
    const email = new ConsoleEmailSender(true);
    const ok = await emailAuditResults({ email, audit: new AuditService(repo), baseUrl: "https://app.test/" }, { auditId: "a1", accessToken: "tok/+", leadEmail: "x@acme.com", flagged: 2, total: 9 });
    expect(ok).toBe(true);
    expect(email.sent[0].to).toBe("x@acme.com");
    expect(email.sent[0].text).toContain("https://app.test/audit/a1?t=tok%2F%2B");
    expect(repo.entries[0]).toMatchObject({ action: "audit.results_emailed", subjectId: "a1", payload: { emailDomain: "acme.com" } });
    expect(JSON.stringify(repo.entries)).not.toContain("tok");
  });
  it("records failures without throwing", async () => {
    const repo = new InMemoryRepository();
    const email = { name: "boom", send: async () => { throw new Error("smtp down"); } };
    expect(await emailAuditResults({ email, audit: new AuditService(repo), baseUrl: "x" }, { auditId: "a", accessToken: "t", leadEmail: "a@b.co", flagged: 0, total: 1 })).toBe(false);
    expect(repo.entries[0].action).toBe("audit.results_email_failed");
  });
});
