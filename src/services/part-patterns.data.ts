/**
 * Manufacturer + MPN pattern table for the free-audit classifier.
 *
 * HOW TO EXTEND: add one entry. Every entry MUST cite at least one public
 * source (manufacturer page/datasheet or a major distributor page) that states
 * the material for that maker or series, and the date it was checked. Do not
 * add a pattern you have not verified.
 *
 * Matching (see matchPatterns in keyword-classifier.ts):
 *  - `manufacturer` is tested against the Manufacturer and Supplier columns.
 *  - `mpn` is tested against the MPN and Part Number columns (spaces removed, upper case).
 *  - With both set, both must match, unless `mpnAlone` is true (the MPN
 *    structure is specific enough to identify the series by itself).
 *  - `outcome.coverage`:
 *      likely      the source states the covered material for this maker/series
 *      possible    the maker makes covered AND non-covered products (grade/material decides)
 *      not_likely  the source states a non-covered material (ferrite, AlNiCo) for this series
 */
import type { Coverage, Material } from "@/domain/types";

export interface PartPattern {
  id: string;
  manufacturer?: RegExp;
  mpn?: RegExp;
  mpnAlone?: boolean;
  outcome: { coverage: Coverage; materials: Material[] };
  /** Shown to the buyer as the reason. Keep it short and factual. */
  note: string;
  sources: string[];
  checked: string;
}

const KEMET = /\bkemet\b/i;
const AVX = /\b(kyocera\s*)?avx\b|\bkyocera\b/i;
const VISHAY = /\bvishay\b/i;

