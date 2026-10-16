import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { detectPartsFileKind, mapColumns, parseCsv, parsePartsFile, MAX_ROWS } from "./parts-parser";

const enc = (s: string) => new TextEncoder().encode(s);

describe("parts parser", () => {
  it("maps common header variants", () => {
    expect(mapColumns(["P/N", "Item Description", "Vendor", "Qty"])).toEqual({ partNumber: 0, description: 1, supplierName: 2, quantity: 3 });
  });

  it("parses CSV with BOM, blank lines and quantities", () => {
    const parts = parseCsv("\uFEFFPart Number,Description,Supplier,Qty\nM-1,BLDC motor 24V,Acme,1,000\n\nC-2,Capacitor tantalum 10uF,Kemet,50\n");
    expect(parts).toHaveLength(2);
    expect(parts[0]).toMatchObject({ partNumber: "M-1", description: "BLDC motor 24V", supplierName: "Acme" });
    expect(parts[1].quantity).toBe(50);
  });

  it("requires a description column", () => {
    expect(() => parseCsv("foo,bar\n1,2\n")).toThrow(/description column/);
  });

  it("caps rows", () => {
    const rows = Array.from({ length: MAX_ROWS + 1 }, (_, i) => `P${i},widget`).join("\n");
    expect(() => parseCsv(`pn,description\n${rows}`)).toThrow(/limited/);
  });

  it("parses XLSX", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("BOM");
    ws.addRow(["Part No", "Description", "Manufacturer"]);
    ws.addRow(["A-1", "Servo actuator", "Moog"]);
    const buf = new Uint8Array(await wb.xlsx.writeBuffer());
    const parts = await parsePartsFile("bom.xlsx", buf);
    expect(parts).toEqual([{ rowIndex: 1, partNumber: "A-1", description: "Servo actuator", supplierName: "Moog", quantity: null }]);
  });

  it.each(["rotor.dwg", "housing.step", "assy.pdf", "photo.png", "part.dxf", "x.sldprt"])("rejects drawing-like file %s", (name) => {
    expect(() => detectPartsFileKind(name, enc("anything"))).toThrow(expect.objectContaining({ code: "DRAWING_REJECTED" }));
  });

  it("rejects a PDF renamed to .csv", () => {
    expect(() => detectPartsFileKind("bom.csv", enc("%PDF-1.7 ..."))).toThrow(expect.objectContaining({ code: "DRAWING_REJECTED" }));
  });

  it("rejects a DXF renamed to .csv", () => {
    expect(() => detectPartsFileKind("bom.csv", enc("0\nSECTION\n2\nHEADER"))).toThrow(expect.objectContaining({ code: "DRAWING_REJECTED" }));
  });

  it("rejects binary content in a .csv and a non-zip .xlsx", () => {
    expect(() => detectPartsFileKind("bom.csv", new Uint8Array([1, 0, 2]))).toThrow(expect.objectContaining({ code: "FILE_TYPE_MISMATCH" }));
    expect(() => detectPartsFileKind("bom.xlsx", enc("a,b"))).toThrow(expect.objectContaining({ code: "FILE_TYPE_MISMATCH" }));
  });

  it("rejects oversize and unknown types", () => {
    expect(() => detectPartsFileKind("bom.csv", new Uint8Array(5 * 1024 * 1024 + 1))).toThrow(expect.objectContaining({ code: "FILE_TOO_LARGE" }));
    expect(() => detectPartsFileKind("bom.docx", enc("x"))).toThrow(expect.objectContaining({ code: "FILE_TYPE_UNSUPPORTED" }));
  });
});
