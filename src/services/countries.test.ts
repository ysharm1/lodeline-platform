import { describe, expect, it } from "vitest";
import { COVERED_COUNTRIES, flagCoveredCountry, isCoveredIso, toIso2 } from "./countries";

describe("covered-country flagging", () => {
  it("normalises names and codes", () => {
    expect(toIso2("People's Republic of China")).toBe("CN");
    expect(toIso2(" russian  federation ")).toBe("RU");
    expect(toIso2("DPRK")).toBe("KP");
    expect(toIso2("Islamic Republic of Iran")).toBe("IR");
    expect(toIso2("South Korea")).toBe("KR");
    expect(toIso2("us")).toBe("US");
    expect(toIso2("Atlantis")).toBeNull();
  });
  it("exactly CN, RU, IR, KP are covered", () => {
    expect([...COVERED_COUNTRIES]).toEqual(["CN", "RU", "IR", "KP"]);
    for (const c of ["CN", "ru", "IR", "KP"]) expect(isCoveredIso(c)).toBe(true);
    for (const c of ["KR", "TW", "HK", "US", "JP", "MN", null, ""]) expect(isCoveredIso(c)).toBe(false);
  });
  it("flags from the stated country", () => {
    expect(flagCoveredCountry("China", null)).toMatchObject({ covered: true, countryIso: "CN" });
  });
  it("flags from the geocoded address even if the stated country is not covered", () => {
    const f = flagCoveredCountry("Japan", "CN");
    expect(f.covered).toBe(true);
    expect(f.countryIso).toBe("CN");
    expect(f.reason).toMatch(/differs/);
  });
  it("does not flag non-covered or unknown", () => {
    expect(flagCoveredCountry("Estonia", "EE")).toEqual({ covered: false, countryIso: "EE", reason: null });
    expect(flagCoveredCountry(null, null)).toEqual({ covered: false, countryIso: null, reason: null });
  });
  it("is deterministic", () => {
    for (let i = 0; i < 50; i++) expect(flagCoveredCountry("Russia", "RU").covered).toBe(true);
  });
});
