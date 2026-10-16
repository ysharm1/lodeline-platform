import { describe, expect, it } from "vitest";
import { detectDrawingFromText, preflightEvidenceFile } from "./drawing-detect";

describe("evidence drawing rejection", () => {
  it("preflight: PDF only, no CAD, size cap, magic bytes", () => {
    expect(preflightEvidenceFile("rotor.dwg", 10)).toMatchObject({ ok: false, reason: "cad_file" });
    expect(preflightEvidenceFile("cert.docx", 10)).toMatchObject({ ok: false, reason: "not_pdf" });
    expect(preflightEvidenceFile("cert.pdf", 21 * 1024 * 1024)).toMatchObject({ ok: false, reason: "too_large" });
    expect(preflightEvidenceFile("cert.pdf", 10, new TextEncoder().encode("PK\u0003\u0004"))).toMatchObject({ ok: false, reason: "not_pdf" });
    expect(preflightEvidenceFile("cert.pdf", 10, new TextEncoder().encode("%PDF-1.7"))).toEqual({ ok: true });
  });
  it("rejects a sparse page with title-block vocabulary", () => {
    const sheet = "HOUSING, ROTOR\nDRAWN BY JS  CHECKED KL\nSCALE 2:1  SHEET 1 OF 2  REV C\nUNLESS OTHERWISE SPECIFIED DIMENSIONS ARE IN MM";
    expect(detectDrawingFromText(["Cover letter with plenty of prose. ".repeat(30), sheet])).toMatchObject({ ok: false, reason: "technical_drawing", detail: expect.stringContaining("Page 2") });
  });
  it("accepts a normal certificate that mentions 'revision' once", () => {
    const cert = "Certificate of Origin\nIssuer: Example Co.\nThis declaration (revision 2) states the separation facility and country of origin for the material supplied. ".repeat(3);
    expect(detectDrawingFromText([cert])).toEqual({ ok: true });
  });
  it("rejects export-control markings, but not a 'not subject to ITAR' statement", () => {
    expect(detectDrawingFromText(["ITAR CONTROLLED TECHNICAL DATA"])).toMatchObject({ ok: false, reason: "export_controlled_marking" });
    expect(detectDrawingFromText(["This product is not subject to ITAR. Country of origin: Japan."])).toEqual({ ok: true });
  });
  it("flags image-only PDFs for manual review instead of rejecting", () => {
    expect(detectDrawingFromText(["", "  "])).toEqual({ ok: true, needsManualReview: "no_text_layer" });
  });
});
