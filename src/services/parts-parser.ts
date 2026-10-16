/**
 * Parts-list parser: CSV (papaparse) and XLSX (exceljs), with column-mapping
 * heuristics. Also the upload gate that rejects drawings / CAD / non-tabular
 * files before anything is parsed or stored.
 */
import Papa from "papaparse";
import ExcelJS from "exceljs";
import { DomainError, ValidationError } from "@/domain/errors";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_ROWS = 2000;

export interface ParsedPart {
  rowIndex: number;
  partNumber: string | null;
  description: string;
  supplierName: string | null;
  quantity: number | null;
}

export type PartsFileKind = "csv" | "xlsx";

/** Extensions that indicate a drawing, CAD model, image or document. */
const DRAWING_EXTENSIONS = new Set([
  "dwg", "dxf", "step", "stp", "iges", "igs", "stl", "sldprt", "sldasm", "slddrw",
  "ipt", "iam", "idw", "catpart", "catproduct", "prt", "asm", "x_t", "3dm", "jt",
  "pdf", "png", "jpg", "jpeg", "tif", "tiff", "bmp", "gif", "svg", "heic", "webp",
]);

function ext(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
}

/**
 * Decides whether the upload is an acceptable parts list. Checks extension
 * AND content (magic bytes), so a renamed drawing is still refused.
 */
export function detectPartsFileKind(fileName: string, bytes: Uint8Array): PartsFileKind {
  if (bytes.byteLength === 0) throw new ValidationError("FILE_EMPTY", "The file is empty.", "file");
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new DomainError("payload_too_large", "FILE_TOO_LARGE", "Files must be 5 MB or smaller.", "file");
  }
  const e = ext(fileName);
  if (DRAWING_EXTENSIONS.has(e)) {
    throw new DomainError(
      "unsupported",
      "DRAWING_REJECTED",
      "Lodeline does not accept drawings, CAD files, images or PDFs. Upload a CSV or XLSX parts list (part number, description, supplier) only.",
      "file"
    );
  }
  const head = bytes.subarray(0, 8);
  const isZip = head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
  const isPdf = head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46;
  const isOle = head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0; // legacy .xls/.dwg-ish
  const isDwg = head[0] === 0x41 && head[1] === 0x43 && head[2] === 0x31 && head[3] === 0x30; // "AC10"
  if (isPdf || isDwg) {
    throw new DomainError("unsupported", "DRAWING_REJECTED", "This looks like a drawing or PDF. Upload a CSV or XLSX parts list only.", "file");
  }
  if (e === "xlsx") {
    if (!isZip) throw new DomainError("unsupported", "FILE_TYPE_MISMATCH", "This file is not a valid XLSX workbook.", "file");
    return "xlsx";
  }
  if (e === "csv" || e === "txt") {
    if (isZip || isOle) throw new DomainError("unsupported", "FILE_TYPE_MISMATCH", "This file is not plain-text CSV.", "file");
    const sample = bytes.subarray(0, Math.min(bytes.byteLength, 8192));
    if (sample.includes(0)) throw new DomainError("unsupported", "FILE_TYPE_MISMATCH", "This file is not plain-text CSV.", "file");
    if (/^\s*(0\s*\r?\n\s*SECTION|ISO-10303-21)/.test(new TextDecoder().decode(sample.subarray(0, 64)))) {
      throw new DomainError("unsupported", "DRAWING_REJECTED", "This looks like a CAD exchange file. Upload a parts list only.", "file");
    }
    return "csv";
  }
  throw new DomainError("unsupported", "FILE_TYPE_UNSUPPORTED", "Upload a .csv or .xlsx parts list.", "file");
}

