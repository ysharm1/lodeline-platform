/**
 * Deterministic free-audit classifier. Pure, no I/O.
 *
 * Every row ends in one of three categories, with a reason that cites the rule
 * and the column it matched:
 *   likely      a covered material is named (word, grade, material column) or a
 *               verified manufacturer/MPN pattern says so (part-patterns.data.ts)
 *   possible    a weaker, class-level or conflicting signal: confirm with supplier
 *   not_likely  an explicit non-covered signal (ferrite, AlNiCo, verified ferrite
 *               motor series) or no signal in any column
 *
 * Rows that stay uncertain (possible, or not_likely only because nothing
 * matched) are the only ones that may be sent to the LLM (free-audit.ts).
 */
import type { Coverage, Material } from "@/domain/types";
import { PART_PATTERNS, type PartPattern } from "./part-patterns.data";

export const CLASSIFIER_VERSION = "rules-v2";

export interface PartSignals {
  description: string;
  partNumber?: string | null;
  mpn?: string | null;
  manufacturer?: string | null;
  supplierName?: string | null;
  material?: string | null;
  notes?: string | null;
}

type Field = "description" | "material" | "notes" | "mpn" | "partNumber" | "manufacturer" | "supplierName";
type Strength = "likely" | "possible" | "check" | "clear";
type Domain = "magnet" | "tungsten" | "tantalum";

export const FIELD_LABELS: Record<Field, string> = {
  description: "Description",
  material: "Material column",
  notes: "Notes",
  mpn: "MPN",
  partNumber: "Part number",
  manufacturer: "Manufacturer",
  supplierName: "Supplier",
};

interface Rule {
  id: string;
  domain: Domain;
  strength: Strength;
  materials: Material[];
  re: RegExp;
  fields: Field[];
  why: string;
  /** Rule only counts when this also matches somewhere in the text columns. */
  context?: RegExp;
  /** Strength to use when `context` does not match (instead of skipping). */
  withoutContext?: Strength;
}

const TEXT: Field[] = ["description", "material", "notes"];
const TEXT_AND_CODES: Field[] = ["description", "material", "notes", "mpn", "partNumber"];
const MAGNET_CONTEXT = /magnet|\bdisc\b|\bdisk\b|\bblock\b|\bbar\b|\bring\b|\barc\b|segment|\bcube\b|sphere|cylind|\bcyl\b|\brod\b|ni-?cu-?ni|nicuni|\bni\s*pl|plated|epoxy|rotor|\bmotor/i;

