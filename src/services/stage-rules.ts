/**
 * Deterministic stage rules. Pure, no I/O.
 *
 * For each material the required supply-chain stages are fixed. A stage is
 * "undocumented" unless an ACCEPTED evidence claim covers it. In the free
 * audit there are no claims yet, so every required stage is undocumented.
 */
import type { Material, Stage } from "@/domain/types";

export const RULE_VERSION = "stages-v1";

export const REQUIRED_STAGES: Record<Material, readonly Stage[]> = {
  ndfeb: ["mine", "separation", "metal_alloy", "magnet"],
  smco: ["mine", "separation", "metal_alloy", "magnet"],
  tungsten: ["mine", "separation", "metal_alloy"],
  tantalum: ["mine", "separation", "metal_alloy"],
  other: [],
};

export interface AcceptedClaim {
  stage: Stage;
  material?: Material | null;
}

const STAGE_ORDER: readonly Stage[] = ["mine", "separation", "metal_alloy", "magnet", "component"];

export function undocumentedStages(materials: readonly Material[], accepted: readonly AcceptedClaim[] = []): Stage[] {
  const missing = new Set<Stage>();
  for (const m of materials) {
    for (const s of REQUIRED_STAGES[m]) {
      const covered = accepted.some((c) => c.stage === s && (c.material == null || c.material === m));
      if (!covered) missing.add(s);
    }
  }
  return STAGE_ORDER.filter((s) => missing.has(s));
}

export const STAGE_LABELS: Record<Stage, string> = {
  mine: "Mining",
  separation: "Separation / refining",
  metal_alloy: "Metal / alloy",
  magnet: "Magnet manufacture",
  component: "Component",
};

export const MATERIAL_LABELS: Record<Material, string> = {
  ndfeb: "NdFeB magnet",
  smco: "SmCo magnet",
  tungsten: "Tungsten",
  tantalum: "Tantalum",
  other: "No critical mineral flagged",
};
