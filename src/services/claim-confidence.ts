/**
 * Deterministic confidence score for an extracted claim. Pure, no I/O, no LLM.
 *
 * Every field that reaches a claim already passed the verbatim-quote filter
 * (claim-verify.ts). The score says how complete and consistent the claim is:
 *   - weights for the fields a reviewer needs (stage and country matter most)
 *   - minus 0.1 for each field the extractor proposed but could not quote verbatim
 *   - minus 0.15 when the stated country and the geocoded country disagree
 * Clamped to 0..1 and rounded to two decimals. It ranks the review queue; it
 * never accepts or rejects anything by itself.
 */
import type { VerifiedClaim } from "./claim-verify";

export const CONFIDENCE_WEIGHTS = { stage: 0.25, country: 0.25, facilityName: 0.2, address: 0.15, issuer: 0.1, issueDate: 0.05 } as const;

export function claimConfidence(c: Pick<VerifiedClaim, keyof typeof CONFIDENCE_WEIGHTS | "dropped">, opts: { countryMismatch?: boolean } = {}): number {
  let score = 0;
  for (const [field, w] of Object.entries(CONFIDENCE_WEIGHTS) as [keyof typeof CONFIDENCE_WEIGHTS, number][]) {
    const v = c[field];
    if (v !== null && v !== undefined && String(v).trim() !== "") score += w;
  }
  score -= 0.1 * c.dropped.length;
  if (opts.countryMismatch) score -= 0.15;
  return Math.round(Math.min(1, Math.max(0, score)) * 100) / 100;
}

export function confidenceLabel(score: number | null | undefined): "high" | "medium" | "low" | "unscored" {
  if (score === null || score === undefined) return "unscored";
  if (score >= 0.75) return "high";
  if (score >= 0.45) return "medium";
  return "low";
}
