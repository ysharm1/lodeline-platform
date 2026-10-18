import type { PrismaClient } from "@prisma/client";
import type { Billing } from "@/infra/billing";
import type { LlmClient } from "@/infra/llm";
import type { AuditService } from "./audit";
import type { Geocoder } from "./geocoder";
import type { EmailSender } from "./notifications";
import type { DocumentStorage } from "./storage";

export interface PlatformDeps {
  db: PrismaClient;
  audit: AuditService;
  email: EmailSender;
  storage: DocumentStorage;
  billing: Billing;
  llm: LlmClient;
  geocoder: Geocoder;
  baseUrl: string;
  now?: () => Date;
  supplierTokenTtlDays?: number;
}
export const nowOf = (d: PlatformDeps) => (d.now ? d.now() : new Date());
