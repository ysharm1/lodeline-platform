import { describe, expect, it } from "vitest";
import { claimConfidence, confidenceLabel } from "./claim-confidence";

const full = { stage: "magnet" as const, country: "Japan", facilityName: "Plant 1", address: "1-1 Example, Japan", issuer: "Example Co", issueDate: new Date("2026-01-01"), dropped: [] };

describe("claimConfidence", () => {
  it("scores a complete, consistent claim 1.0", () => {
    expect(claimConfidence(full)).toBe(1);
    expect(confidenceLabel(1)).toBe("high");
  });
  it("drops for missing fields, unquoted fields and country mismatch", () => {
    expect(claimConfidence({ ...full, address: null, issueDate: null })).toBe(0.8);
    expect(claimConfidence({ ...full, dropped: ["address"] })).toBe(0.9);
    expect(claimConfidence(full, { countryMismatch: true })).toBe(0.85);
  });
  it("never goes below 0 and labels low scores", () => {
    expect(claimConfidence({ stage: null, country: null, facilityName: null, address: null, issuer: "X", issueDate: null, dropped: ["stage", "country", "address"] })).toBe(0);
    expect(confidenceLabel(0.3)).toBe("low");
    expect(confidenceLabel(null)).toBe("unscored");
  });
});
