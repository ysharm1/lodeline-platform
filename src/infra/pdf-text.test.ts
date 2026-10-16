import { describe, expect, it } from "vitest";
import { makePdf } from "../../test/pdf-fixture";
import { extractPdfPages } from "./pdf-text";

describe("pdf text (unpdf)", () => {
  it("extracts per-page text", async () => {
    const pdf = await makePdf([["Issuer: Example Metals", "Country of origin: Japan"], ["Second page here"]]);
    const pages = await extractPdfPages(pdf);
    expect(pages).toHaveLength(2);
    expect(pages[0]).toContain("Issuer: Example Metals");
    expect(pages[1]).toContain("Second page");
  });
});