export const RULES: Rule[] = [
  // ---- SmCo ----
  { id: "smco.word", domain: "magnet", strength: "likely", materials: ["smco"], fields: TEXT_AND_CODES, re: /\b(smco\d*|sm-co\d*|sm2co17|samarium(\s*-?\s*cobalt)?|recoma)\b/i, why: "names samarium cobalt (SmCo)" },
  { id: "smco.ratio", domain: "magnet", strength: "likely", materials: ["smco"], fields: TEXT, re: /(^|[^\d:])(2\s*:\s*17|1\s*:\s*5)(?![\d:])/, context: /magnet|cobalt|\bsm\b|rare[-\s]?earth|rotor/i, why: "SmCo grade family 2:17 or 1:5 on a magnet part" },
  // ---- NdFeB ----
  { id: "ndfeb.word", domain: "magnet", strength: "likely", materials: ["ndfeb"], fields: TEXT_AND_CODES, re: /\b(nd-?fe-?b|ndfeb|neodymium)\b/i, why: "names NdFeB / neodymium" },
  { id: "ndfeb.neo", domain: "magnet", strength: "likely", materials: ["ndfeb"], fields: TEXT, re: /\bneo\b/i, context: MAGNET_CONTEXT, withoutContext: "possible", why: "'neo' (neodymium) magnet" },
  { id: "ndfeb.grade", domain: "magnet", strength: "likely", materials: ["ndfeb"], fields: TEXT, re: /\bN(3[5-9]|4\d|5[0-2])(SH|UH|EH|AH|H|M)?\b/i, context: MAGNET_CONTEXT, withoutContext: "possible", why: "NdFeB grade (N35-N52)" },
  { id: "ndfeb.rare_earth", domain: "magnet", strength: "likely", materials: ["ndfeb"], fields: TEXT, re: /\brare[-\s]?earth\b/i, why: "rare-earth magnet (NdFeB unless SmCo is stated)" },
  // ---- Non-covered magnets ----
  { id: "clear.ferrite", domain: "magnet", strength: "clear", materials: [], fields: TEXT, re: /\bferrite\b/i, why: "ferrite is not a covered material" },
  { id: "clear.ceramic_magnet", domain: "magnet", strength: "clear", materials: [], fields: TEXT, re: /\bceramic\b[^,;]{0,25}\bmagnet|\bmagnet[^,;]{0,25}\bceramic\b|\bceramic\s*(gr(ade)?\.?\s*)?[158]\b/i, why: "ceramic (ferrite) magnet is not a covered material" },
  { id: "clear.c_grade", domain: "magnet", strength: "clear", materials: [], fields: TEXT, re: /\bC-?[58][AB]?\b|\bgr(ade)?\.?\s*[58]\b/i, context: /magnet|ceramic|ferrite/i, why: "ceramic grade C5/C8 is ferrite, not a covered material" },
  { id: "clear.alnico", domain: "magnet", strength: "clear", materials: [], fields: TEXT, re: /\bal-?ni-?co\d*\b/i, why: "AlNiCo is not a covered material" },
  // ---- Magnet-bearing part classes (not material evidence by themselves) ----
  { id: "class.bldc", domain: "magnet", strength: "possible", materials: ["ndfeb"], fields: TEXT, re: /\b(bldc|brushless|servo\s*motors?|servomotors?|servo|frameless|torque\s*motors?|steppers?|stepping\s*motors?|pmsm)\b/i, why: "brushless/servo/stepper/frameless motors usually use rare-earth (NdFeB, sometimes SmCo) magnets" },
  { id: "class.magnetic", domain: "magnet", strength: "check", materials: [], fields: TEXT, re: /(\b|micro|gear)motors?\b|\bmagnets?\b|\bmagnetic\s+assembl|\b(loud)?speakers?\b|\bactuators?\b|\btransducers?\b|\bgenerators?\b|\balternators?\b|\bheadphones?\b|\bvoice\s*coil\b|\bhall[-\s]?effect\b|\bpermanent\s*magnet\b|\brotor\b/i, why: "motor/magnet/speaker/actuator class part; magnet material not stated" },
  // ---- Tungsten ----
  { id: "tungsten.word", domain: "tungsten", strength: "likely", materials: ["tungsten"], fields: TEXT_AND_CODES, re: /\b(tungsten|wolfram|densimet|inermet|densalloy|w-?ni-?fe|wnife|w-?ni-?cu|heavy[-\s]?alloy)\b/i, why: "names tungsten / tungsten heavy alloy" },
  { id: "tungsten.material_w", domain: "tungsten", strength: "likely", materials: ["tungsten"], fields: ["material"], re: /^\s*(W|W-?(Ni|Cu|Fe|Re|La|Ce|Th|Zr)\S*|9\d(\.\d+)?\s*%?\s*W(\b.*)?)\s*$/i, why: "material column is W (tungsten)" },
  { id: "tungsten.weight", domain: "tungsten", strength: "possible", materials: ["tungsten"], fields: TEXT, re: /\b(bal(ance)?\.?\s*w(eigh)?ts?|ballast|counter[-\s]?weights?|counter[-\s]?balance|trim\s*weights?|crank\s*bal)\b/i, why: "balance/ballast/counter weights are often tungsten heavy alloy (could be steel or lead)" },
  { id: "tungsten.other", domain: "tungsten", strength: "possible", materials: ["tungsten"], fields: TEXT, re: /\b(penetrator|tig\s*electrode|electrode,?\s*tig|filament)\b/i, why: "part class commonly made of tungsten" },
  // ---- Tantalum ----
  { id: "tantalum.word", domain: "tantalum", strength: "likely", materials: ["tantalum"], fields: TEXT_AND_CODES, re: /\btant(alum)?\b|\btant\.|\bta\s*caps?\b|\bta\s*capacitors?\b|\bcap(acitor)?s?[,\s]+ta\b|\bta[-\s](polymer|mno2)\b/i, why: "names tantalum (TANT / Ta cap)" },
  { id: "tantalum.material_ta", domain: "tantalum", strength: "likely", materials: ["tantalum"], fields: ["material"], re: /^\s*(Ta|Ta2O5|Ta\s*\/\s*MnO2|Ta\s*polymer)\s*$/i, why: "material column is Ta (tantalum)" },
  { id: "tantalum.molded_polarized", domain: "tantalum", strength: "possible", materials: ["tantalum"], fields: TEXT, re: /\b(molded|moulded)\b.*\bpolari[sz]ed\b|\bpolari[sz]ed\b.*\b(molded|moulded)\b/i, context: /\bcap|\d\s*[uµ]f\b/i, why: "molded polarized chip capacitors are usually tantalum" },
  { id: "clear.non_tantalum_cap", domain: "tantalum", strength: "clear", materials: [], fields: TEXT, re: /\bmlcc\b|\bcap\s*cer\b|\bceramic\s*cap|\bal(uminum|uminium)?\s*electrolytic\b|\bfilm\s*cap/i, why: "ceramic / aluminium / film capacitor is not tantalum" },
];

