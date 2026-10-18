/** Core domain vocabulary. Mirrors the enums in prisma/schema.prisma. */

export const ROLES = ["buyer", "supplier", "admin"] as const;
export type Role = (typeof ROLES)[number];

/**
 * Per-organization capabilities. An Organization can be a buyer AND a seller;
 * a user's roles in an org live on their Membership. (Platform-wide `Role`
 * above stays as the active-context role until multi-org switching ships.)
 */
export const ORG_ROLES = ["buyer", "seller"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export interface MembershipRecord {
  id: string;
  userId: string;
  orgId: string;
  roles: OrgRole[];
  isOrgAdmin: boolean;
  createdAt: Date;
}

export const STAGES = ["mine", "separation", "metal_alloy", "magnet", "component"] as const;
export type Stage = (typeof STAGES)[number];

export const MATERIALS = ["ndfeb", "smco", "tungsten", "tantalum", "other"] as const;
export type Material = (typeof MATERIALS)[number];

/**
 * Free-audit result category for a part:
 *  - likely: a rule, the material column or a verified MPN/manufacturer pattern names a covered material
 *  - possible: a weaker or conflicting signal; confirm with the supplier
 *  - not_likely: an explicit non-covered signal (ferrite, AlNiCo, verified ferrite motor series) or no signal at all
 */
export const COVERAGES = ["likely", "possible", "not_likely"] as const;
export type Coverage = (typeof COVERAGES)[number];

export type AuditStatus = "uploaded" | "parsing" | "classified" | "failed";

export interface AuthContext {
  userId: string;
  role: Role;
  orgId: string | null;
  email: string;
}

export interface User {
  id: string;
  email: string;
  role: Role;
  orgId: string | null;
  name: string | null;
  emailVerifiedAt: Date | null;
  createdAt: Date;
}

export interface MagicLinkRecord {
  id: string;
  email: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

export interface PartsAuditRecord {
  id: string;
  orgId: string | null;
  leadEmail: string;
  companyName: string | null;
  sourceFileKey: string;
  sourceFileName: string;
  sourceSha256: string;
  rowCount: number;
  status: AuditStatus;
  llmModel: string | null;
  promptVersion: string | null;
  accessTokenHash: string | null;
  /** Custom-tier quote set by staff (Prisma only; absent in the in-memory repo). */
  quotedPriceCents?: number | null;
  quotedMaxSuppliers?: number | null;
  createdAt: Date;
}

export interface AuditPartRecord {
  id: string;
  auditId: string;
  rowIndex: number;
  partNumber: string | null;
  description: string;
  supplierName: string | null;
  quantity: number | null;
  mpn: string | null;
  manufacturer: string | null;
  material: string | null;
  notes: string | null;
  /** Likely or candidate covered materials (["other"] when none). */
  materials: Material[];
  coverage: Coverage;
  /** Human-readable reason citing the matched rule(s) and column(s). */
  reason: string;
  /** "rules" | "table" | "llm" | "default" */
  classifiedBy: string;
  llmConfidence: number | null;
  llmRationale: string | null;
  undocumentedStages: Stage[];
  ruleVersion: string;
}

export interface AuditEntryRecord {
  id: string;
  action: string;
  actorUserId: string | null;
  actorSupplierRequestId: string | null;
  subjectId: string;
  payload: Record<string, unknown>;
  ip: string | null;
  createdAt: Date;
}
