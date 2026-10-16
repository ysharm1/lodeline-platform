/**
 * Fixed-window per-key rate limiter (in-process). Good enough for a single
 * Render instance; TODO: move to Postgres/Redis when scaling out.
 */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  constructor(private readonly limit: number, private readonly windowMs: number) {}

  check(key: string, now = Date.now()): { ok: boolean; retryAfterSec: number } {
    const h = this.hits.get(key);
    if (!h || now >= h.resetAt) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      if (this.hits.size > 10_000) this.sweep(now);
      return { ok: true, retryAfterSec: 0 };
    }
    h.count++;
    return { ok: h.count <= this.limit, retryAfterSec: Math.ceil((h.resetAt - now) / 1000) };
  }
  private sweep(now: number) {
    for (const [k, v] of this.hits) if (now >= v.resetAt) this.hits.delete(k);
  }
}

export function clientIp(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return headers.get("x-real-ip") ?? "unknown";
}