export const PART_PATTERNS: PartPattern[] = [
  // ---------------- Tantalum capacitors ----------------
  {
    id: "kemet.t49x",
    manufacturer: KEMET,
    mpn: /^T49\d[A-Z]\d{3}[KMJ]\d{3}/,
    mpnAlone: true,
    outcome: { coverage: "likely", materials: ["tantalum"] },
    note: "KEMET T49x series are MnO2 tantalum capacitors",
    sources: ["https://www.kemet.com/en/us/capacitors/tantalum.html/1000", "https://search.kemet.com/download/specsheet/T491A106K016AT"],
    checked: "2026-10-17",
  },
  {
    id: "kemet.t35x",
    manufacturer: KEMET,
    mpn: /^T35\d[A-Z]\d{3}[KMJ]\d{3}/,
    mpnAlone: true,
    outcome: { coverage: "likely", materials: ["tantalum"] },
    note: "KEMET T350-T356 UltraDip II are dipped solid tantalum capacitors",
    sources: ["https://content.kemet.com/datasheets/KEM_T2043_T35X.pdf"],
    checked: "2026-10-17",
  },
  {
    id: "kemet.t52x",
    manufacturer: KEMET,
    mpn: /^T5(2\d|30)[A-Z]\d{3}M\d{3}/,
    mpnAlone: true,
    outcome: { coverage: "likely", materials: ["tantalum"] },
    note: "KEMET T52x/T530 KO-CAP are polymer tantalum capacitors (\"T = Tantalum\")",
    sources: ["https://content.kemet.com/datasheets/kem_t2076_t52x-530.pdf"],
    checked: "2026-10-17",
  },
  {
    id: "avx.taj",
    manufacturer: AVX,
    mpn: /^TAJ[A-Z]\d{3}[KMJ]\d{3}/,
    mpnAlone: true,
    outcome: { coverage: "likely", materials: ["tantalum"] },
    note: "KYOCERA AVX TAJ series are molded solid tantalum capacitors",
    sources: ["https://www.digikey.com/en/products/detail/kyocera-avx/TAJA106K016RNJ/563762", "https://catalogs.kyocera-avx.com/TantalumNiobium.pdf"],
    checked: "2026-10-17",
  },
  {
    id: "avx.tps",
    manufacturer: AVX,
    mpn: /^TPS[A-Z]\d{3}[KM]\d{3}/,
    mpnAlone: true,
    outcome: { coverage: "likely", materials: ["tantalum"] },
    note: "KYOCERA AVX TPS series are low-ESR MnO2 solid tantalum capacitors",
    sources: ["https://www.kyocera-avx.com/products/tantalum/smd-tantalum-mno2/tps-series/"],
    checked: "2026-10-17",
  },
  {
    id: "avx.tcj",
    manufacturer: AVX,
    mpn: /^TCJ[A-Z]\d{3}M\d{3}/,
    mpnAlone: true,
    outcome: { coverage: "likely", materials: ["tantalum"] },
    note: "KYOCERA AVX TCJ series are conductive-polymer tantalum capacitors",
    sources: ["https://www.kyocera-avx.com/products/polymer/hv-tcj-series/", "https://catalogs.kyocera-avx.com/TantalumNiobium.pdf"],
    checked: "2026-10-17",
  },
  {
    id: "vishay.293d",
    manufacturer: VISHAY,
    mpn: /^293D\d{3}X[059]\d{3}/,
    mpnAlone: true,
    outcome: { coverage: "likely", materials: ["tantalum"] },
    note: "Vishay 293D TANTAMOUNT are solid tantalum chip capacitors",
    sources: ["https://www.vishay.com/docs/40002/293d.pdf"],
    checked: "2026-10-17",
  },
  {
    id: "vishay.t55",
    manufacturer: VISHAY,
    mpn: /^T55[A-Z]\d{3}M/,
    mpnAlone: true,
    outcome: { coverage: "likely", materials: ["tantalum"] },
    note: "Vishay T55 vPolyTan are polymer tantalum chip capacitors",
    sources: ["https://www.vishay.com/docs/40174/t55.pdf"],
    checked: "2026-10-17",
  },

  // ---------------- Magnet makers (grade decides unless noted) ----------------
  {
    id: "kj.magnetics",
    manufacturer: /\bk\s*&\s*j\b|\bkj\s*magnetics\b/i,
    outcome: { coverage: "likely", materials: ["ndfeb"] },
    note: "K&J Magnetics supplies only sintered neodymium (NdFeB) magnets",
    sources: ["https://www.kjmagnetics.com/blog/neodymium-vs-ceramic-magnets", "https://www.kjmagnetics.com/proddetail.asp?prod=BX041"],
    checked: "2026-10-17",
  },
  {
    id: "arnold.magnetics",
    manufacturer: /\barnold\b/i,
    outcome: { coverage: "possible", materials: ["ndfeb", "smco"] },
    note: "Arnold Magnetic Technologies makes SmCo (RECOMA), NdFeB, AlNiCo and ferrite magnets; the grade decides",
    sources: ["https://www.arnoldmagnetics.com/permanent-magnets/"],
    checked: "2026-10-17",
  },
  {
    id: "eec",
    manufacturer: /\belectron\s*energy\b|\beec\b/i,
    outcome: { coverage: "possible", materials: ["smco", "ndfeb"] },
    note: "Electron Energy Corp. (Permag) is a samarium-cobalt magnet producer; confirm the grade",
    sources: ["https://www.electronenergy.com/samarium-cobalt-magnets/"],
    checked: "2026-10-17",
  },
  {
    id: "thomas.skinner",
    manufacturer: /\bthomas\s*(&|and)\s*skinner\b/i,
    outcome: { coverage: "possible", materials: [] },
    note: "Thomas & Skinner makes AlNiCo magnets (not covered) and also supplies rare-earth magnets and tungsten heavy alloys; confirm the material",
    sources: ["https://www.thomas-skinner.com/"],
    checked: "2026-10-17",
  },
  {
    id: "permag",
    manufacturer: /\bpermag\b|\bdexter\s*magnetic\b/i,
    outcome: { coverage: "possible", materials: ["smco", "ndfeb"] },
    note: "Permag (Dexter, EEC, MCE) supplies SmCo, NdFeB, AlNiCo and ferrite magnets; the grade decides",
    sources: ["https://www.permag.com/", "https://www.permag.com/about-us/"],
    checked: "2026-10-17",
  },
  {
    id: "standex.smco5",
    manufacturer: /\bstandex\b|\bmeder\b/i,
    mpn: /^SMCO5/,
    mpnAlone: true,
    outcome: { coverage: "likely", materials: ["smco"] },
    note: "Standex-Meder SMCO5 magnets are samarium cobalt (SmCo5)",
    sources: ["https://www.digikey.ee/en/products/detail/standex-meder-electronics/SMCO5-5X4MM/2171081"],
    checked: "2026-10-17",
  },

  // ---------------- Tungsten ----------------
  {
    id: "midwest.tungsten",
    manufacturer: /\bmidwest\s*tungsten\b/i,
    outcome: { coverage: "likely", materials: ["tungsten"] },
    note: "Midwest Tungsten Service manufactures tungsten products (balance weights, ballast, electrodes)",
    sources: ["https://shop.tungsten.com/tungsten-crankshaft-balance-weight/", "https://shop.tungsten.com/tungsten-heavy-metal-ballast-weight-3-0-17-6-lbs/"],
    checked: "2026-10-17",
  },
  {
    id: "plansee",
    manufacturer: /\bplansee\b/i,
    outcome: { coverage: "possible", materials: ["tungsten"] },
    note: "Plansee makes tungsten heavy metal (DENSIMET/INERMET) among other refractory metals; confirm the material",
    sources: ["https://www.plansee.com/en/materials/tungsten-composites/materials/densimet-and-inermet.html"],
    checked: "2026-10-17",
  },
  {
    id: "kennametal",
    manufacturer: /\bkennametal\b/i,
    outcome: { coverage: "possible", materials: ["tungsten"] },
    note: "Kennametal makes tungsten heavy alloys (Densalloy) and tungsten-carbide products; confirm the material",
    sources: ["https://s7d1.scene7.com/is/content/kennametalstage/B-16-04884_KMT_Tungsten_Heavy_Alloy_Brochure_EN_LRpdf"],
    checked: "2026-10-17",
  },
  {
    id: "ck.tungsten",
    manufacturer: /\bck\s*worldwide\b/i,
    mpn: /^T\d{3,4}G(T2|Z|L|L2|C2|TM)?(-3)?$/,
    outcome: { coverage: "likely", materials: ["tungsten"] },
    note: "CK Worldwide T…G… part numbers are tungsten TIG electrodes",
    sources: ["https://www.ckworldwide.com/products/tungsten-packages-ordering-information"],
    checked: "2026-10-17",
  },

  // ---------------- Motors ----------------
  {
    id: "kollmorgen.kbm",
    manufacturer: /\bkollmorgen\b/i,
    mpn: /^KBMS?-\d{2,3}[HS]\d{2}/,
    mpnAlone: true,
    outcome: { coverage: "possible", materials: ["ndfeb"] },
    note: "Kollmorgen KBM frameless motors are listed with rare-earth neodymium iron boron magnets; confirm for this winding",
    sources: ["https://www.kollmorgen.com/en-us/products/motors/direct-drive/kbm-series-frameless"],
    checked: "2026-10-17",
  },
  {
    id: "allied.ht",
    manufacturer: /\ballied\s*motion\b/i,
    mpn: /^HT0\d{4}/,
    outcome: { coverage: "likely", materials: ["ndfeb"] },
    note: "Allied Motion HT frameless torque motors use NdFeB magnets as standard (SmCo optional)",
    sources: ["https://www.mclennan.co.uk/datasheet/1842"],
    checked: "2026-10-17",
  },
  {
    id: "faulhaber.bx4.ndfeb",
    manufacturer: /\bfaulhaber\b/i,
    mpn: /^(2232|2250)[A-Z]\d{3}BX4/,
    outcome: { coverage: "likely", materials: ["ndfeb"] },
    note: "FAULHABER 2232/2250 BX4 datasheets state magnet material NdFeB",
    sources: ["https://www.faulhaber.com/fileadmin/Import/Media/EN_2232_BX4_DFF.pdf", "https://www.faulhaber.com/fileadmin/Import/Media/EN_2250_BX4_DFF.pdf"],
    checked: "2026-10-17",
  },
  {
    id: "faulhaber.s.alnico",
    manufacturer: /\bfaulhaber\b/i,
    mpn: /^(2230|2233|1624)[A-Z]\d{3}S/,
    outcome: { coverage: "not_likely", materials: [] },
    note: "FAULHABER 2230/2233/1624 S datasheets state magnet material AlNiCo (not a covered material)",
    sources: [
      "https://www.faulhaber.com/fileadmin/Import/Media/EN_2230_S_DFF.pdf",
      "https://www.faulhaber.com/fileadmin/Import/Media/EN_2233_S_DFF.pdf",
      "https://www.faulhaber.com/fileadmin/Import/Media/EN_1624_S_DFF.pdf",
    ],
    checked: "2026-10-17",
  },
  {
    id: "sensata.hpht",
    manufacturer: /\bsensata\b|\bbei\b|\bkimco\b/i,
    mpn: /^DI[IH]\d{2}-\d{2}-\d{3}[A-Z]$/,
    outcome: { coverage: "likely", materials: ["smco"] },
    note: "BEI Kimco (Sensata) HPHT downhole BLDC motors use samarium cobalt magnets",
    sources: [
      "https://www.sensata.com/products/motors-actuators/high-pressure-high-temperature-bldc-motors-dii15-60-201a",
      "https://www.sensata.com/products/motors-actuators/high-pressure-high-temperature-bldc-motors-dih10-27-001a",
    ],
    checked: "2026-10-17",
  },
  {
    id: "mabuchi.ferrite",
    manufacturer: /\bmabuchi\b/i,
    mpn: /^(RS-?(360|380|385)|FF-?130|FK-?180)/,
    outcome: { coverage: "not_likely", materials: [] },
    note: "Mabuchi RS-360/380/385, FF-130 and FK-180 product pages list ferrite magnets",
    sources: ["https://product.mabuchi-motor.com/detail.html?id=98", "https://product.mabuchi-motor.com/detail.html?id=25"],
    checked: "2026-10-17",
  },
];
