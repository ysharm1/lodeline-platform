/**
 * Deterministic claim extractor used when no LLM key is configured (and in
 * tests). Reads "Label: value" lines and stage keywords; every quote it emits
 * is an exact line from the page, so it passes the verbatim filter.
 */
import type { ProposedClaim, Citation } from "./claim-verify";

const LABELS: { field: Exclude<Citation["field"], "stage">; re: RegExp }[] = [
  { field: "issuer", re: /^(issuer|issued by|certifying body|company|supplier)\s*[:\-]\s*(.+)$/i },
  { field: "issueDate", re: /^(date|issue date|date of issue|issued on)\s*[:\-]\s*(.+)$/i },
  { field: "facilityName", re: /^(facility|plant|site|mill|smelter|refinery|mine)\s*(name)?\s*[:\-]\s*(.+)$/i },
  { field: "address", re: /^(address|facility address|location)\s*[:\-]\s*(.+)$/i },
  { field: "country", re: /^(country|country of origin|origin)\s*[:\-]\s*(.+)$/i },
];
const STAGE_RE: [string, RegExp][] = [
  ["magnet", /^(stage|process)\s*[:\-]\s*.*\b(magnet|sinter)/i],
  ["metal_alloy", /^(stage|process)\s*[:\-]\s*.*\b(metal|alloy|smelt|melt)/i],
  ["separation", /^(stage|process)\s*[:\-]\s*.*\b(separat|refin)/i],
  ["mine", /^(stage|process)\s*[:\-]\s*.*\b(mine|mining|ore)/i],
];

export function mockExtractClaims(pages: string[]): ProposedClaim[] {
  const claims: ProposedClaim[] = [];
  pages.forEach((text, i) => {
    const page = i + 1;
    let cur: ProposedClaim | null = null;
    const flush = () => {
      if (cur && cur.citations.length) claims.push(cur);
      cur = null;
    };
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      if (/^-{3,}$/.test(line)) {
        flush();
        continue;
      }
      for (const { field, re } of LABELS) {
        const m = line.match(re);
        if (m) {
          cur ??= { citations: [] };
          const value = m[m.length - 1].trim();
          (cur as unknown as Record<string, unknown>)[field] = field === "issueDate" ? (Number.isNaN(new Date(value).getTime()) ? null : new Date(value).toISOString().slice(0, 10)) : value;
          cur.citations.push({ field, page, quote: line });
        }
      }
      for (const [stage, re] of STAGE_RE) {
        if (re.test(line)) {
          cur ??= { citations: [] };
          cur.stage = stage;
          cur.citations.push({ field: "stage", page, quote: line });
          break;
        }
      }
    }
    flush();
  });
  return claims;
}
