import { describe, expect, it } from "vitest";
import { parsePartsFile } from "./parts-parser";
import { keywordClassify } from "./keyword-classifier";
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
});
