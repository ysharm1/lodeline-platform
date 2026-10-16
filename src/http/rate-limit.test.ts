import { describe, expect, it } from "vitest";
import { MemoryRateLimiter, clientIp } from "./rate-limit";

describe("memory rate limiter", () => {
  it("allows up to the limit per window", async () => {
    const rl = new MemoryRateLimiter(2, 1000);
    const at = (ms: number) => new Date(ms);
    expect((await rl.check("ip", at(0))).ok).toBe(true);
    expect((await rl.check("ip", at(1))).ok).toBe(true);
    expect((await rl.check("ip", at(2))).ok).toBe(false);
    expect((await rl.check("other", at(2))).ok).toBe(true);
    expect((await rl.check("ip", at(1000))).ok).toBe(true);
  });
  it("reads the first forwarded IP", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("1.2.3.4");
  });
});
