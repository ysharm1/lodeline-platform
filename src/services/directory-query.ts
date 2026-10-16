/** Directory query types + deterministic (no-LLM) parser and answer. Pure. */
import { z } from "zod";
import { MATERIALS, STAGES } from "@/domain/types";
import { toIso2 } from "./countries";

export const directoryFiltersSchema = z.object({
  q: z.string().max(200).default(""),
  materials: z.array(z.enum(MATERIALS)).default([]),
  stages: z.array(z.enum(STAGES)).default([]),
  countries: z.array(z.string().length(2)).default([]),
  excludeCountries: z.array(z.string().length(2)).default([]),
  verifiedOnly: z.boolean().default(false),
});
export type DirectoryFilters = z.infer<typeof directoryFiltersSchema>;

export interface ListingForAnswer {
  id: string;
  name: string;
  countryIso: string | null;
  city: string | null;
  stages: string[];
  materials: string[];
  verified: boolean;
  isExample: boolean;
  summary: string;
}

const MAT_WORDS: [RegExp, (typeof MATERIALS)[number]][] = [
  [/\b(ndfeb|neodymium|nd-?fe-?b)\b/i, "ndfeb"],
  [/\b(smco|samarium)\b/i, "smco"],
  [/\b(tungsten|wolfram)\b/i, "tungsten"],
  [/\b(tantalum)\b/i, "tantalum"],
];
const STAGE_WORDS: [RegExp, (typeof STAGES)[number]][] = [
  [/\b(mine|mines|mining|miner)\b/i, "mine"],
  [/\b(separation|separator|refin\w*)\b/i, "separation"],
  [/\b(metal|alloy|smelt\w*)\b/i, "metal_alloy"],
  [/\b(magnet maker|magnet manufactur\w*|sinter\w*)\b/i, "magnet"],
];
const COUNTRY_WORDS = ["united states", "usa", "canada", "japan", "germany", "australia", "estonia", "vietnam", "malaysia", "france", "united kingdom", "uk", "china", "russia", "south korea", "korea", "mexico", "india", "brazil", "austria"];
const STOP = new Set(["who", "which", "what", "find", "show", "me", "suppliers", "supplier", "companies", "in", "the", "a", "an", "of", "for", "with", "and", "or", "that", "are", "is", "do", "does", "not", "outside", "excluding", "except", "verified", "make", "makes", "can", "list", "any", "from"]);

export function keywordParseDirectoryQuery(question: string): DirectoryFilters {
  const qLower = question.toLowerCase();
  const materials = [...new Set(MAT_WORDS.filter(([re]) => re.test(question)).map(([, m]) => m))];
  const stages = [...new Set(STAGE_WORDS.filter(([re]) => re.test(question)).map(([, s]) => s))];
  if (/\bmagnets?\b/i.test(question) && !materials.length) materials.push("ndfeb", "smco");
  if (/\bmagnets?\b/i.test(question) && !stages.length && /\b(make|maker|manufactur)/i.test(question)) stages.push("magnet");
  const countries: string[] = [];
  const excludeCountries: string[] = [];
  for (const w of COUNTRY_WORDS) {
    const re = new RegExp(`\\b${w.replace(/\./g, "\\.")}\\b`, "i");
    const m = qLower.match(re);
    if (!m) continue;
    const iso = toIso2(w);
    if (!iso) continue;
    const before = qLower.slice(Math.max(0, (m.index ?? 0) - 20), m.index);
    (/(not|outside|excluding|except|non)\W*(in\W*)?$/.test(before) ? excludeCountries : countries).push(iso);
  }
  // "US" only when capitalised, so the pronoun "us" is not read as a country.
  if (/\bUS\b|\bU\.S\./.test(question) && !countries.includes("US")) countries.push("US");
  if (/\bnon-?china\b|\bchina-?free\b/i.test(question)) excludeCountries.push("CN");
  return {
    q: "",
    materials,
    stages,
    countries: [...new Set(countries)].sort(),
    excludeCountries: [...new Set(excludeCountries)].sort(),
    verifiedOnly: /\bverified\b/i.test(question),
  };
}

export function leftoverKeywords(question: string): string {
  return question
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
    .join(" ");
}

export function templateAnswer(rows: ListingForAnswer[]): { answer: string; citedIds: string[] } {
  const lines = rows.slice(0, 10).map(
    (r, i) =>
      `[${i + 1}] ${r.name}${r.isExample ? " (example listing)" : ""}: ${[r.city, r.countryIso].filter(Boolean).join(", ") || "location not listed"}; stages ${r.stages.join(", ") || "n/a"}; ${r.verified ? "verified from reviewed evidence" : "not verified"}.`
  );
  return { answer: `${rows.length} matching listing${rows.length === 1 ? "" : "s"}:\n${lines.join("\n")}`, citedIds: rows.slice(0, 10).map((r) => r.id) };
}
