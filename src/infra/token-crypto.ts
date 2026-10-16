/**
 * Supplier-link tokens.
 * - Lookup is by SHA-256 hash only (same scheme as sessions/magic links).
 * - The raw token is also kept AES-256-GCM encrypted so reminder emails can
 *   resend the same link. Key: TOKEN_ENCRYPTION_KEY, else derived from
 *   SESSION_SECRET. Production refuses to run with neither.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { generateSessionToken, hashSessionToken } from "@/session/store";

export const generateToken = generateSessionToken;
export const hashToken = hashSessionToken;

export function tokenMatchesHash(token: string, hash: string): boolean {
  const a = Buffer.from(hashToken(token), "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

function key(env: NodeJS.ProcessEnv = process.env): Buffer {
  const material = env.TOKEN_ENCRYPTION_KEY || env.SESSION_SECRET;
  if (!material) {
    if (env.NODE_ENV === "production") throw new Error("TOKEN_ENCRYPTION_KEY or SESSION_SECRET is required");
    return createHash("sha256").update("lodeline-dev-only-key").digest();
  }
  return createHash("sha256").update(`lodeline-token:${material}`).digest();
}

export function encryptToken(token: string, env?: NodeJS.ProcessEnv): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(env), iv);
  const ct = Buffer.concat([c.update(token, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptToken(blob: string, env?: NodeJS.ProcessEnv): string {
  const [v, iv, tag, ct] = blob.split(".");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("bad token ciphertext");
  const d = createDecipheriv("aes-256-gcm", key(env), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
}