export interface RuleHit {
  rule: string;
  field: Field;
  domain: Domain;
  strength: Strength;
  materials: Material[];
  why: string;
  source: "rules" | "table";
}

export interface PartClassification {
  coverage: Coverage;
  /** Covered materials (likely) or candidates (possible). ["other"] for not_likely. */
  materials: Material[];
  confidence: number;
  reason: string;
  classifiedBy: "rules" | "table" | "default";
  /** True when an LLM may usefully review the row (possible, or no signal at all). */
  uncertain: boolean;
  hits: RuleHit[];
}

const normCode = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/\s+/g, "");

function domainOf(ms: Material[]): Domain {
  if (ms.includes("tantalum")) return "tantalum";
  if (ms.includes("tungsten")) return "tungsten";
  return "magnet";
}

export function matchPatterns(s: PartSignals, patterns: PartPattern[] = PART_PATTERNS): { pattern: PartPattern; field: Field }[] {
  const out: { pattern: PartPattern; field: Field }[] = [];
  const codes: [Field, string][] = [["mpn", normCode(s.mpn)], ["partNumber", normCode(s.partNumber)]];
  const makers: [Field, string][] = [["manufacturer", s.manufacturer ?? ""], ["supplierName", s.supplierName ?? ""]];
  for (const p of patterns) {
    const codeField = p.mpn ? codes.find(([, v]) => v && p.mpn!.test(v))?.[0] : undefined;
    const makerField = p.manufacturer ? makers.find(([, v]) => v && p.manufacturer!.test(v))?.[0] : undefined;
    if (p.mpn && p.manufacturer) {
      if (codeField && (makerField || p.mpnAlone)) out.push({ pattern: p, field: codeField });
    } else if (p.mpn) {
      if (codeField) out.push({ pattern: p, field: codeField });
    } else if (makerField) {
      out.push({ pattern: p, field: makerField });
    }
  }
  return out;
}

function ruleHits(s: PartSignals): RuleHit[] {
  const values: Record<Field, string> = {
    description: s.description ?? "",
    material: s.material ?? "",
    notes: s.notes ?? "",
    mpn: s.mpn ?? "",
    partNumber: s.partNumber ?? "",
    manufacturer: s.manufacturer ?? "",
    supplierName: s.supplierName ?? "",
  };
  const allText = TEXT.map((f) => values[f]).join(" | ");
  const hits: RuleHit[] = [];
  for (const r of RULES) {
    for (const f of r.fields) {
      const v = values[f];
      if (!v || !r.re.test(v)) continue;
      let strength: Strength | null = r.strength;
      // The material column is itself material evidence, so context is not required there.
      if (r.context && f !== "material" && !r.context.test(allText)) strength = r.withoutContext ?? null;
      if (!strength) continue;
      hits.push({ rule: r.id, field: f, domain: r.domain, strength, materials: r.materials, why: r.why, source: "rules" });
      break; // one hit per rule is enough; first matching column is cited
    }
  }
  return hits;
}

const LABEL: Record<Material, string> = { ndfeb: "NdFeB", smco: "SmCo", tungsten: "tungsten", tantalum: "tantalum", other: "none" };
const cite = (h: RuleHit) => `${h.why} [${h.source === "table" ? "pattern" : "rule"} ${h.rule}, ${FIELD_LABELS[h.field]}]`;
const uniq = <T,>(xs: T[]) => [...new Set(xs)];

interface DomainVerdict {
  domain: Domain;
  level: "likely" | "possible" | "clear";
  materials: Material[];
  reason: string;
  hits: RuleHit[];
}

