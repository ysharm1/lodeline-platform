import { describe, expect, it } from "vitest";
import { RateLimiter, clientIp } from "./rate-limit";

describe("rate limiter", () => {
  it("allows up to the limit per window", () => {
    const rl = new RateLimiter(2, 1000);
    expect(rl.check("ip", 0).ok).toBe(true);
    expect(rl.check("ip", 1).ok).toBe(true);
    expect(rl.check("ip", 2).ok).toBe(false);
    expect(rl.check("other", 2).ok).toBe(true);
    expect(rl.check("ip", 1000).ok).toBe(true);
  });
  it("reads the first forwarded IP", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("1.2.3.4");
  });
});
