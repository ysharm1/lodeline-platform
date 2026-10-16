/** Core domain vocabulary. Mirrors the enums in prisma/schema.prisma. */

export const ROLES = ["buyer", "supplier", "admin"] as const;
export type Role = (typeof ROLES)[number];

export const STAGES = ["mine", "separation", "metal_alloy", "magnet", "component"] as const;
export type Stage = (typeof STAGES)[number];

export const MATERIALS = ["ndfeb", "smco", "tungsten", "tantalum", "other"] as const;
export type Material = (typeof MATERIALS)[number];

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
  materials: Material[];
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
