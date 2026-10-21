import { describe, expect, it } from "vitest";
import { PROSPECT_LABEL, coverageGaps, listingStatusLabel, marketplaceHref, parseMarketplaceParams, stageCountrySummary } from "./marketplace";
import type { MatrixRow } from "./pack-matrix";

describe("listing status label", () => {
  it("verified only from evidence; prospects say unverified, from public sources", () => {
    expect(listingStatusLabel({ verifiedAt: new Date(), listingStatus: "prospect", isExample: false }).label).toBe("Verified from evidence");
    expect(listingStatusLabel({ verifiedAt: null, listingStatus: "prospect", isExample: false }).label).toBe(PROSPECT_LABEL);
    expect(PROSPECT_LABEL).toBe("Unverified, from public sources");
    expect(listingStatusLabel({ verifiedAt: null, listingStatus: "listed", isExample: false }).label).toBe("Not verified");
    expect(listingStatusLabel({ verifiedAt: new Date(), listingStatus: "listed", isExample: true }).label).toMatch(/Example/);
  });
  it("never says compliant or certified", () => {
    for (const l of [{ verifiedAt: new Date(), listingStatus: "listed", isExample: false }, { verifiedAt: null, listingStatus: "prospect", isExample: false }]) {
      expect(listingStatusLabel(l).label).not.toMatch(/complian|certif/i);
    }
  });
});

describe("marketplace filters", () => {
  it("parses stage (incl. recycling/distribution), material, region, country, status", () => {
    const f = parseMarketplaceParams({ stage: "magnet,recycling,bogus", material: "ndfeb,xx", region: "Taiwan,Mars", country: "japan,US", status: "prospect", excludeCovered: "1", q: " sintered " });
    expect(f).toEqual({ q: "sintered", stages: ["magnet"], activities: ["recycling"], materials: ["ndfeb"], regions: ["Taiwan"], countries: ["JP", "US"], excludeCovered: true, status: "prospect" });
    expect(parseMarketplaceParams({ status: "certified" }).status).toBeNull();
  });
  it("round-trips through marketplaceHref", () => {
    const href = marketplaceHref({ stages: ["separation"], materials: ["tungsten"], excludeCovered: true });
    expect(href).toBe("/app/marketplace?stage=separation&material=tungsten&excludeCovered=1");
    const sp = Object.fromEntries(new URL(href, "https://x.test").searchParams.entries());
    expect(parseMarketplaceParams(sp)).toMatchObject({ stages: ["separation"], materials: ["tungsten"], excludeCovered: true });
  });
});

describe("coverage gaps", () => {
  const rows: MatrixRow[] = [
    {
      part: { id: "p1", partNumber: "BX041", description: "magnet", supplierName: null, materials: ["ndfeb"] },
      cells: [
        { stage: "mine", status: "no_document", claimIds: [] },
        { stage: "separation", status: "documented", claimIds: ["c"] },
        { stage: "metal_alloy", status: "covered_country", claimIds: ["d"] },
        { stage: "magnet", status: "in_review", claimIds: [] },
      ],
    },
  ];
  it("lists every non-documented stage with a China-free search link", () => {
    const g = coverageGaps(rows);
    expect(g.map((x) => [x.stage, x.reason])).toEqual([["mine", "no_document"], ["metal_alloy", "covered_country"], ["magnet", "no_document"]]);
    expect(g[1].href).toBe("/app/marketplace?stage=metal_alloy&material=ndfeb&excludeCovered=1");
  });
});

describe("stage x country summary", () => {
  it("groups suppliers by stage and country and flags covered countries", () => {
    const s = stageCountrySummary([
      { id: "1", name: "A", countryIso: "US", stages: ["mine", "separation"] },
      { id: "2", name: "B", countryIso: "US", stages: ["mine"] },
      { id: "3", name: "C", countryIso: "CN", stages: ["mine"] },
    ]);
    const mine = s.find((x) => x.stage === "mine")!;
    expect(mine.total).toBe(3);
    expect(mine.countries[0]).toEqual({ countryIso: "US", suppliers: ["A", "B"], covered: false });
    expect(mine.countries[1].covered).toBe(true);
    expect(s.find((x) => x.stage === "magnet")!.total).toBe(0);
  });
});
