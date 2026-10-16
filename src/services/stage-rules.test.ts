import { describe, expect, it } from "vitest";
import { MATERIALS } from "@/domain/types";
import { REQUIRED_STAGES, undocumentedStages } from "./stage-rules";
import { keywordClassify } from "./keyword-classifier";

describe("stage rules", () => {
  it("marks every magnet stage undocumented with no claims", () => {
    expect(undocumentedStages(["ndfeb"])).toEqual(["mine", "separation", "metal_alloy", "magnet"]);
  });
  it("W/Ta need mine, separation, metal", () => {
    expect(undocumentedStages(["tungsten"])).toEqual(["mine", "separation", "metal_alloy"]);
    expect(undocumentedStages(["tantalum"])).toEqual(["mine", "separation", "metal_alloy"]);
  });
  it("other needs nothing", () => {
    expect(undocumentedStages(["other"])).toEqual([]);
  });
  it("accepted claims cover stages, scoped by material", () => {
    expect(undocumentedStages(["ndfeb"], [{ stage: "mine" }, { stage: "magnet", material: "ndfeb" }])).toEqual(["separation", "metal_alloy"]);
    expect(undocumentedStages(["ndfeb", "tungsten"], [{ stage: "mine", material: "tungsten" }])).toEqual(["mine", "separation", "metal_alloy", "magnet"]);
  });
  it("is the union of required stages, in order, for any material set", () => {
    for (let mask = 0; mask < 1 << MATERIALS.length; mask++) {
      const ms = MATERIALS.filter((_, i) => mask & (1 << i));
      const out = undocumentedStages(ms);
      const expected = new Set(ms.flatMap((m) => REQUIRED_STAGES[m]));
      expect(new Set(out)).toEqual(expected);
      expect(out).toEqual([...out].sort((a, b) => ["mine", "separation", "metal_alloy", "magnet", "component"].indexOf(a) - ["mine", "separation", "metal_alloy", "magnet", "component"].indexOf(b)));
    }
  });
});

describe("keyword classifier", () => {
  it.each([
    ["BLDC motor 48V", "ndfeb"],
    ["Samarium cobalt motor, high temp", "smco"],
    ["CAP TANT 10uF 25V", "tantalum"],
    ["Tungsten heavy alloy counterweight", "tungsten"],
    ["Hex bolt M6 stainless", "other"],
  ])("%s -> %s", (text, m) => {
    expect(keywordClassify(text).materials).toContain(m);
  });
  it("SmCo motor does not also flag NdFeB", () => {
    expect(keywordClassify("SmCo servo motor").materials).toEqual(["smco"]);
  });
});
