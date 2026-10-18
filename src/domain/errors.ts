/**
 * Domain error taxonomy (adapted from LoadEnergy src/domain/errors.ts).
 * Services throw these; `src/http/respond.ts` maps them to
 * `{ error: { code, message, field? } }` with a stable HTTP status.
 */
export const HTTP_STATUS_BY_CATEGORY = {
  validation: 400,
  authentication: 401,
  authorization: 403,
  not_found: 404,
  conflict: 409,
  payload_too_large: 413,
  unsupported: 415,
  rate_limited: 429,
  unavailable: 503,
} as const;

export type ErrorCategory = keyof typeof HTTP_STATUS_BY_CATEGORY;

/**
 * Cross-bundle brand. The container is cached on globalThis, so an error can be
 * thrown by a service loaded through one route bundle and caught in another
 * (each Next dev route bundle has its own copy of this class). `instanceof`
 * then fails and a 4xx became a 500. Symbol.for is shared process-wide.
 */
const DOMAIN_ERROR_BRAND = Symbol.for("lodeline.DomainError");

export class DomainError extends Error {
  constructor(
    readonly category: ErrorCategory,
    readonly code: string,
    message: string,
    readonly field?: string
  ) {
    super(message);
    this.name = "DomainError";
    Object.defineProperty(this, DOMAIN_ERROR_BRAND, { value: true });
  }
  get httpStatus(): number {
    return HTTP_STATUS_BY_CATEGORY[this.category];
  }
}

export class ValidationError extends DomainError {
  constructor(code: string, message: string, field?: string) {
    super("validation", code, message, field);
  }
}
export class AuthenticationError extends DomainError {
  constructor(code: string, message: string) {
    super("authentication", code, message);
  }
}
export class AuthorizationError extends DomainError {
  constructor(code: string, message: string) {
    super("authorization", code, message);
  }
}
export class NotFoundError extends DomainError {
  constructor(code: string, message: string) {
    super("not_found", code, message);
  }
}

export function isDomainError(e: unknown): e is DomainError {
  return e instanceof DomainError || (typeof e === "object" && e !== null && (e as Record<symbol, unknown>)[DOMAIN_ERROR_BRAND] === true);
}

export class ConflictError extends DomainError {
  constructor(code: string, message: string) {
    super("conflict", code, message);
  }
}
