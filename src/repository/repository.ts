import type { AuditRepository } from "@/services/audit";
import type { FreeAuditRepository } from "@/services/free-audit";
import type { MagicLinkRepository } from "@/services/magic-link";
import type { User } from "@/domain/types";

export interface Repository extends AuditRepository, FreeAuditRepository, MagicLinkRepository {
  findUserById(id: string): Promise<User | null>;
}
