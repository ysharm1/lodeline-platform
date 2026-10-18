import { describe, expect, it, vi } from "vitest";

describe("isDomainError across module copies", () => {
  it("recognises a DomainError created by another copy of the module (Next route bundles)", async () => {
    const a = await import("./errors");
    vi.resetModules();
    const b = await import("./errors");
    expect(a.DomainError).not.toBe(b.DomainError);
    const foreign = new b.ConflictError("QUOTE_REQUIRED", "quote");
    expect(foreign instanceof a.DomainError).toBe(false);
    expect(a.isDomainError(foreign)).toBe(true);
    expect(foreign.httpStatus).toBe(409);
    expect(a.isDomainError(new Error("x"))).toBe(false);
    expect(a.isDomainError({ name: "DomainError", code: "X" })).toBe(false);
  });
});
