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
import { RateLimiter } from "@/http/rate-limit";
import { InMemoryRepository } from "@/repository/in-memory";
import { PrismaRepository } from "@/repository/prisma";
import type { Repository } from "@/repository/repository";
import { AuditService } from "@/services/audit";
import { FreeAuditService } from "@/services/free-audit";
import { MagicLinkService } from "@/services/magic-link";
import { MemoryDocumentStorage } from "@/services/storage";
import { PrismaSessionStore } from "@/session/prisma-store";
import { InMemorySessionStore, type SessionStore } from "@/session/store";

export interface Container {
  repo: Repository;
  sessions: SessionStore;
  audit: AuditService;
  magicLinks: MagicLinkService;
  freeAudit: FreeAuditService;
  limits: { audit: RateLimiter; magicLink: RateLimiter };
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
  if (missing.length) throw new Error(`Refusing to start in production; missing: ${missing.join(", ")}`);
}

function build(): Container {
  assertProductionConfig();
  let repo: Repository;
  let sessions: SessionStore;
  if (process.env.DATABASE_URL) {
    const db = new PrismaClient();
    repo = new PrismaRepository(db);
    sessions = new PrismaSessionStore(db);
  } else {
    repo = new InMemoryRepository();
    sessions = new InMemorySessionStore();
  }
  const audit = new AuditService(repo);
  const storage = isS3Configured() ? S3DocumentStorage.fromEnv() : new MemoryDocumentStorage();
  const llmConfig = llmConfigFromEnv();
  return {
    repo,
    sessions,
    audit,
    magicLinks: new MagicLinkService({
      repo,
      sessions,
      email: emailSenderFromEnv(),
      baseUrl: process.env.APP_BASE_URL ?? "http://localhost:3000",
      adminEmails: (process.env.SEED_ADMIN_EMAIL ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
    }),
    freeAudit: new FreeAuditService({
      repo,
      storage,
      llm: new LlmClient(llmConfig),
      audit,
      requireLlm: process.env.NODE_ENV === "production" && !!llmConfig.apiKey,
    }),
    limits: {
      audit: new RateLimiter(Number(process.env.RATE_LIMIT_AUDITS_PER_HOUR ?? 10), 3_600_000),
      magicLink: new RateLimiter(5, 15 * 60_000),
    },
  };
}

const g = globalThis as unknown as { __lodeline?: Container };
export function container(): Container {
  return (g.__lodeline ??= build());
}
