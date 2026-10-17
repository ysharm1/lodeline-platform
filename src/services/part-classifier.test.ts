import { describe, expect, it } from "vitest";
import { classifyPart, matchPatterns, RULES, type PartSignals } from "./keyword-classifier";
import { PART_PATTERNS } from "./part-patterns.data";

const c = (s: PartSignals | string) => classifyPart(typeof s === "string" ? { description: s } : s);

describe("classifier: covered-material words, grades and columns", () => {
  it.each([
    ["Rotor magnet NdFeB arc segment", "ndfeb"],
    ["DISC 1/2 DIA X 1/8 THK N42 NI PLT", "ndfeb"],
    ["Block magnet N52SH", "ndfeb"],
    ["Arc segment N38UH", "ndfeb"],
    ["NEO MAGNET RING 10MM", "ndfeb"],
    ["Rare earth magnet assembly", "ndfeb"],
    ["Position sensor with SmCo 2:17 magnet", "smco"],
    ["MAGNET SMCO5 5MM DIA X 4MM CYL", "smco"],
    ["Sm2Co17 ring magnet", "smco"],
    ["Rotor magnet grade 1:5", "smco"],
    ["MOTOR, BRUSHLESS, SAMARIUM COBALT, 175C", "smco"],
    ["TUNGSTEN 3/32X7 2% LANTH BLUE 10PK", "tungsten"],
    ["Heavy alloy block 17 g/cc", "tungsten"],
    ["W-Ni-Fe slug", "tungsten"],
    ["Densimet D176 bar", "tungsten"],
    ["CAP TANT 10UF 10% 16V 1206", "tantalum"],
    ["Ta cap 47uF 25V", "tantalum"],
    ["CAPACITOR TANTALUM 6.8UF 6.3V RADIAL DIP", "tantalum"],
  ])("%s -> likely %s", (d, m) => {
    const r = c(d);
    expect(r.coverage).toBe("likely");
    expect(r.materials).toEqual([m]);
    expect(r.reason).toMatch(/\[(rule|pattern) /);
  });

  it("SmCo explicitly named beats 'rare earth' implying NdFeB", () => {
    expect(c("Rare earth SmCo magnet").materials).toEqual(["smco"]);
  });

  it("material column counts as evidence and is cited", () => {
    const r = c({ description: "BLDC MOTOR HPHT DOWNHOLE 1.5IN 205C", material: "SMCO" });
    expect(r).toMatchObject({ coverage: "likely", materials: ["smco"] });
    expect(r.reason).toContain("Material column");
    expect(c({ description: "Slug 10mm", material: "W" })).toMatchObject({ coverage: "likely", materials: ["tungsten"] });
    expect(c({ description: "Cap 10uF", material: "Ta" })).toMatchObject({ coverage: "likely", materials: ["tantalum"] });
    expect(c({ description: "Disc 10x2", material: "N42" })).toMatchObject({ coverage: "likely", materials: ["ndfeb"] });
  });

  it("notes column counts too", () => {
    expect(c({ description: "Rotor assy", notes: "magnets NdFeB per spec 123" })).toMatchObject({ coverage: "likely", materials: ["ndfeb"] });
  });

  it("does not read watts or 'W/' as tungsten", () => {
    expect(c("SPEAKER 45MM 6W 4OHM").materials).not.toContain("tungsten");
    expect(c("FRAMELESS MOTOR KIT W/HALL").materials).not.toContain("tungsten");
  });

  it("an N-grade with no magnet context is only possible", () => {
    expect(c("Spacer N42 2mm")).toMatchObject({ coverage: "possible", materials: ["ndfeb"] });
  });

  it("ratio without magnet context is ignored", () => {
    expect(c("Gearbox 1:5 ratio").coverage).toBe("not_likely");
  });
});

describe("classifier: possible / needs check", () => {
  it.each(["DC MOTOR 12V", "SPEAKER 45MM 6W 4OHM", "Linear actuator 50mm stroke", "Magnet holder assembly"])("'%s' alone is needs-check, not NdFeB", (d) => {
    const r = c(d);
    expect(r.coverage).toBe("possible");
    expect(r.materials).toEqual([]);
    expect(r.reason).toMatch(/Needs check/);
    expect(r.uncertain).toBe(true);
  });

  it("BLDC/servo/stepper is possible NdFeB with a reason", () => {
    for (const d of ["BLDC MOTOR 24V 22MM", "Servo actuator", "Stepper motor NEMA 17 permanent magnet", "FRAMELESS MOTOR KIT"]) {
      expect(c(d)).toMatchObject({ coverage: "possible", materials: ["ndfeb"] });
    }
  });

  it("weights are possible tungsten", () => {
    for (const d of ["CRANK BAL WEIGHT .503 DIA", "BALLAST WEIGHT 3.0 IN CUBE", "Counterweight, aileron", "Balance wt 20g"]) {
      expect(c(d)).toMatchObject({ coverage: "possible", materials: ["tungsten"] });
    }
  });

  it("molded polarized capacitor is possible tantalum", () => {
    expect(c("CAP 10UF 16V 10% 1206 MOLDED POLARIZED")).toMatchObject({ coverage: "possible", materials: ["tantalum"] });
    expect(c("Molded polarized housing").coverage).toBe("not_likely");
  });

  it("conflicting signals become possible, never silently cleared", () => {
    const r = c("Ferrite / NdFeB hybrid rotor magnet");
    expect(r.coverage).toBe("possible");
    expect(r.reason).toMatch(/Conflicting signals/);
  });

  it("a row with only a part number is possible, not cleared", () => {
    expect(c({ description: "XJ-221", partNumber: "XJ-221" })).toMatchObject({ coverage: "possible", materials: [] });
  });
});

describe("classifier: clear rules", () => {
  it.each([
    "MAGNET CERAMIC GR8 3 X 2 X 1/8",
    "Ferrite ring magnet",
    "Magnet C8 block",
    "Alnico 5 horseshoe magnet",
    "DC MOTOR 12V BRUSHED, ferrite magnets",
  ])("'%s' is not likely covered with a cited reason", (d) => {
    const r = c(d);
    expect(r.coverage).toBe("not_likely");
    expect(r.uncertain).toBe(false);
    expect(r.reason).toMatch(/Not likely covered: .*\[rule clear\./);
  });

  it("ceramic capacitor is not likely (no magnet false positive from 'ceramic')", () => {
    expect(c("CAP CER 0.1UF 50V X7R 0603")).toMatchObject({ coverage: "not_likely", materials: ["other"] });
  });

  it("no signal is not likely, uncertain (LLM may review), with an explicit reason", () => {
    const r = c("ENCLOSURE DIECAST ALUM 4.4X2.3X1.1");
    expect(r).toMatchObject({ coverage: "not_likely", classifiedBy: "default", uncertain: true });
    expect(r.reason).toMatch(/no covered-material signal/);
  });
});

describe("manufacturer + MPN pattern table", () => {
  it("every pattern cites https sources and a check date, ids are unique", () => {
    const ids = new Set<string>();
    for (const p of PART_PATTERNS) {
      expect(ids.has(p.id)).toBe(false);
      ids.add(p.id);
      expect(p.sources.length).toBeGreaterThan(0);
      for (const s of p.sources) expect(s).toMatch(/^https:\/\//);
      expect(p.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(p.manufacturer || p.mpn).toBeTruthy();
    }
    expect(new Set(RULES.map((r) => r.id)).size).toBe(RULES.length);
  });

  it.each([
    [{ mpn: "T491A106K016AT", manufacturer: "KEMET" }, "kemet.t49x"],
    [{ partNumber: "T491A106K016AT" }, "kemet.t49x"],
    [{ mpn: "T356A685K006AT" }, "kemet.t35x"],
    [{ mpn: "T520V157M006ATE045" }, "kemet.t52x"],
    [{ mpn: "TAJA106K016RNJ", manufacturer: "KYOCERA AVX" }, "avx.taj"],
    [{ mpn: "TPSD107K010R0080" }, "avx.tps"],
    [{ mpn: "TCJA106M006R0300E" }, "avx.tcj"],
    [{ mpn: "293D107X9010D2WE3" }, "vishay.293d"],
    [{ mpn: "T55A156M6R3C0500" }, "vishay.t55"],
    [{ manufacturer: "K&J Magnetics", mpn: "D82" }, "kj.magnetics"],
    [{ manufacturer: "Midwest Tungsten Service", mpn: "40400-03140B2" }, "midwest.tungsten"],
    [{ manufacturer: "Kollmorgen", mpn: "KBMS-25H01-D00" }, "kollmorgen.kbm"],
    [{ manufacturer: "FAULHABER", mpn: "2232 S 024 BX4" }, "faulhaber.bx4.ndfeb"],
    [{ manufacturer: "FAULHABER", mpn: "2230T012S" }, "faulhaber.s.alnico"],
    [{ manufacturer: "Mabuchi Motor", mpn: "RS-380PH-3270" }, "mabuchi.ferrite"],
    [{ manufacturer: "Sensata / BEI Kimco", mpn: "DII15-60-201A" }, "sensata.hpht"],
    [{ supplierName: "Standex-Meder Electronics", mpn: "SMCO5 5X4MM" }, "standex.smco5"],
    [{ manufacturer: "CK Worldwide", mpn: "T3327GL2" }, "ck.tungsten"],
  ])("%o matches %s", (sig, id) => {
    expect(matchPatterns({ description: "x", ...sig }).map((m) => m.pattern.id)).toContain(id);
  });

  it("does not match a ceramic cap from a tantalum maker, or a series without its maker when maker is required", () => {
    expect(matchPatterns({ description: "x", mpn: "C0603C104K5RACTU", manufacturer: "KEMET" })).toEqual([]);
    expect(matchPatterns({ description: "x", mpn: "HT02001" })).toEqual([]);
    expect(matchPatterns({ description: "x", mpn: "RS-380PH-3270" })).toEqual([]);
  });

  it("pattern outcomes drive the category and are cited", () => {
    expect(c({ description: "CAP 10UF 16V 10% 1206 MOLDED POLARIZED", mpn: "TAJA106K016RNJ", manufacturer: "KYOCERA AVX" })).toMatchObject({ coverage: "likely", materials: ["tantalum"], classifiedBy: "table" });
    expect(c({ description: "CRANK BAL WEIGHT", manufacturer: "Midwest Tungsten Service" })).toMatchObject({ coverage: "likely", materials: ["tungsten"] });
    const fh = c({ description: "DC MICROMOTOR 12V 22MM", mpn: "2230T012S", manufacturer: "FAULHABER" });
    expect(fh).toMatchObject({ coverage: "not_likely" });
    expect(fh.reason).toContain("AlNiCo");
    expect(c({ description: "DC MOTOR 12V BRUSHED", mpn: "RS-380PH-3270", manufacturer: "Mabuchi Motor" }).coverage).toBe("not_likely");
    expect(c({ description: "Magnet block", manufacturer: "Arnold Magnetic Technologies" })).toMatchObject({ coverage: "possible", materials: ["ndfeb", "smco"] });
    expect(c({ description: "Magnet block RECOMA 35E", manufacturer: "Arnold Magnetic Technologies" })).toMatchObject({ coverage: "likely", materials: ["smco"] });
    expect(c({ description: "Ceramic magnet block", manufacturer: "K&J Magnetics" }).coverage).toBe("possible");
  });
});
