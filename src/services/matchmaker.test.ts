import { describe, expect, it } from "vitest";
import { auditNeeds, matchPackRows, rankListings, type MatchListing } from "./matchmaker";
import type { MatrixRow } from "./pack-matrix";

const L = (id: string, o: Partial<MatchListing>): MatchListing => ({ id, name: id, city: null, countryIso: "US", stages: ["magnet"], materials: ["ndfeb"], verified: false, isExample: false, ...o });

describe("matchmaker", () => {
  it("excludes covered countries and ranks verified, then real, then name", () => {
    const rows = [L("zeta", { verified: true }), L("alpha", {}), L("cn", { countryIso: "CN", verified: true }), L("ex", { isExample: true }), L("beta", {}), L("w", { materials: ["tungsten"] })];
    expect(rankListings(rows, "ndfeb", "magnet").map((r) => r.id)).toEqual(["zeta", "alpha", "beta"]);
  });
  it("suggests for every open stage, including covered-country cells, and skips documented ones", () => {
    const row: MatrixRow = {
      part: { id: "p1", partNumber: "PN1", description: "NdFeB magnet", supplierName: null, materials: ["ndfeb"] },
      cells: [
        { stage: "mine", status: "documented", claimIds: ["c"] },
        { stage: "magnet", status: "covered_country", claimIds: ["d"] },
        { stage: "separation", status: "requested", claimIds: [] },
      ],
    };
    const out = matchPackRows([row], [L("m1", {}), L("s1", { stages: ["separation"] })]);
    expect(out).toHaveLength(1);
    expect(out[0].needs.map((n) => [n.stage, n.reason, n.suggestions.map((s) => s.id)])).toEqual([
      ["magnet", "covered_country", ["m1"]],
      ["separation", "no_document", ["s1"]],
    ]);
  });
  it("derives audit needs from flagged parts only", () => {
    expect(
      auditNeeds([
        { coverage: "likely", materials: ["tungsten"], undocumentedStages: ["mine", "separation"] },
        { coverage: "not_likely", materials: ["other"], undocumentedStages: [] },
        { coverage: "possible", materials: ["tungsten"], undocumentedStages: ["mine"] },
      ])
    ).toEqual([{ material: "tungsten", stage: "mine" }, { material: "tungsten", stage: "separation" }]);
  });
});
