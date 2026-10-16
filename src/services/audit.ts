/**
 * Append-only audit log (adapted from LoadEnergy src/services/audit.ts).
 * The port is insert + read only: there is no update or delete to call.
 */
import { ValidationError } from "@/domain/errors";
import type { AuditEntryRecord } from "@/domain/types";

export const AUDIT_ACTIONS = [
  "audit.created",
  "audit.classified",
  "audit.failed",
  "auth.magic_link_requested",
  "auth.magic_link_consumed",
  "auth.logout",
  "supplier.document_uploaded",
  "claim.reviewed",
  "pack.created",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditRepository {
  appendAuditEntry(entry: Omit<AuditEntryRecord, "id" | "createdAt"> & { createdAt: Date }): Promise<AuditEntryRecord>;
  listAuditEntries(limit: number): Promise<AuditEntryRecord[]>;
  listAuditEntriesBySubject(subjectId: string): Promise<AuditEntryRecord[]>;
}

export interface AuditAppendInput {
  action: AuditAction;
  actorUserId?: string | null;
  actorSupplierRequestId?: string | null;
  subjectId: string;
  /** Ids and prior/new values only. Never document or parts-list content. */
  payload?: Record<string, unknown>;
  ip?: string | null;
}

export class AuditService {
  constructor(
    private readonly repo: AuditRepository,
    private readonly now: () => Date = () => new Date()
  ) {}

  async append(input: AuditAppendInput): Promise<AuditEntryRecord> {
    if (!AUDIT_ACTIONS.includes(input.action)) {
      throw new ValidationError("AUDIT_ACTION_INVALID", "Unknown audit action.");
    }
    if (!input.subjectId) {
      throw new ValidationError("AUDIT_SUBJECT_REQUIRED", "subjectId is required.");
    }
    return this.repo.appendAuditEntry({
      action: input.action,
      actorUserId: input.actorUserId ?? null,
      actorSupplierRequestId: input.actorSupplierRequestId ?? null,
      subjectId: input.subjectId,
      payload: input.payload ?? {},
      ip: input.ip ?? null,
      createdAt: this.now(),
    });
  }

  list(limit = 100) {
    return this.repo.listAuditEntries(limit);
  }
  forSubject(subjectId: string) {
    return this.repo.listAuditEntriesBySubject(subjectId);
  }
}
