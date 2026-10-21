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
  "audit.results_emailed",
  "audit.results_email_failed",
  "pack.checkout_started",
  "pack.paid",
  "pack.generated",
  "pack.status_changed",
  "supplier.created",
  "supplier.request_created",
  "supplier.request_revoked",
  "supplier.document_rejected",
  "supplier.document_processed",
  "outreach.sent",
  "outreach.failed",
  "outreach.event",
  "claim.extracted",
  "intro.requested",
  "intro.status",
  "org.created",
  "org.renamed",
  "listing.created",
  "listing.updated",
  "listing.deleted",
  "listing.verified",
  "auth.magic_link_requested",
  "auth.magic_link_consumed",
  "auth.logout",
  "supplier.document_uploaded",
  "claim.reviewed",
  "pack.created",
  "lead.created",
  "lead.notify_failed",
  "lead.status_changed",
  "supplier_application.submitted",
  "supplier_application.approved",
  "supplier_application.rejected",
  // Business model update (docs/business-model.md)
  "pack.quote_required",
  "supplier.reuse_consent_given",
  "supplier.reuse_consent_withdrawn",
  "supplier.verification_request_created",
  "verification.created",
  "verification.checkout_started",
  "verification.paid",
  "verification.completed",
  "verification.cancelled",
  "refresh.checkout_started",
  "refresh.activated",
  "refresh.completed",
  "refresh.cancelled",
  // End-to-end flow (docs/workflow.md)
  "pack.quoted",
  "pack.released",
  "supplier.request_forwarded",
  "listing.submitted_by_org",
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
