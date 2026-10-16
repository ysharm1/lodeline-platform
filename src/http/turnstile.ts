/**
 * Cloudflare Turnstile verification hook. When TURNSTILE_SECRET_KEY is unset
 * the check is skipped (dev); in production set it, or set
 * TURNSTILE_REQUIRED=true to fail closed when it is missing.
 */
import { DomainError } from "@/domain/errors";

export async function verifyTurnstile(token: string | null | undefined, ip: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    if (process.env.TURNSTILE_REQUIRED === "true") {
      throw new DomainError("unavailable", "TURNSTILE_NOT_CONFIGURED", "Bot protection is not configured.");
    }
    return;
  }
  if (!token) throw new DomainError("validation", "TURNSTILE_REQUIRED", "Please complete the verification.");
  const body = new URLSearchParams({ secret, response: token, remoteip: ip });
  const res = await fetchImpl("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
  const json = (await res.json()) as { success?: boolean };
  if (!json.success) throw new DomainError("validation", "TURNSTILE_FAILED", "Verification failed. Please try again.");
}
