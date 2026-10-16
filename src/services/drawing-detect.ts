/**
 * Drawing / controlled-technical-data rejection for supplier evidence.
 * Pure. Inputs: file name, first bytes, and (for PDFs) per-page text.
 */
export const EVIDENCE_MAX_BYTES = 20 * 1024 * 1024;
export const EVIDENCE_ALLOWED_EXT = ["pdf"] as const;

const CAD_EXT = /\.(dwg|dxf|step|stp|iges|igs|stl|sldprt|sldasm|slddrw|ipt|iam|idw|catpart|catproduct|prt|asm|x_t|3dm|jt|dwf|plt|gbr)$/i;

/** Title-block / drawing-sheet vocabulary. */
const TITLE_BLOCK = [
  /\bSCALE\b/i, /\bREV(ISION)?\b/i, /\bSHEET\s+\d+\s+OF\s+\d+\b|\bSHEET\b/i, /\bDRAWN\s*(BY)?\b/i, /\bCHECKED\s*(BY)?\b/i,
  /\bAPPROVED\b/i, /\bDWG\.?\s*(NO|NUMBER)\b/i, /\bTOLERANCES?\b/i, /UNLESS\s+OTHERWISE\s+SPECIFIED/i,
  /THIRD\s+ANGLE\s+PROJECTION|FIRST\s+ANGLE\s+PROJECTION/i, /\bCAGE\s+CODE\b/i, /\bSIZE\s+[A-E]\b/i, /\bDIMENSIONS\s+ARE\s+IN\b/i,
  /\bITAR\b|\bEXPORT\s+CONTROLLED\b|\bEAR99\b|\bCUI\b/i,
];

export type DrawingVerdict =
  | { ok: true; needsManualReview?: "no_text_layer" }
  | { ok: false; reason: "cad_file" | "not_pdf" | "too_large" | "technical_drawing" | "export_controlled_marking"; detail: string };

export function preflightEvidenceFile(fileName: string, sizeBytes: number, head?: Uint8Array): DrawingVerdict {
  if (CAD_EXT.test(fileName)) return { ok: false, reason: "cad_file", detail: "CAD/drawing file types are not accepted." };
  if (!/\.pdf$/i.test(fileName)) return { ok: false, reason: "not_pdf", detail: "Upload PDF certificates or declarations only." };
  if (sizeBytes > EVIDENCE_MAX_BYTES) return { ok: false, reason: "too_large", detail: "Files must be 20 MB or smaller." };
  if (head && !(head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46)) {
    return { ok: false, reason: "not_pdf", detail: "This file is not a PDF." };
  }
  return { ok: true };
}

/**
 * Heuristic on extracted text:
 *  - explicit ITAR / export-controlled / CUI markings -> reject
 *  - any page with very little prose (< 600 chars) and >= 3 title-block terms -> drawing
 *  - >= 5 title-block terms on a page regardless of length -> drawing
 *  - no text at all -> accept but flag for manual review (likely a scan)
 */
export function detectDrawingFromText(pages: string[]): DrawingVerdict {
  const all = pages.join("\n");
  if (/\bITAR\b|\bEXPORT[\s-]+CONTROLLED\b|\bCONTROLLED\s+UNCLASSIFIED\b|\bCUI\b/i.test(all) && !/not\s+(subject\s+to\s+)?(ITAR|export[\s-]+controlled)/i.test(all)) {
    return { ok: false, reason: "export_controlled_marking", detail: "Document carries an export-control/CUI marking." };
  }
  if (all.trim().length === 0) return { ok: true, needsManualReview: "no_text_layer" };
  for (let i = 0; i < pages.length; i++) {
    const text = pages[i];
    const hits = TITLE_BLOCK.filter((re) => re.test(text)).length;
    const prose = text.replace(/\s+/g, " ").trim().length;
    if ((prose < 600 && hits >= 3) || hits >= 5) {
      return { ok: false, reason: "technical_drawing", detail: `Page ${i + 1} looks like a drawing sheet (${hits} title-block terms).` };
    }
  }
  return { ok: true };
}
