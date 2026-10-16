/**
 * Country normalisation + deterministic covered-country flagging.
 * DFARS 252.225-7052 covered countries: China, Russia, Iran, North Korea.
 * No LLM involved: the flag is a pure function of the ISO code(s).
 */
export const COVERED_COUNTRIES = ["CN", "RU", "IR", "KP"] as const;
export type CoveredIso = (typeof COVERED_COUNTRIES)[number];

const NAMES: Record<string, string> = {
  china: "CN", prc: "CN", "people's republic of china": "CN", "peoples republic of china": "CN", "p.r. china": "CN", "p.r.c.": "CN", "mainland china": "CN", 中国: "CN",
  russia: "RU", "russian federation": "RU", rf: "RU",
  iran: "IR", "islamic republic of iran": "IR",
  "north korea": "KP", dprk: "KP", "democratic people's republic of korea": "KP", "korea, democratic people's republic of": "KP",
  "south korea": "KR", korea: "KR", "republic of korea": "KR",
  "united states": "US", "united states of america": "US", usa: "US", "u.s.": "US", "u.s.a.": "US", us: "US",
  canada: "CA", mexico: "MX", japan: "JP", germany: "DE", france: "FR", "united kingdom": "GB", uk: "GB", "great britain": "GB",
  australia: "AU", vietnam: "VN", "viet nam": "VN", malaysia: "MY", thailand: "TH", india: "IN", estonia: "EE", brazil: "BR",
  taiwan: "TW", philippines: "PH", indonesia: "ID", myanmar: "MM", burma: "MM", laos: "LA", "south africa": "ZA", rwanda: "RW",
  "democratic republic of the congo": "CD", drc: "CD", congo: "CG", austria: "AT", sweden: "SE", finland: "FI", norway: "NO",
  netherlands: "NL", belgium: "BE", spain: "ES", portugal: "PT", italy: "IT", poland: "PL", "czech republic": "CZ", czechia: "CZ",
  switzerland: "CH", israel: "IL", singapore: "SG", "hong kong": "HK", kazakhstan: "KZ", mongolia: "MN", bolivia: "BO", chile: "CL", peru: "PE",
};

/** "China", "PRC", "cn", "CN" -> "CN". Unknown -> null. */
export function toIso2(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = input.trim();
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  return NAMES[s.toLowerCase().replace(/\s+/g, " ")] ?? null;
}

export function isCoveredIso(iso: string | null | undefined): iso is CoveredIso {
  return !!iso && (COVERED_COUNTRIES as readonly string[]).includes(iso.toUpperCase());
}

export interface CoveredFlag {
  covered: boolean;
  countryIso: string | null;
  reason: string | null;
}

/**
 * Conservative: covered if EITHER the stated country or the geocoded country
 * is covered. A disagreement is surfaced in the reason for the reviewer.
 */
export function flagCoveredCountry(statedCountry: string | null | undefined, geocodedIso: string | null | undefined): CoveredFlag {
  const stated = toIso2(statedCountry);
  const geo = geocodedIso ? geocodedIso.toUpperCase() : null;
  const countryIso = geo ?? stated;
  const reasons: string[] = [];
  if (isCoveredIso(stated)) reasons.push(`stated country ${stated} is a covered country`);
  if (isCoveredIso(geo)) reasons.push(`geocoded address is in covered country ${geo}`);
  if (stated && geo && stated !== geo) reasons.push(`stated country ${stated} differs from geocoded ${geo}`);
  const covered = isCoveredIso(stated) || isCoveredIso(geo);
  return { covered, countryIso, reason: reasons.length ? reasons.join("; ") : null };
}
