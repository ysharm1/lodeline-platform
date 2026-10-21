/**
 * Composition root: the one place adapters are chosen from the environment.
 * - DATABASE_URL set -> Prisma repository + Prisma sessions; otherwise
 *   in-memory (dev only; production refuses to boot without a DB).
 * - S3_DOCS_BUCKET set -> S3 (us-west-2); otherwise memory storage (dev only).
 * - EMAIL_PROVIDER -> console | postmark | resend.
 * - Production refuses to boot unless LLM_ZDR_CONFIRMED=true.
 */
import { PrismaClient } from "@prisma/client";
import { emailSenderFromEnv } from "@/infra/email";
import { LlmClient, llmConfigFromEnv } from "@/infra/llm";
import { S3DocumentStorage, isS3Configured } from "@/infra/s3-document-storage";
import { MemoryRateLimiter, PostgresRateLimiter, type RateLimiter } from "@/http/rate-limit";
import { InMemoryRepository } from "@/repository/in-memory";
import { PrismaRepository } from "@/repository/prisma";
import type { Repository } from "@/repository/repository";
import { AuditService } from "@/services/audit";
import { FreeAuditService } from "@/services/free-audit";
import { MagicLinkService } from "@/services/magic-link";
import type { EmailSender } from "@/services/notifications";
import { LocalDiskStorage, type DocumentStorage } from "@/services/storage";
import { DomainError } from "@/domain/errors";
import { billingFromEnv } from "@/infra/billing";
import type { PlatformDeps } from "@/services/deps";
import { PackService } from "@/services/packs";
import { SupplierService } from "@/services/suppliers";
import { EvidenceIntakeService } from "@/services/evidence-intake";
import { ReviewService } from "@/services/review";
import { DirectoryService } from "@/services/directory";
import { LeadService } from "@/services/leads";
import { IntroService } from "@/services/intros";
import { SupplierApplicationService } from "@/services/supplier-applications";
import { VerificationService } from "@/services/verifications";
import { RefreshService } from "@/services/refresh";
import { geocoderFromEnv } from "@/services/geocoder";
import { PrismaSessionStore } from "@/session/prisma-store";
import { InMemorySessionStore, type SessionStore } from "@/session/store";

export interface Platform {
  deps: PlatformDeps;
  packs: PackService;
  suppliers: SupplierService;
  intake: EvidenceIntakeService;
  review: ReviewService;
  directory: DirectoryService;
  leads: LeadService;
  /** Marketplace "Request intro" (ContactRequest), routed to Lodeline staff. */
  intros: IntroService;
  applications: SupplierApplicationService;
  /** Supplier-paid annual evidence review. */
  verifications: VerificationService;
  /** Buyer-paid monthly plan to keep a pack current. */
  refresh: RefreshService;
}

export interface Container {
  /** DB-backed services (packs, suppliers, review, directory). Throws without DATABASE_URL. */
  platform(): Platform;
  storage: DocumentStorage;
  repo: Repository;
  sessions: SessionStore;
  audit: AuditService;
  magicLinks: MagicLinkService;
  email: EmailSender;
  baseUrl: string;
  freeAudit: FreeAuditService;
  limits: Record<"audit" | "magicLink" | "supplierUpload" | "ask" | "lead" | "supplierApply", RateLimiter>;
}

export function assertProductionConfig(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== "production" || env.NEXT_PHASE === "phase-production-build") return;
  const missing: string[] = [];
  // ALLOW_DEV_ADAPTERS=true lets `next start` run locally on in-memory DB/storage.
  // Never set it on Render. It does not relax the LLM ZDR requirement.
  const dev = env.ALLOW_DEV_ADAPTERS === "true";
  if (!env.DATABASE_URL && !dev) missing.push("DATABASE_URL");
  if (!env.S3_DOCS_BUCKET && !dev) missing.push("S3_DOCS_BUCKET");
  if (!env.APP_BASE_URL) missing.push("APP_BASE_URL");
  if (env.LLM_ZDR_CONFIRMED !== "true") missing.push("LLM_ZDR_CONFIRMED=true");
  if (!env.SESSION_SECRET && !env.TOKEN_ENCRYPTION_KEY) missing.push("SESSION_SECRET");
  if (!dev && !env.STRIPE_SECRET_KEY) missing.push("STRIPE_SECRET_KEY");
  if (!dev && !env.CRON_SECRET) missing.push("CRON_SECRET");
  if (missing.length) throw new Error(`Refusing to start in production; missing: ${missing.join(", ")}`);
}

