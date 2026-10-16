/**
 * Verbatim-citation filter. An LLM (or the mock extractor) proposes claims with
 * per-field citations {field, page, quote}. We keep a field ONLY if its quote
 * appears verbatim (whitespace-normalised, case-sensitive) on the cited page,
 * and the value itself appears in that quote. A claim with no verified field
 * is dropped.
 */
import { STAGES, type Stage } from "@/domain/types";

export const CLAIM_FIELDS = ["issuer", "issueDate", "stage", "facilityName", "address", "country"] as const;
export type ClaimField = (typeof CLAIM_FIELDS)[number];

export interface Citation {
  field: ClaimField;
  page: number; // 1-based
  quote: string;
}
export interface ProposedClaim {
  issuer?: string | null;
  issueDate?: string | null;
  stage?: string | null;
  facilityName?: string | null;
  address?: string | null;
  country?: string | null;
  citations: Citation[];
}
export interface VerifiedClaim {
  issuer: string | null;
  issueDate: Date | null;
  stage: Stage | null;
  facilityName: string | null;
  address: string | null;
  country: string | null;
  citations: Citation[];
  dropped: ClaimField[];
}

export const normalizeWs = (s: string) => s.replace(/\s+/g, " ").trim();

/** Stage values need not appear literally ("smelter" supports metal_alloy); the quote must still be verbatim. */
const STAGE_WORDS: Record<Stage, RegExp> = {
  mine: /\b(mine|mining|mined|ore|concentrate)\b/i,
  separation: /\b(separat\w*|refin\w*|oxide|solvent extraction)\b/i,
  metal_alloy: /\b(metal|alloy|smelt\w*|reduction|melt\w*|strip cast\w*)\b/i,
  magnet: /\b(magnet\w*|sinter\w*)\b/i,
  component: /\b(component|assembl\w*|motor|actuator)\b/i,
};

function valueSupported(field: ClaimField, value: string, quote: string): boolean {
  const q = normalizeWs(quote).toLowerCase();
  if (field === "stage") return (STAGES as readonly string[]).includes(value) && STAGE_WORDS[value as Stage].test(quote);
  if (field === "issueDate") {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return false;
    const y = String(d.getUTCFullYear());
    return q.includes(y);
  }
  return q.includes(normalizeWs(value).toLowerCase());
}

export function verifyClaims(proposed: ProposedClaim[], pages: string[]): VerifiedClaim[] {
  const normPages = pages.map(normalizeWs);
  const out: VerifiedClaim[] = [];
  for (const c of proposed) {
    const v: VerifiedClaim = { issuer: null, issueDate: null, stage: null, facilityName: null, address: null, country: null, citations: [], dropped: [] };
    for (const field of CLAIM_FIELDS) {
      const value = c[field];
      if (value === undefined || value === null || String(value).trim() === "") continue;
      const cite = (c.citations ?? []).find(
        (x) =>
          x.field === field &&
          Number.isInteger(x.page) &&
          x.page >= 1 &&
          x.page <= pages.length &&
          normalizeWs(x.quote ?? "").length >= 3 &&
          normPages[x.page - 1].includes(normalizeWs(x.quote)) &&
          valueSupported(field, String(value), x.quote)
      );
      if (!cite) {
        v.dropped.push(field);
        continue;
      }
      v.citations.push({ field, page: cite.page, quote: normalizeWs(cite.quote) });
      if (field === "issueDate") v.issueDate = new Date(String(value));
      else if (field === "stage") v.stage = value as Stage;
      else v[field] = String(value).trim();
    }
    if (v.citations.length > 0) out.push(v);
  }
  return out;
}