const HEADER_PATTERNS: Record<keyof Omit<ParsedPart, "rowIndex">, RegExp> = {
  partNumber: /^(part\s*(no|num|number|#)?|p\/?n|item\s*(no|number)?|mpn|sku)\.?$/i,
  description: /^(desc(ription)?|part\s*name|name|item\s*desc(ription)?|component)$/i,
  supplierName: /^(supplier|vendor|manufacturer|mfr|mfg|source)(\s*name)?$/i,
  quantity: /^(qty|quantity|count|units?)$/i,
};

export function mapColumns(headers: string[]): Partial<Record<keyof Omit<ParsedPart, "rowIndex">, number>> {
  const out: Partial<Record<keyof Omit<ParsedPart, "rowIndex">, number>> = {};
  headers.forEach((raw, i) => {
    const h = raw.trim();
    for (const [key, re] of Object.entries(HEADER_PATTERNS) as [keyof typeof HEADER_PATTERNS, RegExp][]) {
      if (out[key] === undefined && re.test(h)) {
        out[key] = i;
        return;
      }
    }
  });
  // Fallback: a header merely containing "desc" counts as description.
  if (out.description === undefined) {
    const i = headers.findIndex((h) => /desc/i.test(h));
    if (i >= 0) out.description = i;
  }
  return out;
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && v !== null) {
    const o = v as { text?: unknown; result?: unknown; richText?: { text: string }[] };
    if (Array.isArray(o.richText)) return o.richText.map((r) => r.text).join("").trim();
    if (o.text !== undefined) return String(o.text).trim();
    if (o.result !== undefined) return String(o.result).trim();
  }
  return String(v).trim();
}

export function rowsToParts(rows: unknown[][]): ParsedPart[] {
  const headerIdx = rows.findIndex((r) => r.some((c) => cell(c) !== ""));
  if (headerIdx < 0) throw new ValidationError("FILE_NO_ROWS", "No rows found.", "file");
  const headers = rows[headerIdx].map(cell);
  const cols = mapColumns(headers);
  if (cols.description === undefined) {
    throw new ValidationError(
      "COLUMN_DESCRIPTION_MISSING",
      "Could not find a description column. Add a header such as 'Description'.",
      "file"
    );
  }
  const parts: ParsedPart[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const description = cell(r[cols.description]);
    const partNumber = cols.partNumber !== undefined ? cell(r[cols.partNumber]) : "";
    if (!description && !partNumber) continue;
    if (parts.length >= MAX_ROWS) {
      throw new ValidationError("FILE_TOO_MANY_ROWS", `Parts lists are limited to ${MAX_ROWS} rows.`, "file");
    }
    const supplier = cols.supplierName !== undefined ? cell(r[cols.supplierName]) : "";
    const qtyRaw = cols.quantity !== undefined ? cell(r[cols.quantity]).replace(/,/g, "") : "";
    const qty = qtyRaw === "" ? null : Number(qtyRaw);
    parts.push({
      rowIndex: i,
      partNumber: partNumber || null,
      description: (description || partNumber).slice(0, 1000),
      supplierName: supplier || null,
      quantity: qty !== null && Number.isFinite(qty) ? qty : null,
    });
  }
  if (parts.length === 0) throw new ValidationError("FILE_NO_ROWS", "No parts rows found.", "file");
  return parts;
}

export function parseCsv(text: string): ParsedPart[] {
  const res = Papa.parse<string[]>(text.replace(/^\uFEFF/, ""), { skipEmptyLines: true });
  return rowsToParts(res.data);
}

export async function parseXlsx(bytes: Uint8Array): Promise<ParsedPart[]> {
  const wb = new ExcelJS.Workbook();
  // exceljs' types expect a Node Buffer.
  await wb.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new ValidationError("FILE_NO_ROWS", "The workbook has no sheets.", "file");
  const rows: unknown[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const values = row.values as unknown[]; // 1-indexed
    rows.push(values.slice(1));
    if (rows.length > MAX_ROWS + 10) return;
  });
  return rowsToParts(rows);
}

export async function parsePartsFile(fileName: string, bytes: Uint8Array): Promise<ParsedPart[]> {
  const kind = detectPartsFileKind(fileName, bytes);
  return kind === "csv" ? parseCsv(new TextDecoder().decode(bytes)) : parseXlsx(bytes);
}
