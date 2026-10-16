import { AuthenticationError, DomainError } from "@/domain/errors";
import type { AuthContext } from "@/domain/types";
import { getAuthContext } from "./auth-context";

export async function requireApiContext(): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) throw new AuthenticationError("AUTH_REQUIRED", "Sign in to continue.");
  return ctx;
}

export async function readJson(req: Request, maxBytes = 64 * 1024): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (text.length > maxBytes) throw new DomainError("payload_too_large", "BODY_TOO_LARGE", "Request body too large.");
  if (!text) return {};
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

import { errorResponse } from "./respond";
/** Wraps a route handler with the shared error mapping. */
export function route<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      return errorResponse(e);
    }
  };
}
