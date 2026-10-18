/**
 * Per part x stage status for a pack. Pure. ONLY accepted claims count as
 * evidence; in-review claims show as "in_review" (pending), never documented.
 */
import type { Material, Stage } from "@/domain/types";
import { REQUIRED_STAGES } from "./stage-rules";

export type CellStatus = "documented" | "covered_country" | "in_review" | "requested" | "no_document";

export interface MatrixPart {
  id: string;
  partNumber: string | null;
  description: string;
  supplierName: string | null;
  materials: Material[];
  /** Free-audit category; "possible" parts are labelled "confirm with supplier" in the pack. */
  coverage?: "likely" | "possible" | "not_likely";
}
export interface MatrixRequest {
  id: string;
  partIds: string[];
  stagesRequested: Stage[];
  revoked: boolean;
}
export interface MatrixClaim {
  id: string;
  requestId: string;
  partId: string | null;
  stage: Stage | null;
  reviewStatus: string;
  coveredCountry: boolean;
}
export interface MatrixCell {
  stage: Stage;
  status: CellStatus;
  claimIds: string[];
}
export interface MatrixRow {
  part: MatrixPart;
  cells: MatrixCell[];
}

export function requiredStagesFor(materials: Material[]): Stage[] {
  const order: Stage[] = ["mine", "separation", "metal_alloy", "magnet", "component"];
  const s = new Set(materials.flatMap((m) => REQUIRED_STAGES[m]));
  return order.filter((x) => s.has(x));
}

/**
 * Stages to document for one part. A "possible" part whose material is unknown
 * (a bare motor, magnet, speaker or actuator) gets the magnet chain, so the
 * supplier is asked to confirm the material and its sources instead of the
 * part silently dropping out of the pack. Not-likely parts need nothing.
 */
export const UNKNOWN_MATERIAL_STAGES: readonly Stage[] = ["mine", "separation", "metal_alloy", "magnet"];
export function stagesForPart(p: { materials: Material[]; coverage?: "likely" | "possible" | "not_likely" | string }): Stage[] {
  if (p.coverage === "not_likely") return [];
  const s = requiredStagesFor(p.materials.filter((m) => m !== "other"));
  if (s.length) return s;
  return p.coverage === "possible" ? [...UNKNOWN_MATERIAL_STAGES] : [];
}

export function buildPackMatrix(parts: MatrixPart[], requests: MatrixRequest[], claims: MatrixClaim[]): MatrixRow[] {
  const reqById = new Map(requests.map((r) => [r.id, r]));
  const appliesTo = (c: MatrixClaim, partId: string) => (c.partId ? c.partId === partId : (reqById.get(c.requestId)?.partIds ?? []).includes(partId));
  return parts
    .filter((p) => stagesForPart(p).length > 0)
    .map((part) => ({
      part,
      cells: stagesForPart(part).map((stage): MatrixCell => {
        const forCell = claims.filter((c) => c.stage === stage && appliesTo(c, part.id));
        const accepted = forCell.filter((c) => c.reviewStatus === "accepted");
        if (accepted.some((c) => c.coveredCountry)) return { stage, status: "covered_country", claimIds: accepted.filter((c) => c.coveredCountry).map((c) => c.id) };
        if (accepted.length) return { stage, status: "documented", claimIds: accepted.map((c) => c.id) };
        if (forCell.some((c) => c.reviewStatus === "in_review")) return { stage, status: "in_review", claimIds: [] };
        if (requests.some((r) => !r.revoked && r.partIds.includes(part.id) && r.stagesRequested.includes(stage))) return { stage, status: "requested", claimIds: [] };
        return { stage, status: "no_document", claimIds: [] };
      }),
    }));
}

export function openQuestions(rows: MatrixRow[], supplierFor: (partId: string) => string | null): string[] {
  const qs: string[] = [];
  const label = (s: Stage) => ({ mine: "mining", separation: "separation/refining", metal_alloy: "metal/alloy", magnet: "magnet manufacture", component: "component" })[s];
  for (const r of rows) {
    for (const c of r.cells) {
      const who = supplierFor(r.part.id) ?? r.part.supplierName ?? "the supplier";
      const pn = r.part.partNumber ?? r.part.description;
      if (c.status === "covered_country") qs.push(`${pn}: the accepted ${label(c.stage)} record indicates a covered country. Ask ${who} whether an alternative source or an applicable exception exists.`);
      else if (c.status !== "documented") qs.push(`${pn}: no accepted ${label(c.stage)} record. Ask ${who} for a document naming the ${label(c.stage)} facility, its address and country.`);
    }
  }
  return qs;
}
