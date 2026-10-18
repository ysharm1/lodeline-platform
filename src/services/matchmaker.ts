/**
 * Matchmaker: for each flagged part's open stages (no accepted document, or an
 * accepted record in a covered country), suggest published directory listings
 * that say they work that material at that stage, outside the covered
 * countries (CN, RU, IR, KP). Pure ranking; the DB read is in DirectoryService.
 *
 * Ranking: verified-from-evidence first, then real listings before example
 * rows, then name. Never by payment (docs/business-model.md). A suggestion is
 * an introduction lead, not a finding: it never changes a pack's matrix.
 */
import type { Material, Stage } from "@/domain/types";
import { isCoveredIso } from "./countries";
import type { MatrixRow } from "./pack-matrix";

export interface MatchListing {
  id: string;
  name: string;
  city: string | null;
  countryIso: string | null;
  stages: string[];
  materials: string[];
  verified: boolean;
  isExample: boolean;
}

export interface StageNeed {
  material: Material;
  stage: Stage;
  /** "covered_country" = the accepted source is in a covered country; otherwise no accepted document yet. */
  reason: "no_document" | "covered_country";
}

export interface PartMatches {
  partId: string;
  partNumber: string | null;
  description: string;
  needs: (StageNeed & { suggestions: MatchListing[] })[];
}

export const MAX_SUGGESTIONS_PER_NEED = 3;

export function rankListings(listings: MatchListing[], material: Material, stage: Stage, limit = MAX_SUGGESTIONS_PER_NEED): MatchListing[] {
  return listings
    .filter((l) => l.materials.includes(material) && l.stages.includes(stage) && !isCoveredIso(l.countryIso))
    .sort((a, b) => Number(b.verified) - Number(a.verified) || Number(a.isExample) - Number(b.isExample) || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/** Open needs per part from the pack matrix, each with up to 3 ranked suggestions. */
export function matchPackRows(rows: MatrixRow[], listings: MatchListing[]): PartMatches[] {
  const out: PartMatches[] = [];
  for (const r of rows) {
    const needs: PartMatches["needs"] = [];
    for (const cell of r.cells) {
      if (cell.status === "documented") continue;
      const reason = cell.status === "covered_country" ? "covered_country" : "no_document";
      // Unknown material on a "possible" part: the signals were magnet-related, so look for magnet-chain sources.
      const mats = r.part.materials.filter((x) => x !== "other");
      for (const m of mats.length ? mats : (["ndfeb", "smco"] as Material[])) {
        needs.push({ material: m, stage: cell.stage, reason, suggestions: rankListings(listings, m, cell.stage) });
      }
    }
    if (needs.length) out.push({ partId: r.part.id, partNumber: r.part.partNumber, description: r.part.description, needs });
  }
  return out;
}

/** Material x stage needs straight from free-audit parts (no pack yet). */
export function auditNeeds(parts: { coverage: string; materials: string[]; undocumentedStages: string[] }[]): { material: Material; stage: Stage }[] {
  const seen = new Map<string, { material: Material; stage: Stage }>();
  for (const p of parts) {
    if (p.coverage === "not_likely") continue;
    for (const m of p.materials) {
      if (m === "other") continue;
      for (const s of p.undocumentedStages) seen.set(`${m}:${s}`, { material: m as Material, stage: s as Stage });
    }
  }
  return [...seen.values()];
}
