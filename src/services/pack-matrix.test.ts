import { describe, expect, it } from "vitest";
import { buildPackMatrix, openQuestions } from "./pack-matrix";

const parts = [
  { id: "p1", partNumber: "M-1", description: "BLDC motor", supplierName: "Acme", materials: ["ndfeb" as const] },
  { id: "p2", partNumber: "B-2", description: "bolt", supplierName: null, materials: ["other" as const] },
];
const req = { id: "r1", partIds: ["p1"], stagesRequested: ["mine", "separation", "metal_alloy", "magnet"] as const, revoked: false };

describe("pack matrix", () => {
  it("only accepted claims document a stage; pending shows in_review; covered wins", () => {
    const rows = buildPackMatrix(parts, [{ ...req, stagesRequested: [...req.stagesRequested] }], [
      { id: "c1", requestId: "r1", partId: null, stage: "mine", reviewStatus: "accepted", coveredCountry: false },
      { id: "c2", requestId: "r1", partId: null, stage: "separation", reviewStatus: "in_review", coveredCountry: false },
      { id: "c3", requestId: "r1", partId: null, stage: "metal_alloy", reviewStatus: "accepted", coveredCountry: true },
      { id: "c4", requestId: "r1", partId: null, stage: "magnet", reviewStatus: "rejected", coveredCountry: false },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].cells.map((c) => c.status)).toEqual(["documented", "in_review", "covered_country", "requested"]);
    const qs = openQuestions(rows, () => "Acme");
    expect(qs).toHaveLength(3);
    expect(qs.join("\n")).toMatch(/covered country/);
  });
  it("claims tied to another part do not count; revoked requests do not count as requested", () => {
    const rows = buildPackMatrix(parts, [{ ...req, stagesRequested: [...req.stagesRequested], revoked: true }], [{ id: "c1", requestId: "r1", partId: "p9", stage: "mine", reviewStatus: "accepted", coveredCountry: false }]);
    expect(rows[0].cells.every((c) => c.status === "no_document")).toBe(true);
  });
});
