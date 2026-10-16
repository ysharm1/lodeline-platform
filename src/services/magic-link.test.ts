import { describe, expect, it } from "vitest";
import { ConsoleEmailSender } from "@/infra/email";
import { InMemoryRepository } from "@/repository/in-memory";
import { InMemorySessionStore, hashSessionToken } from "@/session/store";
import { MagicLinkService, MAGIC_LINK_TTL_MINUTES } from "./magic-link";

function setup(now = new Date("2026-10-16T12:00:00Z")) {
  const repo = new InMemoryRepository();
  const sessions = new InMemorySessionStore();
  const email = new ConsoleEmailSender(true);
  let t = now;
  const svc = new MagicLinkService({ repo, sessions, email, baseUrl: "https://app.test/", now: () => t, adminEmails: ["ops@lodeline.org"] });
  const tokenFromEmail = () => new URL(email.sent.at(-1)!.text.match(/https:\S+/)![0]).searchParams.get("token")!;
  return { repo, sessions, email, svc, tokenFromEmail, advance: (ms: number) => (t = new Date(t.getTime() + ms)) };
}

describe("magic link", () => {
  it("emails a link and stores only the token hash", async () => {
    const { repo, email, svc, tokenFromEmail } = setup();
    await svc.request("  Buyer@Example.COM ");
    expect(email.sent[0].to).toBe("buyer@example.com");
    const token = tokenFromEmail();
    const [link] = [...repo.links.values()];
    expect(link.tokenHash).toBe(hashSessionToken(token));
    expect(JSON.stringify([...repo.links.values()])).not.toContain(token);
  });

  it("consumes once, creates a buyer, issues a hashed session", async () => {
    const { repo, sessions, svc, tokenFromEmail } = setup();
    await svc.request("buyer@example.com");
    const token = tokenFromEmail();
    const r = await svc.consume(token);
    expect(r.user.role).toBe("buyer");
    expect(r.user.emailVerifiedAt).not.toBeNull();
    expect(await sessions.findByTokenHash(hashSessionToken(r.sessionToken))).not.toBeNull();
    await expect(svc.consume(token)).rejects.toMatchObject({ code: "MAGIC_LINK_USED" });
    expect(repo.users.size).toBe(1);
  });

  it("expires", async () => {
    const { svc, tokenFromEmail, advance } = setup();
    await svc.request("a@b.co");
    advance(MAGIC_LINK_TTL_MINUTES * 60_000);
    await expect(svc.consume(tokenFromEmail())).rejects.toMatchObject({ code: "MAGIC_LINK_EXPIRED" });
  });

  it("rejects unknown and malformed tokens and bad emails", async () => {
    const { svc } = setup();
    await expect(svc.consume("x".repeat(43))).rejects.toMatchObject({ code: "MAGIC_LINK_INVALID" });
    await expect(svc.consume(undefined)).rejects.toMatchObject({ code: "MAGIC_LINK_INVALID" });
    await expect(svc.request("not-an-email")).rejects.toMatchObject({ code: "EMAIL_INVALID" });
  });

  it("seed admin email becomes admin; existing user is reused", async () => {
    const { svc, tokenFromEmail, repo } = setup();
    await svc.request("ops@lodeline.org");
    expect((await svc.consume(tokenFromEmail())).user.role).toBe("admin");
    await svc.request("ops@lodeline.org");
    await svc.consume(tokenFromEmail());
    expect(repo.users.size).toBe(1);
  });
});

import { safeNextPath } from "./magic-link";
describe("magic link next path", () => {
  it("allows only same-site relative paths", () => {
    expect(safeNextPath("/audit/x?t=1")).toBe("/audit/x?t=1");
    for (const bad of ["//evil.com", "https://evil.com", "/\\evil.com", "evil", 5, null]) expect(safeNextPath(bad)).toBeNull();
  });
});
