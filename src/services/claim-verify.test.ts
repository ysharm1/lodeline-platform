import { describe, expect, it } from "vitest";
import { verifyClaims } from "./claim-verify";
import { mockExtractClaims } from "./claim-mock";

const pages = [
  "Certificate of Origin\nIssuer: Example Separation Co.\nDate: 2026-03-14\nStage: rare earth oxide separation\nFacility: Example Plant 2\nAddress: 100 Industrial Rd, Tallinn, Estonia\nCountry of origin: Estonia",
  "Annex\nThe NdPr metal was produced by smelting at the same site.",
];

describe("verbatim-citation filter", () => {
  it("keeps fields whose quote appears verbatim on the cited page", () => {
    const [c] = verifyClaims([{ issuer: "Example Separation Co.", country: "Estonia", citations: [{ field: "issuer", page: 1, quote: "Issuer: Example Separation Co." }, { field: "country", page: 1, quote: "Country of origin:   Estonia" }] }], pages);
    expect(c.issuer).toBe("Example Separation Co.");
    expect(c.country).toBe("Estonia");
    expect(c.dropped).toEqual([]);
  });
  it("drops fields whose quote is not on the cited page (hallucination or wrong page)", () => {
    const out = verifyClaims([{ issuer: "Example Separation Co.", country: "China", citations: [{ field: "issuer", page: 2, quote: "Issuer: Example Separation Co." }, { field: "country", page: 1, quote: "Country of origin: China" }] }], pages);
    expect(out).toEqual([]);
  });
  it("drops a field whose value is not in its (real) quote", () => {
    const [c] = verifyClaims([{ issuer: "Example Separation Co.", country: "Japan", citations: [{ field: "issuer", page: 1, quote: "Issuer: Example Separation Co." }, { field: "country", page: 1, quote: "Country of origin: Estonia" }] }], pages);
    expect(c.country).toBeNull();
    expect(c.dropped).toEqual(["country"]);
  });
  it("is case-sensitive, rejects out-of-range pages and trivial quotes", () => {
    expect(verifyClaims([{ issuer: "Example Separation Co.", citations: [{ field: "issuer", page: 1, quote: "ISSUER: EXAMPLE SEPARATION CO." }] }], pages)).toEqual([]);
    expect(verifyClaims([{ issuer: "x", citations: [{ field: "issuer", page: 9, quote: "Issuer" }] }], pages)).toEqual([]);
    expect(verifyClaims([{ issuer: "Ex", citations: [{ field: "issuer", page: 1, quote: "Ex" }] }], pages)).toEqual([]);
  });
  it("stage must be a known stage supported by words in a verbatim quote", () => {
    const ok = verifyClaims([{ stage: "metal_alloy", citations: [{ field: "stage", page: 2, quote: "The NdPr metal was produced by smelting" }] }], pages);
    expect(ok[0].stage).toBe("metal_alloy");
    expect(verifyClaims([{ stage: "mine", citations: [{ field: "stage", page: 2, quote: "The NdPr metal was produced by smelting" }] }], pages)).toEqual([]);
    expect(verifyClaims([{ stage: "teleport", citations: [{ field: "stage", page: 2, quote: "The NdPr metal" }] }], pages)).toEqual([]);
  });
  it("dates must parse and their year must be in the quote", () => {
    expect(verifyClaims([{ issueDate: "2026-03-14", citations: [{ field: "issueDate", page: 1, quote: "Date: 2026-03-14" }] }], pages)[0].issueDate?.toISOString()).toBe("2026-03-14T00:00:00.000Z");
    expect(verifyClaims([{ issueDate: "2019-01-01", citations: [{ field: "issueDate", page: 1, quote: "Date: 2026-03-14" }] }], pages)).toEqual([]);
  });
  it("the deterministic mock extractor's output survives the filter intact", () => {
    const out = verifyClaims(mockExtractClaims(pages), pages);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ issuer: "Example Separation Co.", stage: "separation", facilityName: "Example Plant 2", address: "100 Industrial Rd, Tallinn, Estonia", country: "Estonia", dropped: [] });
  });
});
