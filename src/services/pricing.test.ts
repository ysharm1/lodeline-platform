import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONFLICT_DISCLOSURE,
  PACK_TIERS,
  REFRESH_PLANS,
  SUPPLIER_COMMISSIONS_ENABLED,
  VERIFICATION_TIERS,
  refreshPlanFor,
  scopeOfParts,
  tierForScope,
  verificationTierFor,
} from "./pricing";
import { hasActiveReuseConsent, verificationStages } from "./suppliers";

describe("evidence pack tiers", () => {
  it("picks the smallest tier that fits parts and suppliers", () => {
    expect(tierForScope({ parts: 1, suppliers: 1 }).id).toBe("starter");
    expect(tierForScope({ parts: 5, suppliers: 3 }).id).toBe("starter");
    expect(tierForScope({ parts: 6, suppliers: 1 }).id).toBe("standard");
    expect(tierForScope({ parts: 2, suppliers: 4 }).id).toBe("standard");
    expect(tierForScope({ parts: 15, suppliers: 8 }).id).toBe("standard");
    expect(tierForScope({ parts: 16, suppliers: 1 }).id).toBe("custom");
    expect(tierForScope({ parts: 3, suppliers: 9 }).id).toBe("custom");
  });
  it("prices Starter at $2,500 and Standard at $5,000; Custom is quoted", () => {
    expect(PACK_TIERS.map((t) => [t.id, t.priceCents])).toEqual([["starter", 250_000], ["standard", 500_000], ["custom", null]]);
  });
  it("counts only flagged parts and distinct named suppliers", () => {
    const scope = scopeOfParts([
      { coverage: "likely", supplierName: "Acme Magnets" },
      { coverage: "possible", supplierName: "acme magnets " },
      { coverage: "likely", supplierName: "Beta Motors" },
      { coverage: "likely", supplierName: null },
      { coverage: "not_likely", supplierName: "Fastco" },
    ]);
    expect(scope).toEqual({ parts: 4, suppliers: 2 });
  });
});

describe("supplier verification fee", () => {
  it("is set by facility count, and more than 8 is quoted", () => {
    expect(verificationTierFor(1)?.priceCents).toBe(150_000);
    expect(verificationTierFor(2)?.priceCents).toBe(300_000);
    expect(verificationTierFor(3)?.priceCents).toBe(300_000);
    expect(verificationTierFor(8)?.priceCents).toBe(500_000);
    expect(verificationTierFor(9)).toBeNull();
    expect(verificationTierFor(0)).toBeNull();
    expect(verificationTierFor(1.5)).toBeNull();
  });
  it("tiers rise with scope", () => {
    for (let i = 1; i < VERIFICATION_TIERS.length; i++) expect(VERIFICATION_TIERS[i].priceCents).toBeGreaterThan(VERIFICATION_TIERS[i - 1].priceCents);
  });
});

describe("refresh plans", () => {
  it("exist for Starter and Standard only", () => {
    expect(refreshPlanFor("starter")?.monthlyCents).toBe(25_000);
    expect(refreshPlanFor("standard")?.monthlyCents).toBe(50_000);
    expect(refreshPlanFor("custom")).toBeNull();
    expect(REFRESH_PLANS.every((p) => p.intervalDays === 90)).toBe(true);
  });
});

describe("conflict-of-interest safeguards", () => {
  it("keeps supplier commissions off", () => {
    expect(SUPPLIER_COMMISSIONS_ENABLED).toBe(false);
  });
  it("discloses how Lodeline is paid", () => {
    expect(CONFLICT_DISCLOSURE).toMatch(/same whatever the review finds/);
    expect(CONFLICT_DISCLOSURE).toMatch(/does not take commissions/);
  });
  it("never orders the directory by payment", () => {
    const src = readFileSync(join(__dirname, "directory.ts"), "utf8");
    const orderBy = src.match(/ORDER BY[^\n]*/)![0];
    expect(orderBy).toBe('ORDER BY "rank" DESC, "verifiedAt" DESC NULLS LAST, "name" ASC');
    expect(src).not.toMatch(/supplierVerification|paidAt|priceCents/);
  });
  it("never sets a listing's verified status from the verification service", () => {
    const src = readFileSync(join(__dirname, "verifications.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    // Reading verifiedAt for display (`verifiedAt: true` in a select) is fine; writing it is not.
    expect(src).not.toMatch(/verifiedAt:(?!\s*true\b)/);
    expect(src).not.toMatch(/supplierListing\.(update|updateMany|upsert)\b/);
  });
});

describe("supplier reuse consent", () => {
  const t = new Date("2026-10-18T00:00:00Z");
  it("is off by default, on once given, off again once withdrawn", () => {
    expect(hasActiveReuseConsent({ reuseConsentAt: null, reuseConsentWithdrawnAt: null })).toBe(false);
    expect(hasActiveReuseConsent({ reuseConsentAt: t, reuseConsentWithdrawnAt: null })).toBe(true);
    expect(hasActiveReuseConsent({ reuseConsentAt: t, reuseConsentWithdrawnAt: t })).toBe(false);
  });
  it("asks a verification only about the upstream stages the listing covers", () => {
    expect(verificationStages(["separation", "metal_alloy"])).toEqual(["separation", "metal_alloy"]);
    expect(verificationStages(["component"])).toEqual(["mine", "separation", "metal_alloy", "magnet"]);
  });
});
