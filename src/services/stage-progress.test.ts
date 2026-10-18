import { describe, expect, it } from "vitest";
import { stageProgress } from "./suppliers";

describe("supplier portal per-stage progress", () => {
  it("groups uploaded documents by declared stage and lists forwards per stage", () => {
    const p = stageProgress(
      ["mine", "metal_alloy"],
      [
        { id: "d1", status: "in_review", declaredStage: "mine" },
        { id: "d2", status: "requested", declaredStage: "mine" },
        { id: "d3", status: "accepted", declaredStage: null },
      ],
      [{ id: "r2", stagesRequested: ["metal_alloy"], outreachStatus: "sent", supplier: { name: "Up Co" }, documents: [{ id: "x", status: "in_review" }] }]
    );
    expect(p[0]).toEqual({ stage: "mine", documents: [{ id: "d1", status: "in_review" }], forwardedTo: [] });
    expect(p[1].forwardedTo).toEqual([{ requestId: "r2", supplierName: "Up Co", outreachStatus: "sent", documents: 1 }]);
  });
});
