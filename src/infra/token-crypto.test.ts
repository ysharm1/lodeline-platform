import { describe, expect, it } from "vitest";
import { decryptToken, encryptToken, generateToken, hashToken, tokenMatchesHash } from "./token-crypto";
import { nextReminderAt, tokenState } from "@/services/suppliers";

describe("supplier tokens", () => {
  it("are 256-bit url-safe, hashed with SHA-256, compared in constant time", () => {
    const t = generateToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(t)).not.toContain(t);
    expect(tokenMatchesHash(t, hashToken(t))).toBe(true);
    expect(tokenMatchesHash(t + "x", hashToken(t))).toBe(false);
    expect(new Set(Array.from({ length: 200 }, generateToken)).size).toBe(200);
  });
  it("round-trips through AES-GCM and rejects tampering / wrong key", () => {
    const env = { SESSION_SECRET: "s1" } as unknown as NodeJS.ProcessEnv;
    const blob = encryptToken("tok-123", env);
    expect(blob).not.toContain("tok-123");
    expect(decryptToken(blob, env)).toBe("tok-123");
    expect(() => decryptToken(blob, { SESSION_SECRET: "s2" } as unknown as NodeJS.ProcessEnv)).toThrow();
    const parts = blob.split(".");
    parts[3] = Buffer.from("zzzz").toString("base64url");
    expect(() => decryptToken(parts.join("."), env)).toThrow();
  });
  it("refuses to run in production without a key", () => {
    expect(() => encryptToken("x", { NODE_ENV: "production" } as unknown as NodeJS.ProcessEnv)).toThrow(/required/);
  });
  it("token state: revoked beats expired; expiry is inclusive", () => {
    const now = new Date("2026-10-16T00:00:00Z");
    expect(tokenState({ tokenExpiresAt: new Date(now.getTime() + 1), revokedAt: null }, now)).toBe("ok");
    expect(tokenState({ tokenExpiresAt: now, revokedAt: null }, now)).toBe("expired");
    expect(tokenState({ tokenExpiresAt: new Date(0), revokedAt: now }, now)).toBe("revoked");
  });
  it("reminders at day 3, 7, 14 then stop", () => {
    const t0 = new Date("2026-10-01T00:00:00Z");
    expect([0, 1, 2, 3].map((n) => nextReminderAt(t0, n)?.toISOString().slice(0, 10) ?? null)).toEqual(["2026-10-04", "2026-10-08", "2026-10-15", null]);
  });
});
