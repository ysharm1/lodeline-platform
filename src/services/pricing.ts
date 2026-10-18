/**
 * Lodeline pricing and business-policy rules. Pure, no I/O.
 *
 * Every price Lodeline charges is defined here, in one file, so the team can
 * change a number without hunting through the code. See docs/business-model.md
 * for why each revenue line exists and how they fit together.
 *
 * Revenue lines:
 *   1. Free parts audit       -> no charge (lead generation)
 *   2. Evidence pack          -> buyer pays a one-time fee by tier (this file: PACK_TIERS)
 *   3. Supplier verification  -> supplier pays a flat annual review fee (VERIFICATION_TIERS)
 *   4. Refresh plan           -> buyer pays monthly to keep a pack current (REFRESH_PLANS)
 *   Sourcing introductions    -> later; buyer-paid flat fee. Supplier-paid
 *                                commissions are OFF (SUPPLIER_COMMISSIONS_ENABLED).
 */

export type PackTierId = "starter" | "standard" | "custom";

export interface PackTier {
  id: PackTierId;
  label: string;
  /** One-time fee in US cents. null = quoted by the team, not sold through checkout. */
  priceCents: number | null;
  /** Most in-scope parts (likely covered + possible) the tier covers. */
  maxParts: number;
  /** Most suppliers that can be contacted under the tier. */
  maxSuppliers: number;
}

export const PACK_TIERS: readonly PackTier[] = [
  { id: "starter", label: "Starter", priceCents: 250_000, maxParts: 5, maxSuppliers: 3 },
  { id: "standard", label: "Standard", priceCents: 500_000, maxParts: 15, maxSuppliers: 8 },
  { id: "custom", label: "Custom", priceCents: null, maxParts: Number.POSITIVE_INFINITY, maxSuppliers: Number.POSITIVE_INFINITY },
];

export function packTier(id: PackTierId): PackTier {
  const t = PACK_TIERS.find((x) => x.id === id);
  if (!t) throw new Error(`Unknown pack tier ${id}`);
  return t;
}

/**
 * Picks the smallest tier that fits the audit's scope.
 * parts: number of in-scope parts (coverage likely or possible).
 * suppliers: number of distinct named suppliers behind those parts. Parts with
 * no supplier name are not counted here; the supplier limit is enforced again
 * when the buyer actually adds suppliers to the pack.
 */
export function tierForScope(scope: { parts: number; suppliers: number }): PackTier {
  return PACK_TIERS.find((t) => scope.parts <= t.maxParts && scope.suppliers <= t.maxSuppliers) ?? packTier("custom");
}

/** Counts the in-scope parts and distinct named suppliers in an audit. */
export function scopeOfParts(parts: { coverage: string; supplierName: string | null }[]): { parts: number; suppliers: number } {
  const inScope = parts.filter((p) => p.coverage === "likely" || p.coverage === "possible");
  const names = new Set(inScope.map((p) => p.supplierName?.trim().toLowerCase()).filter((n): n is string => !!n));
  return { parts: inScope.length, suppliers: names.size };
}

// ---------------------------------------------------------------------------
// Supplier verification (supplier pays)
// ---------------------------------------------------------------------------

export type VerificationTierId = "single" | "multi" | "network";

export interface VerificationTier {
  id: VerificationTierId;
  label: string;
  /** Flat annual fee in US cents. The same whatever the review finds. */
  priceCents: number;
  /** Most production facilities covered by one annual review. */
  maxFacilities: number;
}

export const VERIFICATION_TIERS: readonly VerificationTier[] = [
  { id: "single", label: "One facility", priceCents: 150_000, maxFacilities: 1 },
  { id: "multi", label: "Two to three facilities", priceCents: 300_000, maxFacilities: 3 },
  { id: "network", label: "Four to eight facilities", priceCents: 500_000, maxFacilities: 8 },
];

export const VERIFICATION_PERIOD_DAYS = 365;

/** Picks the verification tier for a facility count; more than 8 facilities is quoted. */
export function verificationTierFor(facilities: number): VerificationTier | null {
  if (!Number.isInteger(facilities) || facilities < 1) return null;
  return VERIFICATION_TIERS.find((t) => facilities <= t.maxFacilities) ?? null;
}

// ---------------------------------------------------------------------------
// Refresh plan (buyer pays monthly)
// ---------------------------------------------------------------------------

export interface RefreshPlan {
  /** Matches the pack tier it keeps current. Custom packs get a quoted plan. */
  tier: Exclude<PackTierId, "custom">;
  label: string;
  monthlyCents: number;
  /** How often Lodeline re-checks the pack's documents. */
  intervalDays: number;
}

export const REFRESH_PLANS: readonly RefreshPlan[] = [
  { tier: "starter", label: "Quarterly refresh (Starter scope)", monthlyCents: 25_000, intervalDays: 90 },
  { tier: "standard", label: "Quarterly refresh (Standard scope)", monthlyCents: 50_000, intervalDays: 90 },
];

export function refreshPlanFor(tier: PackTierId): RefreshPlan | null {
  return REFRESH_PLANS.find((p) => p.tier === tier) ?? null;
}

// ---------------------------------------------------------------------------
// Policy switches
// ---------------------------------------------------------------------------

/**
 * Supplier-paid referral commissions stay OFF until a government contracts
 * lawyer has reviewed the structure (possible Anti-Kickback Act questions,
 * and a conflict of interest with the evidence review). Sourcing help, when
 * offered, is a flat fee paid by the buyer.
 */
export const SUPPLIER_COMMISSIONS_ENABLED = false;

/** Shown to buyers on the pack page and in the pack PDF. */
export const CONFLICT_DISCLOSURE =
  "How Lodeline is paid: buyers pay for evidence packs and refresh plans. Suppliers may pay a flat annual fee to have their own documents reviewed; that fee is the same whatever the review finds, and it never affects a pack's findings or a supplier's place in the directory. Lodeline does not take commissions from suppliers.";

export const usd = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
