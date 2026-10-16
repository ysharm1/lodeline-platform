/**
 * Fixed-window per-key rate limiting.
 * - PostgresRateLimiter: production. One atomic upsert per check, shared by
 *   every instance (Render, Vercel functions).
 * - MemoryRateLimiter: tests and DB-less dev.
 */
import type { PrismaClient } from "@prisma/client";

export interface RateLimitResult {
  ok: boolean;
  retryAfterSec: number;
}
export interface RateLimiter {
  check(key: string, now?: Date): Promise<RateLimitResult>;
}

export class MemoryRateLimiter implements RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  constructor(private readonly limit: number, private readonly windowMs: number) {}

  async check(key: string, nowDate = new Date()): Promise<RateLimitResult> {
    const now = nowDate.getTime();
    const h = this.hits.get(key);
    if (!h || now >= h.resetAt) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return { ok: true, retryAfterSec: 0 };
    }
    h.count++;
    return { ok: h.count <= this.limit, retryAfterSec: Math.ceil((h.resetAt - now) / 1000) };
  }
}

export class PostgresRateLimiter implements RateLimiter {
  constructor(
    private readonly db: PrismaClient,
    private readonly scope: string,
    private readonly limit: number,
    private readonly windowMs: number
  ) {}

  async check(key: string, now = new Date()): Promise<RateLimitResult> {
    const k = `${this.scope}:${key}`;
    const resetAt = new Date(now.getTime() + this.windowMs);
    // Prisma stores DateTime as UTC in timestamp(3) without time zone; bind as
    // UTC explicitly so the DB session time zone cannot skew the window.
    const nowUtc = now.toISOString();
    const resetUtc = resetAt.toISOString();
    const [row] = await this.db.$queryRaw<{ count: number; resetAt: Date }[]>`
      INSERT INTO "RateLimitBucket" ("key", "count", "resetAt") VALUES (${k}, 1, (${resetUtc}::timestamptz AT TIME ZONE 'UTC'))
      ON CONFLICT ("key") DO UPDATE SET
        "count"   = CASE WHEN "RateLimitBucket"."resetAt" <= (${nowUtc}::timestamptz AT TIME ZONE 'UTC') THEN 1 ELSE "RateLimitBucket"."count" + 1 END,
        "resetAt" = CASE WHEN "RateLimitBucket"."resetAt" <= (${nowUtc}::timestamptz AT TIME ZONE 'UTC') THEN EXCLUDED."resetAt" ELSE "RateLimitBucket"."resetAt" END
      RETURNING "count", "resetAt"`;
    // Opportunistic cleanup of stale buckets (~1% of calls).
    if (Math.random() < 0.01) await this.db.rateLimitBucket.deleteMany({ where: { resetAt: { lt: now } } });
    return {
      ok: row.count <= this.limit,
      retryAfterSec: row.count <= this.limit ? 0 : Math.ceil((row.resetAt.getTime() - now.getTime()) / 1000),
    };
  }
}

export function clientIp(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return headers.get("x-real-ip") ?? "unknown";
}
