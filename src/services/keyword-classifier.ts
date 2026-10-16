/**
 * Deterministic keyword prefilter / fallback classifier. Pure.
 * Used as the LLM mock (no API key), as the fallback when the LLM output does
 * not validate, and to keep results explainable.
 */
import type { Material } from "@/domain/types";

const RULES: { material: Material; re: RegExp; why: string }[] = [
  { material: "smco", re: /\b(smco|sm-?co|samarium)\b/i, why: "mentions samarium-cobalt" },
  { material: "ndfeb", re: /\b(ndfeb|nd-?fe-?b|neodymium|rare[-\s]?earth magnet|permanent magnet)\b/i, why: "mentions NdFeB / permanent magnet" },
  { material: "ndfeb", re: /\b(bldc|brushless|servo|stepper|motor|actuator|speaker|loudspeaker|headphone|transducer|generator|alternator|hall[-\s]?effect|encoder|solenoid|magnet)\b/i, why: "motor/actuator/speaker/sensor class part usually contains NdFeB magnets" },
  { material: "tantalum", re: /\b(tantalum|ta\s?cap|tant\.?\s?cap|cap(acitor)?[,\s]+(tant|ta)\b)/i, why: "tantalum capacitor or alloy" },
  { material: "tungsten", re: /\b(tungsten|wolfram|heavy[-\s]?alloy|penetrator|ballast|counter-?weight|w-?ni-?fe|w-?cu)\b/i, why: "tungsten / heavy-alloy part" },
];

export function keywordClassify(text: string): { materials: Material[]; confidence: number; rationale: string } {
  const hits = new Map<Material, string>();
  for (const r of RULES) if (r.re.test(text) && !hits.has(r.material)) hits.set(r.material, r.why);
  // An explicit SmCo mention means the generic "motor" hit should not add NdFeB.
  if (hits.has("smco") && hits.get("ndfeb")?.startsWith("motor")) hits.delete("ndfeb");
  if (hits.size === 0) return { materials: ["other"], confidence: 0.5, rationale: "no critical-mineral keywords" };
  const explicit = [...hits.values()].some((w) => w.startsWith("mentions") || w.includes("tantalum capacitor"));
  return {
    materials: [...hits.keys()],
    confidence: explicit ? 0.85 : 0.6,
    rationale: [...hits.values()].join("; "),
  };
}
