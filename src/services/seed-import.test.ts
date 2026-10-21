import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseSeed } from "./seed-import";

const fixture = () => JSON.parse(readFileSync(join(__dirname, "..", "..", "test", "fixtures", "seed-example.json"), "utf8"));

describe("supplier seed parsing (fictional fixture)", () => {
  it("maps the export shape and keeps recycling/distribution as activities", () => {
    const { rows } = parseSeed(fixture());
    expect(rows.map((r) => r.sourceKey)).toEqual(["example-magnet-co", "example-separation-tw", "example-recycler-ca"]);
    const tw = rows.find((r) => r.sourceKey === "example-separation-tw")!;
    expect(tw).toMatchObject({ countryIso: "TW", region: "Taiwan", stages: ["separation", "metal_alloy"], materials: ["ndfeb", "other"], productionStatus: "pilot", published: false });
    const rc = rows.find((r) => r.sourceKey === "example-recycler-ca")!;
    expect(rc.stages).toEqual([]);
    expect(rc.activities).toEqual(["recycling", "distribution"]);
  });
  it("rejects rows with an email address or a covered-country location", () => {
    const { rejected } = parseSeed(fixture());
    expect(rejected).toEqual([
      { key: "example-covered-row", reason: "covered-country location" },
      { key: "example-row-with-contact", reason: "contains an email address" },
    ]);
  });
  it("rejects bad ids, duplicates and a wrong file shape", () => {
    const f = fixture();
    f.suppliers.push({ ...f.suppliers[0] }, { ...f.suppliers[0], id: "Bad Id!" });
    const { rejected } = parseSeed(f);
    expect(rejected).toContainEqual({ key: "example-magnet-co", reason: "duplicate id" });
    expect(rejected).toContainEqual({ key: "Bad Id!", reason: "invalid id" });
    expect(() => parseSeed({ rows: [] })).toThrow(/suppliers/);
  });
});
