/** Per-page PDF text via unpdf (pdf.js). No OCR: scans come back empty. */
import { extractText, getDocumentProxy } from "unpdf";

export const MAX_PDF_PAGES = 60;

export async function extractPdfPages(bytes: Uint8Array): Promise<string[]> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  if (pdf.numPages > MAX_PDF_PAGES) throw new Error(`PDF has ${pdf.numPages} pages; limit is ${MAX_PDF_PAGES}`);
  const { text } = await extractText(pdf, { mergePages: false });
  return (text as string[]).map((t) => t ?? "");
}