function limiter(db: PrismaClient | null, scope: string, limit: number, windowMs: number): RateLimiter {
  return db ? new PostgresRateLimiter(db, scope, limit, windowMs) : new MemoryRateLimiter(limit, windowMs);
}

function build(): Container {
  assertProductionConfig();
  let repo: Repository;
  let sessions: SessionStore;
  let db: PrismaClient | null = null;
  if (process.env.DATABASE_URL) {
    db = new PrismaClient();
    repo = new PrismaRepository(db);
    sessions = new PrismaSessionStore(db);
  } else {
    repo = new InMemoryRepository();
    sessions = new InMemorySessionStore();
  }
  const audit = new AuditService(repo);
  const baseUrlEarly = process.env.APP_BASE_URL ?? "http://localhost:3000";
  const storage: DocumentStorage = isS3Configured()
    ? S3DocumentStorage.fromEnv()
    : new LocalDiskStorage(process.env.LOCAL_UPLOAD_DIR ?? ".uploads", baseUrlEarly, process.env.SESSION_SECRET ?? "dev-local-upload-secret");
  const llmConfig = llmConfigFromEnv();
  const email = emailSenderFromEnv();
  const baseUrl = baseUrlEarly;
  const llm = new LlmClient(llmConfig);
  let platform: Platform | undefined;
  const audit_ = audit;
  return {
    storage,
    platform() {
      if (platform) return platform;
      if (!db) throw new DomainError("unavailable", "DATABASE_REQUIRED", "This feature needs DATABASE_URL (run `npm run db:start`).");
      const deps: PlatformDeps = {
        db,
        audit: audit_,
        email,
        storage,
        billing: billingFromEnv(),
        llm,
        geocoder: geocoderFromEnv(db),
        baseUrl,
      };
      const packs = new PackService(deps);
      const suppliers = new SupplierService(deps, packs);
      platform = {
        deps,
        packs,
        suppliers,
        intake: new EvidenceIntakeService(deps, suppliers),
        review: new ReviewService(deps),
        directory: new DirectoryService(deps),
        leads: new LeadService(deps),
        intros: new IntroService(deps),
        applications: new SupplierApplicationService(deps),
        verifications: new VerificationService(deps, suppliers),
        refresh: new RefreshService(deps, packs),
      };
      return platform;
    },
    email,
    baseUrl,
    repo,
    sessions,
    audit,
    magicLinks: new MagicLinkService({
      repo,
      sessions,
      email,
      baseUrl,
      adminEmails: (process.env.SEED_ADMIN_EMAIL ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
    }),
    freeAudit: new FreeAuditService({
      repo,
      storage,
      llm,
      audit,
      requireLlm: process.env.NODE_ENV === "production" && !!llmConfig.apiKey,
    }),
    limits: {
      audit: limiter(db, "audit", Number(process.env.RATE_LIMIT_AUDITS_PER_HOUR ?? 10), 3_600_000),
      magicLink: limiter(db, "magic-link", 5, 15 * 60_000),
      supplierUpload: limiter(db, "supplier-upload", 30, 3_600_000),
      ask: limiter(db, "ask", 30, 3_600_000),
      lead: limiter(db, "lead", Number(process.env.RATE_LIMIT_LEADS_PER_HOUR ?? 5), 3_600_000),
      supplierApply: limiter(db, "supplier-apply", 3, 3_600_000),
    },
  };
}

const g = globalThis as unknown as { __lodeline?: Container };
export function container(): Container {
  return (g.__lodeline ??= build());
}
