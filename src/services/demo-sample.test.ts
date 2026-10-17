import { describe, expect, it } from "vitest";
import { parsePartsFile } from "./parts-parser";
import { classifyPart, keywordClassify } from "./keyword-classifier";
import { DEMO_FILE_NAME, demoCsvBytes } from "./demo-sample";

describe("demo sample parts list", () => {
  it("parses and flags the covered parts with the keyword classifier", async () => {
    const parts = await parsePartsFile(DEMO_FILE_NAME, demoCsvBytes());
    expect(parts).toHaveLength(8);
    const flagged = parts.filter((p) => keywordClassify(`${p.partNumber} ${p.description}`).materials.some((m) => m !== "other")).map((p) => p.partNumber);
    expect(flagged).toEqual(["EM-1001", "EM-2040", "EM-3310", "EM-4100", "EM-5200", "EM-7300"]);
    expect(flagged).not.toContain("EM-6001");
    expect(flagged).not.toContain("EM-6002");
  });
  it("sorts the sample into likely / possible / not likely", async () => {
    const parts = await parsePartsFile(DEMO_FILE_NAME, demoCsvBytes());
    const cov = Object.fromEntries(parts.map((p) => [p.partNumber, classifyPart(p).coverage]));
    expect(cov).toEqual({
      "EM-1001": "likely",
      "EM-2040": "likely",
      "EM-3310": "possible",
      "EM-4100": "likely",
      "EM-5200": "likely",
      "EM-6001": "not_likely",
      "EM-6002": "not_likely",
      "EM-7300": "possible",
    });
  });
});