function decideDomain(domain: Domain, hs: RuleHit[]): DomainVerdict | null {
  const by = (st: Strength) => hs.filter((h) => h.strength === st);
  const pos = by("likely"), neg = by("clear"), pos2 = by("possible"), chk = by("check");
  if (pos.length && neg.length) {
    return {
      domain,
      level: "possible",
      materials: uniq(pos.flatMap((h) => h.materials)),
      reason: `Conflicting signals: ${pos.map(cite).join("; ")} vs ${neg.map(cite).join("; ")}`,
      hits: [...pos, ...neg],
    };
  }
  if (pos.length) {
    let ms = uniq(pos.flatMap((h) => h.materials));
    // "Rare earth" alone implies NdFeB; drop it when SmCo is named explicitly.
    if (ms.includes("smco") && ms.includes("ndfeb") && pos.filter((h) => h.materials.includes("ndfeb")).every((h) => h.rule === "ndfeb.rare_earth")) ms = ms.filter((m) => m !== "ndfeb");
    return { domain, level: "likely", materials: ms, reason: pos.map(cite).join("; "), hits: pos };
  }
  if (neg.length) return { domain, level: "clear", materials: [], reason: neg.map(cite).join("; "), hits: neg };
  if (pos2.length) return { domain, level: "possible", materials: uniq(pos2.flatMap((h) => h.materials)), reason: pos2.map(cite).join("; "), hits: pos2 };
  if (chk.length) return { domain, level: "possible", materials: [], reason: `Needs check: ${chk.map(cite).join("; ")}`, hits: chk };
  return null;
}

export function classifyPart(s: PartSignals): PartClassification {
  const hits = ruleHits(s);
  for (const { pattern, field } of matchPatterns(s)) {
    const st: Strength = pattern.outcome.coverage === "likely" ? "likely" : pattern.outcome.coverage === "possible" ? "possible" : "clear";
    hits.push({ rule: pattern.id, field, domain: domainOf(pattern.outcome.materials), strength: st, materials: pattern.outcome.materials, why: pattern.note, source: "table" });
  }
  const verdicts = (["magnet", "tungsten", "tantalum"] as Domain[]).map((d) => decideDomain(d, hits.filter((h) => h.domain === d))).filter((v): v is DomainVerdict => !!v);
  const likely = verdicts.filter((v) => v.level === "likely");
  const possible = verdicts.filter((v) => v.level === "possible");
  const clear = verdicts.filter((v) => v.level === "clear");
  const by = (vs: DomainVerdict[]): PartClassification["classifiedBy"] => (vs.some((v) => v.hits.some((h) => h.source === "table")) ? "table" : "rules");

  if (likely.length) {
    const ms = uniq(likely.flatMap((v) => v.materials));
    const extra = possible.length ? ` Also possible: ${possible.map((v) => v.reason).join("; ")}.` : "";
    return {
      coverage: "likely",
      materials: ms,
      confidence: likely.some((v) => v.hits.some((h) => h.source === "table")) ? 0.85 : 0.9,
      reason: `Likely ${ms.map((m) => LABEL[m]).join(" + ")}: ${likely.map((v) => v.reason).join("; ")}.${extra}`,
      classifiedBy: by(likely),
      uncertain: false,
      hits,
    };
  }
  if (possible.length) {
    const ms = uniq(possible.flatMap((v) => v.materials));
    const what = ms.length ? `possible ${ms.map((m) => LABEL[m]).join(" or ")}` : "material unknown";
    const cleared = clear.length ? ` (${clear.map((v) => v.reason).join("; ")})` : "";
    return {
      coverage: "possible",
      materials: ms,
      confidence: ms.length ? 0.5 : 0.4,
      reason: `Confirm with supplier, ${what}: ${possible.map((v) => v.reason).join("; ")}.${cleared}`,
      classifiedBy: by(possible),
      uncertain: true,
      hits,
    };
  }
  if (clear.length) {
    return {
      coverage: "not_likely",
      materials: ["other"],
      confidence: 0.85,
      reason: `Not likely covered: ${clear.map((v) => v.reason).join("; ")}.`,
      classifiedBy: by(clear),
      uncertain: false,
      hits,
    };
  }
  const desc = (s.description ?? "").trim();
  if (!desc || desc === (s.partNumber ?? "").trim() || desc === (s.mpn ?? "").trim()) {
    return {
      coverage: "possible",
      materials: [],
      confidence: 0.3,
      reason: "Confirm with supplier: no description to classify; only a part number was given.",
      classifiedBy: "default",
      uncertain: true,
      hits,
    };
  }
  return {
    coverage: "not_likely",
    materials: ["other"],
    confidence: 0.6,
    reason: "Not likely covered: no covered-material signal in the description, material, notes, MPN or manufacturer columns.",
    classifiedBy: "default",
    uncertain: true,
    hits,
  };
}

/** Back-compat wrapper over classifyPart for a single text blob (used by the LLM mock and older tests). */
export function keywordClassify(text: string): { materials: Material[]; confidence: number; rationale: string; coverage: Coverage } {
  const c = classifyPart({ description: text });
  return { materials: c.materials.length ? c.materials : ["other"], confidence: c.confidence, rationale: c.reason, coverage: c.coverage };
}
